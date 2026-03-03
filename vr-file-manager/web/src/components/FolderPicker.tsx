import { useState, useEffect } from 'react';
import api, { Folder } from '../api.js';

interface Props {
  onScanned: (folderId?: number) => void;
  disabled?: boolean;
}

export default function FolderPicker({ onScanned, disabled }: Props) {
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    api.getFolders().then(setFolders);
  }, []);

  const scan = async () => {
    if (!path.trim() || scanning) return;
    setScanning(true);
    try {
      const result = await api.scanFolder(path.trim());
      const updated = await api.getFolders();
      setFolders(updated);
      onScanned(result.folderId);
    } finally {
      setScanning(false);
    }
  };

  const selectFolder = (folderId: string) => {
    if (folderId === '') {
      onScanned(undefined);
    } else {
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
        <select onChange={e => selectFolder(e.target.value)} defaultValue="" disabled={disabled}>
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
    </div>
  );
}
