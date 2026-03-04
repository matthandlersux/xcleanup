import { useRef, useEffect, useCallback, useState } from 'react';

interface Props {
  src: string;
  crop: 'full' | 'left' | 'right' | 'top' | 'bottom';
  projectionDegrees: number;
}

const VERT_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
uniform float u_aspect;
uniform float u_h_range;
uniform vec4 u_crop;

const float PI = 3.14159265359;

void main() {
  vec2 centered = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);
  float r = length(centered);
  float half_fov = u_fov * 0.5;

  // Pure rectilinear projection
  float theta = atan(r * tan(half_fov));
  theta = clamp(theta, 0.0, PI * 0.499);

  vec2 dir2d = r > 0.001 ? centered / r : vec2(0.0, 1.0);
  vec3 ray = vec3(
    sin(theta) * dir2d.x,
    sin(theta) * dir2d.y,
    cos(theta)
  );

  // Rotate by pitch (around X axis)
  float cp = cos(u_pitch), sp = sin(u_pitch);
  ray = vec3(ray.x, cp * ray.y - sp * ray.z, sp * ray.y + cp * ray.z);

  // Rotate by yaw (around Y axis)
  float cy = cos(u_yaw), sy = sin(u_yaw);
  ray = vec3(cy * ray.x + sy * ray.z, ray.y, -sy * ray.x + cy * ray.z);

  // Spherical coords — fixed: atan(x, z) not atan(z, x)
  float lon = atan(ray.x, ray.z);
  float lat = asin(clamp(ray.y, -1.0, 1.0));

  // Map to UV using content angular range
  vec2 eq_uv = vec2(
    lon / u_h_range + 0.5,
    0.5 - lat / PI
  );

  // Black for out-of-bounds areas
  if (eq_uv.x < 0.0 || eq_uv.x > 1.0 || eq_uv.y < 0.0 || eq_uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Apply crop (SBS/TB eye selection)
  eq_uv = eq_uv * u_crop.zw + u_crop.xy;
  gl_FragColor = texture2D(u_tex, eq_uv);
}`;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function cropToVec4(crop: Props['crop']): [number, number, number, number] {
  switch (crop) {
    case 'left':   return [0,   0,   0.5, 1];
    case 'right':  return [0.5, 0,   0.5, 1];
    case 'top':    return [0,   0,   1,   0.5];
    case 'bottom': return [0,   0.5, 1,   0.5];
    default:       return [0,   0,   1,   1];
  }
}

// Compute single-eye aspect ratio from the full image dimensions and crop mode
function singleEyeAspect(imgW: number, imgH: number, crop: Props['crop']): number {
  switch (crop) {
    case 'left':
    case 'right':  return (imgW / 2) / imgH;   // SBS: each eye is half the width
    case 'top':
    case 'bottom': return imgW / (imgH / 2);    // TB: each eye is half the height
    default:       return imgW / imgH;
  }
}

const DEFAULT_FOV = Math.PI / 3;
const MIN_FOV_DEG = 12;
const MAX_FOV_DEG = 170;
const CANVAS_HEIGHT = 720;

export default function VRProjectionView({ src, crop, projectionDegrees }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ yaw: 0, pitch: 0, fov: DEFAULT_FOV, dragging: false, lastX: 0, lastY: 0 });
  const [fovDisplay, setFovDisplay] = useState(DEFAULT_FOV);
  const [canvasWidth, setCanvasWidth] = useState(1280);
  const [aspect, setAspect] = useState(16 / 9);
  const glRef = useRef<{ gl: WebGLRenderingContext; locs: Record<string, WebGLUniformLocation>; tex: WebGLTexture } | null>(null);
  const rafRef = useRef(0);
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const projRef = useRef(projectionDegrees);
  projRef.current = projectionDegrees;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { antialias: false })!;
    if (!gl) return;

    const vs = createShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const locs = {
      u_yaw: gl.getUniformLocation(prog, 'u_yaw')!,
      u_pitch: gl.getUniformLocation(prog, 'u_pitch')!,
      u_fov: gl.getUniformLocation(prog, 'u_fov')!,
      u_aspect: gl.getUniformLocation(prog, 'u_aspect')!,
      u_h_range: gl.getUniformLocation(prog, 'u_h_range')!,
      u_crop: gl.getUniformLocation(prog, 'u_crop')!,
    };

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    glRef.current = { gl, locs, tex };

    return () => {
      cancelAnimationFrame(rafRef.current);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
    };
  }, []);

  const render = useCallback(() => {
    const ctx = glRef.current;
    if (!ctx) return;
    const { gl, locs } = ctx;
    const canvas = canvasRef.current!;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const s = stateRef.current;
    gl.uniform1f(locs.u_yaw, s.yaw);
    gl.uniform1f(locs.u_pitch, s.pitch);
    gl.uniform1f(locs.u_fov, s.fov);
    gl.uniform1f(locs.u_aspect, aspectRef.current);
    gl.uniform1f(locs.u_h_range, projRef.current * Math.PI / 180);
    const c = cropToVec4(cropRef.current);
    gl.uniform4f(locs.u_crop, c[0], c[1], c[2], c[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, []);

  // Re-render when projectionDegrees changes
  useEffect(() => {
    render();
  }, [projectionDegrees, render]);

  // Load image, measure its natural size, compute correct aspect & canvas size
  useEffect(() => {
    const ctx = glRef.current;
    if (!ctx) return;
    const { gl, tex } = ctx;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const a = singleEyeAspect(img.naturalWidth, img.naturalHeight, crop);
      setAspect(a);
      aspectRef.current = a;
      const w = Math.round(CANVAS_HEIGHT * a);
      setCanvasWidth(w);
      // Need to wait a frame for canvas to resize before rendering
      requestAnimationFrame(() => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        render();
      });
    };
    img.src = src;
  }, [src, crop, render]);

  useEffect(() => { render(); }, [crop, render]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    stateRef.current.dragging = true;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const dy = e.clientY - s.lastY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.yaw -= dx * 0.004;
    s.pitch -= dy * 0.004;
    s.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, s.pitch));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const onMouseUp = useCallback(() => {
    stateRef.current.dragging = false;
  }, []);

  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const updateFov = useCallback((newFov: number) => {
    const minFov = MIN_FOV_DEG * Math.PI / 180;
    const maxFov = MAX_FOV_DEG * Math.PI / 180;
    const clamped = Math.max(minFov, Math.min(maxFov, newFov));
    stateRef.current.fov = clamped;
    setFovDisplay(clamped);
    scheduleRender();
  }, [scheduleRender]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    updateFov(stateRef.current.fov + e.deltaY * 0.001);
  }, [updateFov]);

  const fovDegrees = Math.round(fovDisplay * 180 / Math.PI);

  return (
    <div className="vr-container" onClick={e => e.stopPropagation()}>
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={CANVAS_HEIGHT}
        className="vr-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      />
      <div className="vr-controls">
        <div className="vr-slider">
          <label>FOV: {fovDegrees}°</label>
          <input
            type="range"
            min={MIN_FOV_DEG}
            max={MAX_FOV_DEG}
            value={fovDegrees}
            onChange={e => updateFov(Number(e.target.value) * Math.PI / 180)}
          />
        </div>
      </div>
    </div>
  );
}
