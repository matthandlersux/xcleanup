import { useState, useCallback, useEffect, useRef } from 'react';
import api, { Video } from '../api.js';
import VRProjectionView from './VRProjectionView.js';

type LBViewMode = 'normal' | 'split-h' | 'split-v';
type Modal = null | 'delete' | 'rename' | 'move';

interface Props {
  video: Video;
  videos: Video[];
  folderPath: string;
  moveHistory: string[];
  initialIndex: number;
  onClose: () => void;
  onAction: () => void;
  onNavigate: (videoId: number) => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString();
}

function getParentFolder(videoPath: string, folderPath: string): string {
  const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
  if (videoDir === folderPath || videoDir.length <= folderPath.length) return '';
  return videoDir.substring(folderPath.length + 1);
}

export default function LightboxView({ video: initialVideo, videos, folderPath, moveHistory, initialIndex, onClose, onAction, onNavigate }: Props) {
  const [currentVideoId, setCurrentVideoId] = useState(initialVideo.id);
  const video = videos.find(v => v.id === currentVideoId) || initialVideo;

  const sortedThumbs = [...video.thumbs].sort((a, b) => a.index - b.index);
  // Find thumb index matching initialIndex or default to 0
  const startThumbIdx = sortedThumbs.findIndex(t => t.index === initialIndex);
  const [thumbIdx, setThumbIdx] = useState(Math.max(0, startThumbIdx));

  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const defaultViewMode = video.stereo_mode === 'tb' ? 'split-h' : 'split-v';
  const [viewMode, setViewMode] = useState<LBViewMode>(defaultViewMode);
  const [vrMode, setVrMode] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const splitImgRef = useRef<HTMLImageElement>(null);

  // Modal state
  const [modal, setModal] = useState<Modal>(null);
  const [modalInput, setModalInput] = useState('');
  const [modalLoading, setModalLoading] = useState(false);

  // More screenshots state
  const [generatingMore, setGeneratingMore] = useState(false);

  const thumbCount = sortedThumbs.length;
  const currentThumb = sortedThumbs[thumbIdx];
  const thumbSrc = currentThumb ? api.thumbUrl(currentThumb) : '';

  const parentFolder = getParentFolder(video.path, folderPath);

  const resetView = () => { setScale(1); setTranslate({ x: 0, y: 0 }); setImgSize(null); };

  const changeThumb = (newIdx: number) => {
    setThumbIdx(newIdx);
    resetView();
  };

  const setMode = (mode: LBViewMode) => {
    setViewMode(mode);
    if (mode === 'normal') setVrMode(false);
    resetView();
    // Save stereo mode preference
    if (mode === 'split-v') api.setStereoMode(video.id, 'sbs');
    else if (mode === 'split-h') api.setStereoMode(video.id, 'tb');
  };

  // Navigate to next/prev video
  const videoIndex = videos.findIndex(v => v.id === currentVideoId);

  const goToVideo = (direction: -1 | 1) => {
    const newIdx = videoIndex + direction;
    if (newIdx < 0 || newIdx >= videos.length) return;
    const newVideo = videos[newIdx];
    setCurrentVideoId(newVideo.id);
    setThumbIdx(0);
    resetView();
    const newViewMode = newVideo.stereo_mode === 'tb' ? 'split-h' : 'split-v';
    setViewMode(newViewMode);
    onNavigate(newVideo.id);
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setScale(s => Math.max(0.5, Math.min(8, s - e.deltaY * 0.002)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) return; // Don't navigate while modal is open
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goToVideo(-1);
      if (e.key === 'ArrowRight') goToVideo(1);
      if (e.key === 'ArrowUp') { e.preventDefault(); changeThumb(Math.max(0, thumbIdx - 1)); }
      if (e.key === 'ArrowDown') { e.preventDefault(); changeThumb(Math.min(thumbCount - 1, thumbIdx + 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Drag to pan when zoomed
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

  // Touch swipe for mobile navigation
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    if (modal || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || modal) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    // Only count as swipe if fast enough and long enough
    if (dt > 500) return;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const minSwipe = 50;

    if (absDx > absDy && absDx > minSwipe) {
      // Horizontal swipe — navigate videos
      if (dx < 0) goToVideo(1);
      else goToVideo(-1);
    } else if (absDy > absDx && absDy > minSwipe) {
      // Vertical swipe — navigate thumbnails
      if (dy < 0) changeThumb(Math.min(thumbCount - 1, thumbIdx + 1));
      else changeThumb(Math.max(0, thumbIdx - 1));
    }
  };

  const getCrop = (): 'full' | 'left' | 'top' => {
    if (viewMode === 'split-v') return 'left';
    if (viewMode === 'split-h') return 'top';
    return 'full';
  };

  const imageTransform = `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`;
  const imageCursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';

  // Modal actions
  const openModal = (type: Modal) => {
    if (type === 'rename') setModalInput(video.filename);
    else if (type === 'move') setModalInput(moveHistory[0] || '');
    else setModalInput('');
    setModal(type);
  };

  const handleModalConfirm = async () => {
    setModalLoading(true);
    try {
      if (modal === 'delete') {
        await api.deleteVideo(video.id);
        onAction();
        // Navigate to next video or close
        if (videos.length <= 1) { onClose(); return; }
        const nextIdx = videoIndex < videos.length - 1 ? videoIndex + 1 : videoIndex - 1;
        const nextVideo = videos[nextIdx];
        if (nextVideo) {
          setCurrentVideoId(nextVideo.id);
          setThumbIdx(0);
          resetView();
          onNavigate(nextVideo.id);
        } else {
          onClose();
        }
      } else if (modal === 'rename') {
        await api.renameVideo(video.id, modalInput);
        onAction();
      } else if (modal === 'move') {
        await api.moveVideo(video.id, modalInput);
        onAction();
        // Navigate to next video after move
        if (videos.length <= 1) { onClose(); return; }
        const nextIdx = videoIndex < videos.length - 1 ? videoIndex + 1 : videoIndex - 1;
        const nextVideo = videos[nextIdx];
        if (nextVideo) {
          setCurrentVideoId(nextVideo.id);
          setThumbIdx(0);
          resetView();
          onNavigate(nextVideo.id);
        } else {
          onClose();
        }
      }
      setModal(null);
    } finally {
      setModalLoading(false);
    }
  };

  const handleMoreScreenshots = async () => {
    setGeneratingMore(true);
    try {
      await api.requestMoreThumbnails(video.id, 15);
    } catch {}
    // SSE events will update the thumbs — keep button in "generating" state briefly
    setTimeout(() => setGeneratingMore(false), 3000);
  };

  return (
    <div
      className="lightbox-overlay"
      onClick={e => { if (e.target === e.currentTarget && !modal) onClose(); }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Desktop toolbar */}
      <div className="lightbox-toolbar lightbox-toolbar--desktop" onClick={e => e.stopPropagation()}>
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
        <span className="lb-separator" />
        <button className="lb-btn" onClick={() => openModal('rename')}>Rename</button>
        <button className="lb-btn" onClick={() => openModal('move')}>Move</button>
        <button className="lb-btn lb-btn-danger" onClick={() => openModal('delete')}>Delete</button>
        <span className="lb-separator" />
        <button
          className="lb-btn"
          onClick={handleMoreScreenshots}
          disabled={generatingMore}
        >
          {generatingMore ? 'Generating...' : 'More Screenshots'}
        </button>
      </div>

      {/* Mobile toolbar — compact top bar + expandable menu */}
      <div className="lightbox-toolbar lightbox-toolbar--mobile" onClick={e => e.stopPropagation()}>
        <button className="lb-btn" onClick={onClose}>Close</button>
        <div className="mobile-view-btns">
          <button onClick={() => setMode('normal')} className={`lb-btn ${viewMode === 'normal' ? 'lb-btn-active' : ''}`}>N</button>
          <button onClick={() => setMode('split-v')} className={`lb-btn ${viewMode === 'split-v' ? 'lb-btn-active' : ''}`}>SBS</button>
          <button onClick={() => setMode('split-h')} className={`lb-btn ${viewMode === 'split-h' ? 'lb-btn-active' : ''}`}>TB</button>
        </div>
        <button className="lb-btn" onClick={() => setShowMobileMenu(m => !m)}>
          {showMobileMenu ? 'Less' : 'More'}
        </button>
      </div>
      {showMobileMenu && (
        <div className="mobile-action-menu" onClick={e => e.stopPropagation()}>
          {viewMode !== 'normal' && (
            <button className={`lb-btn ${vrMode ? 'lb-btn-active' : ''}`} onClick={() => { setVrMode(v => !v); resetView(); }}>VR Look Around</button>
          )}
          <button className="lb-btn" onClick={() => { openModal('rename'); setShowMobileMenu(false); }}>Rename</button>
          <button className="lb-btn" onClick={() => { openModal('move'); setShowMobileMenu(false); }}>Move</button>
          <button className="lb-btn lb-btn-danger" onClick={() => { openModal('delete'); setShowMobileMenu(false); }}>Delete</button>
          <button className="lb-btn" onClick={() => { handleMoreScreenshots(); setShowMobileMenu(false); }} disabled={generatingMore}>
            {generatingMore ? 'Generating...' : 'More Screenshots'}
          </button>
        </div>
      )}

      {/* Video navigation arrows */}
      {videoIndex > 0 && (
        <button className="lb-nav-arrow lb-nav-left" onClick={e => { e.stopPropagation(); goToVideo(-1); }}>&#8249;</button>
      )}
      {videoIndex < videos.length - 1 && (
        <button className="lb-nav-arrow lb-nav-right" onClick={e => { e.stopPropagation(); goToVideo(1); }}>&#8250;</button>
      )}

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
            alt={`${video.filename} thumbnail ${thumbIdx + 1}`}
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
          alt={`${video.filename} thumbnail ${thumbIdx + 1}`}
          style={{ transform: imageTransform, cursor: imageCursor }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          draggable={false}
        />
      )}

      {/* Thumbnail navigation dots */}
      {thumbCount > 0 && (
        <div className="lightbox-nav">
          {sortedThumbs.map((t, i) => (
            <button
              key={t.index}
              className={i === thumbIdx ? 'active' : ''}
              onClick={(e) => { e.stopPropagation(); changeThumb(i); }}
            />
          ))}
        </div>
      )}

      <div className="lightbox-info">
        <strong>{video.filename}</strong>
        {' '}&mdash; {thumbIdx + 1}/{thumbCount}
        {parentFolder && <> &mdash; {parentFolder}</>}
        {video.created_at && <> &mdash; {formatDate(video.created_at)}</>}
        {' '}&mdash; {videoIndex + 1}/{videos.length}
        <span className="lightbox-hint-desktop">
          {vrMode
            ? ' \u2014 Drag to look around, scroll to zoom FOV'
            : ' \u2014 \u2190/\u2192 videos, \u2191/\u2193 thumbs, scroll zoom'}
        </span>
        <span className="lightbox-hint-mobile"> &mdash; Swipe to navigate</span>
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={e => { e.stopPropagation(); setModal(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>
              {modal === 'delete' && 'Delete Video'}
              {modal === 'rename' && 'Rename Video'}
              {modal === 'move' && 'Move Video'}
            </h3>
            {modal === 'delete' ? (
              <p style={{ marginBottom: 16, color: '#cc8888' }}>
                Permanently delete <strong>{video.filename}</strong> from disk?
              </p>
            ) : (
              <>
                {modal === 'move' && moveHistory.length > 0 && (
                  <div className="move-history-picks">
                    {moveHistory.map(h => (
                      <button key={h} className="history-pick" onClick={() => setModalInput(h)}>{h}</button>
                    ))}
                  </div>
                )}
                <input
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  placeholder={modal === 'rename' ? 'New filename' : 'Destination folder path'}
                  onKeyDown={e => e.key === 'Enter' && handleModalConfirm()}
                  autoFocus
                />
              </>
            )}
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className={modal === 'delete' ? 'danger' : ''}
                onClick={handleModalConfirm}
                disabled={modalLoading}
              >
                {modalLoading ? 'Working...' : modal === 'delete' ? 'Delete' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
