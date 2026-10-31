import { useState, useEffect, useCallback, useRef } from 'react';
import api, { Video, VideoListResponse, SortField, SortOrder } from './api';
import FolderPicker from './components/FolderPicker';
import VideoCard from './components/VideoCard';
import VideoListRow from './components/VideoListRow';
import LightboxView from './components/LightboxView';
import './vr.css';

interface ScanState {
  phase: 'idle' | 'walking' | 'indexing' | 'probing' | 'thumbnails' | 'done';
  message: string;
  probeProgress?: { done: number; total: number };
  thumbProgress?: { done: number; total: number };
}

type ViewMode = 'grid' | 'list';
type Modal = null | 'delete' | 'rename' | 'move';

export default function VrApp() {
  const [folderId, setFolderId] = useState<number | undefined>();
  const [folderPath, setFolderPath] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ video: Video; index: number } | null>(null);
  const [scan, setScan] = useState<ScanState>({ phase: 'idle', message: '' });

  // Sort & view — persist in localStorage
  const [sortField, setSortField] = useState<SortField>(() => (localStorage.getItem('sortField') as SortField) || 'filename');
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => (localStorage.getItem('sortOrder') as SortOrder) || 'asc');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('viewMode') as ViewMode) || 'grid');

  useEffect(() => { localStorage.setItem('sortField', sortField); }, [sortField]);
  useEffect(() => { localStorage.setItem('sortOrder', sortOrder); }, [sortOrder]);
  useEffect(() => { localStorage.setItem('viewMode', viewMode); }, [viewMode]);

  // Modal state for list-view actions
  const [modalVideo, setModalVideo] = useState<Video | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [modalInput, setModalInput] = useState('');
  const [modalLoading, setModalLoading] = useState(false);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const removeMoveHistoryEntry = async (path: string) => {
    setHistoryBusy(path);
    try {
      await api.deleteMoveHistoryEntry(path);
      await loadMoveHistory();
    } finally {
      setHistoryBusy(null);
    }
  };

  // Search filter — runs server-side so total/pages reflect the filtered set.
  // searchInput is the live input value; debouncedQuery is what we send.
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchInput), 200);
    return () => clearTimeout(id);
  }, [searchInput]);
  // Reset to first page whenever the active query changes.
  useEffect(() => { setPage(1); }, [debouncedQuery]);

  // Track which videos are currently being probed/thumbnailed
  const [probingIds, setProbingIds] = useState<Set<number>>(new Set());
  const [thumbingIds, setThumbingIds] = useState<Set<number>>(new Set());

  const limit = 50;
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  const sortFieldRef = useRef(sortField);
  sortFieldRef.current = sortField;
  const sortOrderRef = useRef(sortOrder);
  sortOrderRef.current = sortOrder;
  const queryRef = useRef(debouncedQuery);
  queryRef.current = debouncedQuery;

  const loadVideos = useCallback(async (fid?: number) => {
    const id = fid ?? folderIdRef.current;
    if (!id) return;
    const data = await api.getVideos(id, page, limit, sortFieldRef.current, sortOrderRef.current, queryRef.current);
    setVideos(data.videos);
    setTotal(data.total);
  }, [page]);

  const loadMoveHistory = useCallback(async () => {
    const h = await api.getMoveHistory();
    setMoveHistory(h);
  }, []);

  // Load move history once
  useEffect(() => { loadMoveHistory(); }, [loadMoveHistory]);

  // Load videos when folder/page/sort/query changes
  useEffect(() => {
    if (folderId) loadVideos(folderId);
  }, [folderId, loadVideos, sortField, sortOrder, debouncedQuery]);

  // Scroll to top when page changes
  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  // When folder is selected, remember its path
  const handleFolderScanned = useCallback((fid?: number) => {
    setFolderId(fid);
    if (fid) {
      api.getFolders().then(folders => {
        const f = folders.find(f => f.id === fid);
        if (f) setFolderPath(f.path);
      });
    }
  }, []);

  // Subscribe to SSE
  useEffect(() => {
    const unsub = api.subscribeEvents({
      'scan:status': (data) => {
        if (data.phase === 'walking') {
          setScan({ phase: 'walking', message: `Scanning folder...` });
        } else if (data.phase === 'indexing') {
          setScan({ phase: 'indexing', message: `Found ${data.total} video files, indexing...` });
        }
      },
      'scan:indexed': (data) => {
        setScan({ phase: 'probing', message: `Indexed ${data.total} files (${data.newVideos} new). Probing metadata...` });
        loadVideos(data.folderId);
      },
      'probe:status': (data) => {
        if (data.done === data.total && data.total > 0) {
          setScan(s => ({ ...s, phase: 'thumbnails', message: 'Metadata complete. Generating thumbnails...', probeProgress: undefined }));
          setProbingIds(new Set());
        } else if (data.total > 0) {
          setScan(s => ({ ...s, phase: 'probing', probeProgress: { done: data.done, total: data.total } }));
        }
      },
      'probe:start': (data) => {
        setProbingIds(s => new Set(s).add(data.videoId));
        setScan(s => ({
          ...s,
          phase: 'probing',
          message: `Probing metadata: ${data.index + 1}/${data.total} — ${data.filename}`,
          probeProgress: { done: data.index, total: data.total },
        }));
      },
      'probe:done': (data) => {
        setProbingIds(s => { const n = new Set(s); n.delete(data.videoId); return n; });
        loadVideos();
      },
      'thumb:status': (data) => {
        if (!data.running && data.done === data.total) {
          setScan(s => s.phase === 'idle' ? s : { phase: 'done', message: `All done! ${data.total} videos processed.`, thumbProgress: undefined });
          setThumbingIds(new Set());
          loadVideos();
          setTimeout(() => setScan(s => s.phase === 'done' ? { phase: 'idle', message: '' } : s), 4000);
        } else if (data.running) {
          setScan(s => ({ ...s, phase: 'thumbnails', thumbProgress: { done: data.done, total: data.total } }));
        }
      },
      'thumb:video-start': (data) => {
        setThumbingIds(s => new Set(s).add(data.videoId));
        setScan(s => ({
          ...s,
          phase: 'thumbnails',
          message: `Generating thumbnails: ${data.done + 1}/${data.total} — ${data.filename}`,
          thumbProgress: { done: data.done, total: data.total },
        }));
      },
      'thumb:generated': () => {
        loadVideos();
      },
    });
    return unsub;
  }, [loadVideos]);

  // Modal actions (shared between grid and list view)
  const openModal = (video: Video, type: 'rename' | 'move' | 'delete') => {
    setModalVideo(video);
    setModal(type);
    if (type === 'rename') setModalInput(video.filename);
    else if (type === 'move') setModalInput(moveHistory[0] || '');
    else setModalInput('');
  };

  const handleModalConfirm = async () => {
    if (!modalVideo) return;
    setModalLoading(true);
    try {
      if (modal === 'delete') await api.deleteVideo(modalVideo.id);
      else if (modal === 'rename') await api.renameVideo(modalVideo.id, modalInput);
      else if (modal === 'move') {
        await api.moveVideo(modalVideo.id, modalInput);
        loadMoveHistory();
      }
      setModal(null);
      setModalVideo(null);
      loadVideos();
    } finally {
      setModalLoading(false);
    }
  };

  const handleLightboxAction = async () => {
    loadVideos();
    loadMoveHistory();
  };

  const toggleSortOrder = () => { setSortOrder(o => o === 'asc' ? 'desc' : 'asc'); setPage(1); };
  const handleSortField = (field: SortField) => { setSortField(field); setPage(1); };
  const handleListSort = (field: SortField) => {
    if (field === sortField) toggleSortOrder();
    else { setSortField(field); setSortOrder('asc'); setPage(1); }
  };

  const sortArrow = (field: SortField) => field === sortField ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPages = Math.ceil(total / limit);

  // Navigate lightbox to next/prev video
  const handleLightboxNavigate = (videoId: number) => {
    const v = videos.find(v => v.id === videoId);
    if (v && v.thumbs.length > 0) {
      const sorted = [...v.thumbs].sort((a, b) => a.index - b.index);
      setLightbox({ video: v, index: sorted[0].index });
    }
  };

  return (
    <div className="vr-root">
    <div className="app">
      <div className="header">
        <h1>VR File Manager</h1>
        <FolderPicker
          onScanned={handleFolderScanned}
          disabled={scan.phase !== 'idle' && scan.phase !== 'done'}
        />
      </div>

      {scan.phase !== 'idle' && (
        <div className={`status-bar ${scan.phase === 'done' ? 'status-done' : 'status-active'}`}>
          <div className="status-content">
            {scan.phase !== 'done' && <span className="spinner" />}
            <span>{scan.message}</span>
          </div>
          {scan.probeProgress && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${(scan.probeProgress.done / scan.probeProgress.total) * 100}%` }} />
            </div>
          )}
          {scan.thumbProgress && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${(scan.thumbProgress.done / scan.thumbProgress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {!folderId ? (
        <div className="empty-state">
          <p>Enter a folder path above and click Scan to get started.</p>
          <p>Or select a previously scanned folder from the dropdown.</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="empty-state">
          {scan.phase !== 'idle' && scan.phase !== 'done'
            ? <p>Scanning in progress...</p>
            : <p>No videos found in this folder.</p>}
        </div>
      ) : (
        <>
          {/* Sort bar */}
          <div className="sort-bar">
            <span className="video-count">
              {debouncedQuery ? `${total} matching` : `${total} videos`}
            </span>
            <div className="search-box">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Filter..."
                className="search-input"
              />
              {searchInput && (
                <button className="search-clear" onClick={() => setSearchInput('')}>x</button>
              )}
            </div>
            <div className="sort-controls">
              <label>Sort:</label>
              <select value={sortField} onChange={e => handleSortField(e.target.value as SortField)}>
                <option value="filename">Filename</option>
                <option value="path">Path</option>
                <option value="size_bytes">Size</option>
                <option value="created_at">Date</option>
              </select>
              <button className="sort-order-btn" onClick={toggleSortOrder}>
                {sortOrder === 'asc' ? '▲ Asc' : '▼ Desc'}
              </button>
              <div className="view-toggle">
                <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>Grid</button>
                <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
              </div>
              <button
                className="settings-btn"
                title="Settings"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                ⚙
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="video-grid">
              {videos.map(v => (
                <VideoCard
                  key={v.id}
                  video={v}
                  folderPath={folderPath}
                  moveHistory={moveHistory}
                  isProbing={probingIds.has(v.id)}
                  isThumbing={thumbingIds.has(v.id)}
                  onAction={() => { loadVideos(); loadMoveHistory(); }}
                  onThumbClick={(video, index) => setLightbox({ video, index })}
                />
              ))}
            </div>
          ) : (
            <div className="video-list-wrap">
              <table className="video-list">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}></th>
                    <th className="sortable" onClick={() => handleListSort('filename')}>Filename{sortArrow('filename')}</th>
                    <th className="sortable" onClick={() => handleListSort('path')}>Folder{sortArrow('path')}</th>
                    <th>Duration</th>
                    <th className="sortable" onClick={() => handleListSort('size_bytes')}>Size{sortArrow('size_bytes')}</th>
                    <th className="sortable" onClick={() => handleListSort('created_at')}>Date{sortArrow('created_at')}</th>
                    <th style={{ width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map(v => (
                    <VideoListRow
                      key={v.id}
                      video={v}
                      folderPath={folderPath}
                      isProbing={probingIds.has(v.id)}
                      isThumbing={thumbingIds.has(v.id)}
                      onAction={() => { loadVideos(); loadMoveHistory(); }}
                      onThumbClick={(video, index) => setLightbox({ video, index })}
                      onOpenActions={openModal}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ padding: '8px', color: '#888' }}>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {lightbox && (
        <LightboxView
          video={lightbox.video}
          videos={videos}
          folderPath={folderPath}
          moveHistory={moveHistory}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onAction={handleLightboxAction}
          onNavigate={handleLightboxNavigate}
        />
      )}

      {/* Shared modal for list-view actions */}
      {modal && modalVideo && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>
              {modal === 'delete' && 'Delete Video'}
              {modal === 'rename' && 'Rename Video'}
              {modal === 'move' && 'Move Video'}
            </h3>
            {modal === 'delete' ? (
              <p style={{ marginBottom: 16, color: '#cc8888' }}>
                Permanently delete <strong>{modalVideo.filename}</strong> from disk?
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

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
            <h3>Settings</h3>
            <section className="settings-section">
              <h4>Recently moved to</h4>
              <p className="settings-help">
                Folders that appear as quick picks in the Move dialog. Delete entries you added by mistake.
              </p>
              {moveHistory.length === 0 ? (
                <p className="settings-empty">No recent move destinations.</p>
              ) : (
                <ul className="history-list">
                  {moveHistory.map(h => (
                    <li key={h}>
                      <span className="history-path" title={h}>{h}</span>
                      <button
                        className="history-remove"
                        disabled={historyBusy === h}
                        onClick={() => removeMoveHistoryEntry(h)}
                        title="Remove from history"
                        aria-label={`Remove ${h}`}
                      >
                        {historyBusy === h ? '…' : '×'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="modal-actions">
              <button onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
