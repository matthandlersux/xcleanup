import api, { Video } from '../api';

interface Props {
  video: Video;
  folderPath: string;
  isProbing: boolean;
  isThumbing: boolean;
  onAction: () => void;
  onThumbClick: (video: Video, index: number) => void;
  onOpenActions: (video: Video, action: 'rename' | 'move' | 'delete') => void;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatDuration(secs: number | null): string {
  if (!secs) return '-';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString();
}

function getParentFolder(videoPath: string, folderPath: string): string {
  const videoDir = videoPath.substring(0, videoPath.lastIndexOf('/'));
  if (videoDir === folderPath || videoDir.length <= folderPath.length) return '';
  return videoDir.substring(folderPath.length + 1);
}

export default function VideoListRow({ video, folderPath, isProbing, isThumbing, onAction, onThumbClick, onOpenActions }: Props) {
  const sortedThumbs = [...video.thumbs].sort((a, b) => a.index - b.index);
  const firstThumb = sortedThumbs[0];
  const parentFolder = getParentFolder(video.path, folderPath);
  const stereo = video.stereo_mode || 'sbs';

  return (
    <tr className={isProbing || isThumbing ? 'row-working' : ''}>
      <td className="list-thumb-cell">
        {firstThumb ? (
          <div className={`thumb-eye-crop thumb-eye-crop--${stereo}`}>
            <img
              src={api.thumbUrl(firstThumb)}
              alt={video.filename}
              onClick={() => onThumbClick(video, firstThumb.index)}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="list-thumb-placeholder">
            {isProbing ? '...' : isThumbing ? '...' : '-'}
          </div>
        )}
      </td>
      <td className="list-filename" onClick={() => firstThumb && onThumbClick(video, firstThumb.index)}>{video.filename}</td>
      <td>{parentFolder || '-'}</td>
      <td>{formatDuration(video.duration_secs)}</td>
      <td>{formatSize(video.size_bytes)}</td>
      <td>{formatDate(video.created_at)}</td>
      <td className="list-actions">
        <button onClick={() => onOpenActions(video, 'rename')}>Ren</button>
        <button onClick={() => onOpenActions(video, 'move')}>Mov</button>
        <button className="danger" onClick={() => onOpenActions(video, 'delete')}>Del</button>
      </td>
    </tr>
  );
}
