import { useState } from 'react';
import api, { Video } from '../api.js';

interface Props {
  video: Video;
  lastMoveFolder: string;
  isProbing: boolean;
  isThumbing: boolean;
  onAction: () => void;
  onThumbClick: (video: Video, index: number) => void;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatDuration(secs: number | null): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

type Modal = null | 'delete' | 'rename' | 'move';

export default function VideoCard({ video, lastMoveFolder, isProbing, isThumbing, onAction, onThumbClick }: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [thumbIdx, setThumbIdx] = useState(0);
  const sortedThumbs = [...video.thumbs].sort((a, b) => a.index - b.index);

  const openModal = (type: Modal) => {
    if (type === 'rename') setInputValue(video.filename);
    else if (type === 'move') setInputValue(lastMoveFolder);
    else setInputValue('');
    setModal(type);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (modal === 'delete') await api.deleteVideo(video.id);
      else if (modal === 'rename') await api.renameVideo(video.id, inputValue);
      else if (modal === 'move') await api.moveVideo(video.id, inputValue);
      setModal(null);
      onAction();
    } finally {
      setLoading(false);
    }
  };

  const hasAnyThumb = video.thumbs.length > 0;
  const isWorking = isProbing || isThumbing;

  return (
    <div className={`video-card ${isWorking ? 'card-working' : ''}`}>
      <div className="thumbs">
        {hasAnyThumb ? (
          <>
            <img
              src={api.thumbUrl(video.id, sortedThumbs[thumbIdx]?.index ?? 0)}
              alt={`Thumbnail ${thumbIdx + 1}`}
              onClick={() => onThumbClick(video, sortedThumbs[thumbIdx]?.index ?? 0)}
              loading="lazy"
            />
            {sortedThumbs.length > 1 && (
              <>
                <button className="thumb-prev" onClick={e => { e.stopPropagation(); setThumbIdx(i => (i - 1 + sortedThumbs.length) % sortedThumbs.length); }}>&#8249;</button>
                <button className="thumb-next" onClick={e => { e.stopPropagation(); setThumbIdx(i => (i + 1) % sortedThumbs.length); }}>&#8250;</button>
                <div className="thumb-dots">
                  {sortedThumbs.map((_, i) => (
                    <span key={i} className={`thumb-dot ${i === thumbIdx ? 'active' : ''}`} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="thumb-placeholder">
            {isProbing && <><span className="spinner" /> Probing metadata...</>}
            {isThumbing && <><span className="spinner" /> Generating thumbnails...</>}
            {!isProbing && !isThumbing && !video.duration_secs && <span className="waiting">Waiting for processing...</span>}
            {!isProbing && !isThumbing && video.duration_secs && <span className="waiting">Thumbnails pending...</span>}
          </div>
        )}
        {hasAnyThumb && isThumbing && (
          <div className="thumb-overlay">
            <span className="spinner" /> Generating...
          </div>
        )}
      </div>
      <div className="info">
        <div className="filename">{video.filename}</div>
        <div className="meta">
          {video.duration_secs ? <span>{formatDuration(video.duration_secs)}</span> : isProbing ? <span className="meta-pending">probing...</span> : null}
          {video.width && video.height && <span>{video.width}x{video.height}</span>}
          {video.size_bytes && <span>{formatSize(video.size_bytes)}</span>}
          {video.codec && <span>{video.codec}</span>}
        </div>
        <div className="actions">
          <button onClick={() => openModal('rename')}>Rename</button>
          <button onClick={() => openModal('move')}>Move</button>
          <button className="danger" onClick={() => openModal('delete')}>Delete</button>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
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
              <input
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={modal === 'rename' ? 'New filename' : 'Destination folder path'}
                onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                autoFocus
              />
            )}
            <div className="modal-actions">
              <button onClick={() => setModal(null)}>Cancel</button>
              <button
                className={modal === 'delete' ? 'danger' : ''}
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? 'Working...' : modal === 'delete' ? 'Delete' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
