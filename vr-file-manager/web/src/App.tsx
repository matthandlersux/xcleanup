import { useState, useEffect, useCallback, useRef } from 'react';
import api, { Video, VideoListResponse } from './api.js';
import FolderPicker from './components/FolderPicker.js';
import VideoCard from './components/VideoCard.js';
import LightboxView from './components/LightboxView.js';

interface ScanState {
  phase: 'idle' | 'walking' | 'indexing' | 'probing' | 'thumbnails' | 'done';
  message: string;
  probeProgress?: { done: number; total: number };
  thumbProgress?: { done: number; total: number };
}

export default function App() {
  const [folderId, setFolderId] = useState<number | undefined>();
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lastMoveFolder, setLastMoveFolder] = useState('');
  const [lightbox, setLightbox] = useState<{ video: Video; index: number } | null>(null);
  const [scan, setScan] = useState<ScanState>({ phase: 'idle', message: '' });

  // Track which videos are currently being probed/thumbnailed
  const [probingIds, setProbingIds] = useState<Set<number>>(new Set());
  const [thumbingIds, setThumbingIds] = useState<Set<number>>(new Set());

  const limit = 50;
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;

  const loadVideos = useCallback(async (fid?: number) => {
    const id = fid ?? folderIdRef.current;
    if (!id) return;
    const data = await api.getVideos(id, page, limit);
    setVideos(data.videos);
    setTotal(data.total);
  }, [page]);

  // Load settings once
  useEffect(() => {
    api.getSettings().then(s => {
      if (s.last_move_folder) setLastMoveFolder(s.last_move_folder);
    });
  }, []);

  // Load videos when folder/page changes
  useEffect(() => {
    if (folderId) loadVideos(folderId);
  }, [folderId, loadVideos]);

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
        // Refresh the video list to get updated metadata
        loadVideos();
      },
      'thumb:status': (data) => {
        if (!data.running && data.done === data.total) {
          setScan(s => s.phase === 'idle' ? s : { phase: 'done', message: `All done! ${data.total} videos processed.`, thumbProgress: undefined });
          setThumbingIds(new Set());
          loadVideos();
          // Clear "done" after a few seconds
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
      'thumb:generated': (data) => {
        // Refresh to show new thumbnail
        loadVideos();
      },
    });
    return unsub;
  }, [loadVideos]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="app">
      <div className="header">
        <h1>VR File Manager</h1>
        <FolderPicker
          onScanned={setFolderId}
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
          <div className="video-count">{total} videos</div>
          <div className="video-grid">
            {videos.map(v => (
              <VideoCard
                key={v.id}
                video={v}
                lastMoveFolder={lastMoveFolder}
                isProbing={probingIds.has(v.id)}
                isThumbing={thumbingIds.has(v.id)}
                onAction={() => loadVideos()}
                onThumbClick={(video, index) => setLightbox({ video, index })}
              />
            ))}
          </div>
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
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
