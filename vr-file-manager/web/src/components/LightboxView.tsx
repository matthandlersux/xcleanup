import { useState, useCallback, useEffect, useRef } from 'react';
import api, { Video } from '../api.js';
import VRProjectionView from './VRProjectionView.js';

type ViewMode = 'normal' | 'split-h' | 'split-v';

interface Props {
  video: Video;
  initialIndex: number;
  onClose: () => void;
}

export default function LightboxView({ video, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [vrMode, setVrMode] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const splitImgRef = useRef<HTMLImageElement>(null);

  const thumbCount = video.thumbs.length;
  const thumbSrc = api.thumbUrl(video.id, index);

  const resetView = () => { setScale(1); setTranslate({ x: 0, y: 0 }); setImgSize(null); };

  const changeIndex = (newIndex: number) => {
    setIndex(newIndex);
    resetView();
  };

  const setMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'normal') setVrMode(false);
    resetView();
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setScale(s => Math.max(0.5, Math.min(8, s - e.deltaY * 0.002)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') changeIndex(Math.max(0, index - 1));
      if (e.key === 'ArrowRight') changeIndex(Math.min(thumbCount - 1, index + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, thumbCount, index]);

  // Drag to pan when zoomed (non-VR mode)
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setDragging(true);
      setDragStart({ x: e.clientX - translate.x, y: e.clientY - translate.y });
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (dragging) setTranslate({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const onMouseUp = () => setDragging(false);

  // Determine crop for split views
  const getCrop = (): 'full' | 'left' | 'top' => {
    if (viewMode === 'split-v') return 'left';
    if (viewMode === 'split-h') return 'top';
    return 'full';
  };

  const imageTransform = `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`;
  const imageCursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';

  return (
    <div
      className="lightbox-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toolbar */}
      <div className="lightbox-toolbar" onClick={e => e.stopPropagation()}>
        <button onClick={() => setMode('normal')} className={`lb-btn ${viewMode === 'normal' ? 'lb-btn-active' : ''}`}>
          Normal
        </button>
        <button onClick={() => setMode('split-v')} className={`lb-btn ${viewMode === 'split-v' ? 'lb-btn-active' : ''}`}>
          SBS (Left Eye)
        </button>
        <button onClick={() => setMode('split-h')} className={`lb-btn ${viewMode === 'split-h' ? 'lb-btn-active' : ''}`}>
          TB (Top Eye)
        </button>
        {viewMode !== 'normal' && (
          <button onClick={() => { setVrMode(v => !v); resetView(); }} className={`lb-btn ${vrMode ? 'lb-btn-active' : ''}`}>
            VR Look Around
          </button>
        )}
      </div>

      {/* Content */}
      {vrMode && viewMode !== 'normal' ? (
        <VRProjectionView src={thumbSrc} crop={getCrop()} />
      ) : viewMode !== 'normal' ? (
        <div
          className="split-wrap"
          style={imgSize ? {
            width: viewMode === 'split-v' ? imgSize.w / 2 : imgSize.w,
            height: viewMode === 'split-h' ? imgSize.h / 2 : imgSize.h,
          } : undefined}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <img
            ref={splitImgRef}
            src={thumbSrc}
            alt={`${video.filename} thumbnail ${index + 1}`}
            className="split-img"
            style={{ transform: imageTransform, cursor: imageCursor }}
            draggable={false}
            onLoad={() => {
              const el = splitImgRef.current;
              if (el) setImgSize({ w: el.offsetWidth, h: el.offsetHeight });
            }}
          />
        </div>
      ) : (
        <img
          src={thumbSrc}
          alt={`${video.filename} thumbnail ${index + 1}`}
          style={{ transform: imageTransform, cursor: imageCursor }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          draggable={false}
        />
      )}

      {/* Navigation dots */}
      <div className="lightbox-nav">
        {Array.from({ length: thumbCount }, (_, i) => (
          <button
            key={i}
            className={i === index ? 'active' : ''}
            onClick={(e) => { e.stopPropagation(); changeIndex(i); }}
          />
        ))}
      </div>

      <div className="lightbox-info">
        {video.filename} &mdash; {index + 1}/{thumbCount}
        {vrMode
          ? ' \u2014 Drag to look around, scroll to zoom FOV'
          : ' \u2014 Scroll to zoom, drag to pan, arrow keys to navigate'}
      </div>
    </div>
  );
}
