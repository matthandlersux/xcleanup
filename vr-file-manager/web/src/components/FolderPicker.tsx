import { useState, useEffect, useRef } from 'react';
import api, { Folder } from '../api.js';

interface Props {
  onScanned: (folderId?: number) => void;
  onAutoScanStarted?: (folderId: number) => void;
  disabled?: boolean;
}

let autoScannedOnce = false;

export default function FolderPicker({ onScanned, onAutoScanStarted, disabled }: Props) {
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    api.getFolders().then(loaded => {
      setFolders(loaded);
      if (loaded.length > 0) {
        // Prefer the folder the user last selected (localStorage), fall back to most recent
        const savedId = localStorage.getItem('selectedFolderId');
        const match = savedId ? loaded.find(f => f.id === Number(savedId)) : null;
        const pick = match || loaded[0];
        setSelectedFolderId(String(pick.id));
        setPath(pick.path);
        onScanned(pick.id);
        // Fire-and-forget auto-scan — only once per page load
        if (!autoScannedOnce) {
          autoScannedOnce = true;
          if (onAutoScanStarted) onAutoScanStarted(pick.id);
          api.autoScan().catch(() => {});
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    if (!path.trim() || scanning) return;
    setScanning(true);
    setError('');
    try {
      const result = await api.scanFolder(path.trim());
      const updated = await api.getFolders();
      setFolders(updated);
      setSelectedFolderId(String(result.folderId));
      localStorage.setItem('selectedFolderId', String(result.folderId));
      onScanned(result.folderId);
    } catch (e: any) {
      setError(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    if (folderId === '') {
      localStorage.removeItem('selectedFolderId');
      onScanned(undefined);
    } else {
      localStorage.setItem('selectedFolderId', folderId);
      const f = folders.find(f => f.id === Number(folderId));
      if (f) {
        setPath(f.path);
        onScanned(f.id);
      }
    }
  };

  return (
    <div className="folder-picker">
      {folders.length > 0 && (
        <select onChange={e => selectFolder(e.target.value)} value={selectedFolderId} disabled={disabled}>
          <option value="">Previous folders...</option>
          {folders.map(f => (
            <option key={f.id} value={f.id}>{f.path}</option>
          ))}
        </select>
      )}
      <input
        value={path}
        onChange={e => setPath(e.target.value)}
        placeholder="Enter folder path (e.g. /mnt/vr-videos)"
        onKeyDown={e => e.key === 'Enter' && scan()}
        disabled={disabled}
      />
      <button onClick={scan} disabled={scanning || disabled}>
        {scanning ? 'Scanning...' : 'Scan'}
      </button>
      {error && <div className="scan-error">{error}</div>}
    </div>
  );
}
