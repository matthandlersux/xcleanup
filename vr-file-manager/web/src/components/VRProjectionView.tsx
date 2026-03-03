import { useRef, useEffect, useCallback, useState } from 'react';

interface Props {
  src: string;
  crop: 'full' | 'left' | 'right' | 'top' | 'bottom';
}

const VERT_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// u_lens: 1.0 = rectilinear, 0.0 = equidistant fisheye, <0 = even flatter (stereographic-ish).
// Interpolates between fisheye (theta = r * half_fov) and rectilinear (theta = atan(r * tan(half_fov))),
// then for negative values applies additional radial compression to flatten further.
const FRAG_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
uniform float u_lens;
uniform float u_aspect;
uniform vec4 u_crop;

const float PI = 3.14159265359;

void main() {
  vec2 centered = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);
  float r = length(centered);
  float half_fov = u_fov * 0.5;

  float theta_fish = r * half_fov;
  float theta_rect = atan(r * tan(half_fov));

  float theta;
  if (u_lens >= 0.0) {
    // 0..1: blend from fisheye to rectilinear
    theta = mix(theta_fish, theta_rect, u_lens);
  } else {
    // Negative: go beyond rectilinear — compress edges even more.
    // Apply radial compression: shrink the effective radius at edges.
    float compress = 1.0 + u_lens * r * r;  // u_lens is negative, so this shrinks r at edges
    compress = max(compress, 0.05);
    theta = atan(r * compress * tan(half_fov));
  }
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

  float lon = atan(ray.z, ray.x);
  float lat = asin(clamp(ray.y, -1.0, 1.0));

  vec2 eq_uv = vec2(
    lon / (2.0 * PI) + 0.5,
    0.5 - lat / PI
  );

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
const DEFAULT_LENS = 1.0; // rectilinear; 0 = fisheye equidistant; <0 = flatter than rectilinear
const CANVAS_HEIGHT = 720;

export default function VRProjectionView({ src, crop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ yaw: 0, pitch: 0, fov: DEFAULT_FOV, lens: DEFAULT_LENS, dragging: false, lastX: 0, lastY: 0 });
  const [fovDisplay, setFovDisplay] = useState(DEFAULT_FOV);
  const [lensDisplay, setLensDisplay] = useState(DEFAULT_LENS);
  const [canvasWidth, setCanvasWidth] = useState(1280);
  const [aspect, setAspect] = useState(16 / 9);
  const glRef = useRef<{ gl: WebGLRenderingContext; locs: Record<string, WebGLUniformLocation>; tex: WebGLTexture } | null>(null);
  const rafRef = useRef(0);
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

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
      u_lens: gl.getUniformLocation(prog, 'u_lens')!,
      u_aspect: gl.getUniformLocation(prog, 'u_aspect')!,
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
    gl.uniform1f(locs.u_lens, s.lens);
    gl.uniform1f(locs.u_aspect, aspectRef.current);
    const c = cropToVec4(cropRef.current);
    gl.uniform4f(locs.u_crop, c[0], c[1], c[2], c[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, []);

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
    const clamped = Math.max(0.2, Math.min(Math.PI * 0.7, newFov));
    stateRef.current.fov = clamped;
    setFovDisplay(clamped);
    scheduleRender();
  }, [scheduleRender]);

  const updateLens = useCallback((val: number) => {
    stateRef.current.lens = val;
    setLensDisplay(val);
    scheduleRender();
  }, [scheduleRender]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    updateFov(stateRef.current.fov + e.deltaY * 0.001);
  }, [updateFov]);

  const fovDegrees = Math.round(fovDisplay * 180 / Math.PI);
  // Slider: -100 (flattest) to 0 (fisheye). Internal lens: -1.0 to 1.0.
  // Slider value = -(lens * 100), so slider -100 = lens -1, slider 0 = lens 1 (rectilinear), slider 100 = lens 0 (fisheye)
  // Actually simpler: slider directly controls lens from -1.0 to 1.0
  // Left of slider = -1.0 (flattest), right = 1.0 (rectilinear... no that's backwards)
  // Let's just: slider 0..200, maps to lens -1.0..1.0
  const sliderVal = Math.round((lensDisplay + 1.0) * 100); // -1→0, 0→100, 1→200

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
            min="12"
            max="126"
            value={fovDegrees}
            onChange={e => updateFov(Number(e.target.value) * Math.PI / 180)}
          />
        </div>
        <div className="vr-slider">
          <label className="vr-lens-label">Flat</label>
          <input
            type="range"
            min="0"
            max="200"
            value={sliderVal}
            onChange={e => updateLens(Number(e.target.value) / 100 - 1.0)}
          />
          <label className="vr-lens-label">Round</label>
        </div>
      </div>
    </div>
  );
}
