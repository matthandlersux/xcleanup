import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db.js';
import { probeVideo } from './ffmpeg.js';
import { emit } from '../events.js';
import { computeThumbHash } from './thumbHash.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm']);

async function walkVideos(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const videos: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const parentPath = (entry as any).parentPath ?? (entry as any).path ?? dir;
      videos.push(path.join(parentPath, entry.name));
    }
  }
  return videos;
}

/** Fast pass: walk directory and insert files into DB without probing. Returns folder ID. */
export async function indexFolder(folderPath: string, logger: any): Promise<{ folderId: number; total: number; newVideos: number; removed: number }> {
  const db = getDb();
  const absPath = path.resolve(folderPath);

  db.prepare(`INSERT INTO folders (path, last_scanned_at) VALUES (?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET last_scanned_at = datetime('now')`).run(absPath);
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(absPath) as { id: number };

  logger.info({ path: absPath }, 'Walking directory');
  emit('scan:status', { phase: 'walking', folder: absPath });

  const videoPaths = await walkVideos(absPath);
  const videoPathSet = new Set(videoPaths);

  logger.info({ count: videoPaths.length }, 'Found video files');
  emit('scan:status', { phase: 'indexing', total: videoPaths.length });

  let newVideos = 0;
  const insertStmt = db.prepare('INSERT OR IGNORE INTO videos (folder_id, filename, path, size_bytes, thumb_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const updateHashStmt = db.prepare('UPDATE videos SET size_bytes = COALESCE(size_bytes, ?), thumb_hash = ? WHERE path = ? AND thumb_hash IS NULL');

  for (const vp of videoPaths) {
    const filename = path.basename(vp);
    let sizeBytes: number | null = null;
    let thumbHash: string | null = null;
    let createdAt: string | null = null;
    try {
      const stat = await fs.stat(vp);
      sizeBytes = stat.size;
      thumbHash = computeThumbHash(filename, sizeBytes);
      // Use birthtime (file creation) if available, fall back to mtime
      const fileTime = stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime;
      createdAt = fileTime.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    } catch {}

    const result = insertStmt.run(folder.id, filename, vp, sizeBytes, thumbHash, createdAt);
    if (result.changes > 0) {
      newVideos++;
    } else if (thumbHash) {
      // Existing video without thumb_hash — update it
      updateHashStmt.run(sizeBytes, thumbHash, vp);
    }
  }

  // Mark missing videos as deleted, unmark returned ones
  const allDbVideos = db.prepare('SELECT id, path FROM videos WHERE folder_id = ?').all(folder.id) as { id: number; path: string }[];
  const markDeletedStmt = db.prepare('UPDATE videos SET deleted = 1 WHERE id = ?');
  const undeleteStmt = db.prepare('UPDATE videos SET deleted = 0 WHERE id = ? AND deleted = 1');
  let removed = 0;
  for (const v of allDbVideos) {
    if (!videoPathSet.has(v.path)) {
      markDeletedStmt.run(v.id);
      removed++;
    } else {
      undeleteStmt.run(v.id);
    }
  }

  // Recover thumbnails from disk for videos that have a thumb_hash but no DB thumbnails
  const thumbsDir = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), '..', 'thumbnails');
  const videosWithHash = db.prepare(
    `SELECT v.id, v.thumb_hash FROM videos v
     WHERE v.folder_id = ? AND v.deleted = 0 AND v.thumb_hash IS NOT NULL
     AND (SELECT COUNT(*) FROM thumbnails t WHERE t.video_id = v.id) = 0`
  ).all(folder.id) as { id: number; thumb_hash: string }[];

  const recoverThumbStmt = db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)');
  for (const v of videosWithHash) {
    const hashDir = path.join(thumbsDir, v.thumb_hash);
    try {
      const files = await fs.readdir(hashDir);
      const jpgs = files.filter(f => f.endsWith('.jpg')).sort();
      for (let i = 0; i < jpgs.length; i++) {
        const tsMatch = jpgs[i].match(/^(.+)\.jpg$/);
        if (!tsMatch) continue;
        const timestampSecs = parseFloat(tsMatch[1]);
        if (isNaN(timestampSecs)) continue;
        recoverThumbStmt.run(v.id, i, timestampSecs, path.join(hashDir, jpgs[i]));
      }
      if (jpgs.length > 0) {
        logger.info({ videoId: v.id, count: jpgs.length }, 'Recovered thumbnails from disk');
      }
    } catch {
      // No thumbnail dir on disk — skip
    }
  }

  logger.info({ newVideos, removed, total: videoPaths.length }, 'Indexing complete');
  emit('scan:indexed', { folderId: folder.id, total: videoPaths.length, newVideos, removed });

  return { folderId: folder.id, total: videoPaths.length, newVideos, removed };
}

/** Background pass: probe metadata for videos that don't have it yet. */
export async function probeAllMetadata(folderId: number, logger: any): Promise<void> {
  const db = getDb();
  const unprobed = db.prepare(
    'SELECT id, path, filename FROM videos WHERE folder_id = ? AND deleted = 0 AND duration_secs IS NULL'
  ).all(folderId) as { id: number; path: string; filename: string }[];

  if (unprobed.length === 0) return;

  logger.info({ count: unprobed.length }, 'Probing video metadata');
  emit('probe:status', { total: unprobed.length, done: 0 });

  const updateStmt = db.prepare(
    'UPDATE videos SET size_bytes = ?, duration_secs = ?, width = ?, height = ?, codec = ? WHERE id = ?'
  );

  for (let i = 0; i < unprobed.length; i++) {
    const v = unprobed[i];
    emit('probe:start', { videoId: v.id, filename: v.filename, index: i, total: unprobed.length });
    try {
      const meta = await probeVideo(v.path);
      updateStmt.run(meta.size, meta.duration, meta.width, meta.height, meta.codec, v.id);
      logger.info({ file: v.filename, duration: meta.duration }, 'Probed');
      emit('probe:done', { videoId: v.id, index: i, total: unprobed.length, meta });
    } catch (e) {
      logger.error({ file: v.filename, err: e }, 'Probe failed');
      emit('probe:done', { videoId: v.id, index: i, total: unprobed.length, error: true });
    }
  }

  emit('probe:status', { total: unprobed.length, done: unprobed.length });
  logger.info('All metadata probed');
}
