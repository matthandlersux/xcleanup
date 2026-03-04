import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';
import { generateThumbnail } from './ffmpeg.js';
import { emit } from '../events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = path.join(__dirname, '../../../thumbnails');
const THUMB_COUNT = 5;
const CONCURRENCY = 2;

let running = false;

export function isRunning() { return running; }

function formatTimestamp(secs: number): string {
  return secs.toFixed(2);
}

async function processVideo(videoId: number, videoPath: string, filename: string, duration: number, thumbHash: string | null, logger: any): Promise<void> {
  if (!thumbHash) return;

  const db = getDb();
  const existingThumbs = db.prepare('SELECT index_num, timestamp_secs FROM thumbnails WHERE video_id = ?').all(videoId) as { index_num: number; timestamp_secs: number }[];
  const existingTimestamps = new Set(existingThumbs.map(t => formatTimestamp(t.timestamp_secs)));

  const maxIndex = existingThumbs.reduce((max, t) => Math.max(max, t.index_num), -1);

  let nextIndex = maxIndex + 1;
  for (let i = 0; i < THUMB_COUNT; i++) {
    const timestamp = duration * (i + 1) / (THUMB_COUNT + 1);
    const tsStr = formatTimestamp(timestamp);
    if (existingTimestamps.has(tsStr)) continue;

    const outputPath = path.join(THUMBS_DIR, thumbHash, `${tsStr}.jpg`);

    try {
      await fs.access(outputPath);
      // File exists on disk but not in DB — register it
      db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)')
        .run(videoId, nextIndex++, timestamp, outputPath);
      emit('thumb:generated', { videoId, index: nextIndex - 1 });
      continue;
    } catch {
      // File doesn't exist, generate it
    }

    try {
      await generateThumbnail(videoPath, timestamp, outputPath);
      db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)')
        .run(videoId, nextIndex++, timestamp, outputPath);
      logger.info({ file: filename, timestamp: tsStr }, 'Generated thumbnail');
      emit('thumb:generated', { videoId, index: nextIndex - 1 });
    } catch (e) {
      logger.error({ file: filename, timestamp: tsStr, err: e }, 'Thumbnail failed');
    }
  }
}

export async function startThumbnailGeneration(logger: any): Promise<void> {
  if (running) return;

  const db = getDb();
  const videos = db.prepare(`
    SELECT v.id, v.path, v.filename, v.duration_secs, v.thumb_hash
    FROM videos v
    WHERE v.deleted = 0 AND v.duration_secs IS NOT NULL AND v.thumb_hash IS NOT NULL
    AND (SELECT COUNT(*) FROM thumbnails t WHERE t.video_id = v.id) < ?
  `).all(THUMB_COUNT) as { id: number; path: string; filename: string; duration_secs: number; thumb_hash: string }[];

  if (videos.length === 0) {
    emit('thumb:status', { total: 0, done: 0, running: false });
    return;
  }

  running = true;
  let done = 0;
  emit('thumb:status', { total: videos.length, done: 0, running: true });
  logger.info({ count: videos.length }, 'Starting thumbnail generation');

  const queue = [...videos];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const video = queue.shift()!;
      emit('thumb:video-start', { videoId: video.id, filename: video.filename, done, total: videos.length });
      await processVideo(video.id, video.path, video.filename, video.duration_secs, video.thumb_hash, logger);
      done++;
      emit('thumb:status', { total: videos.length, done, running: true });
    }
  });

  await Promise.all(workers);
  running = false;
  emit('thumb:status', { total: videos.length, done: videos.length, running: false });
  logger.info('Thumbnail generation complete');
}

/** Generate additional thumbnails for a specific video */
export async function generateAdditionalThumbnails(videoId: number, count: number, logger: any): Promise<void> {
  const db = getDb();
  const video = db.prepare('SELECT id, path, filename, duration_secs, thumb_hash FROM videos WHERE id = ?').get(videoId) as any;
  if (!video || !video.duration_secs || !video.thumb_hash) return;

  const existing = db.prepare('SELECT timestamp_secs FROM thumbnails WHERE video_id = ? ORDER BY timestamp_secs').all(videoId) as { timestamp_secs: number }[];
  const existingTs = existing.map(t => t.timestamp_secs).sort((a, b) => a - b);
  const maxIndex = (db.prepare('SELECT MAX(index_num) as m FROM thumbnails WHERE video_id = ?').get(videoId) as any).m ?? -1;

  // Generate new timestamps at midpoints between existing ones (and edges)
  const boundaries = [0, ...existingTs, video.duration_secs];
  const gaps: { mid: number; size: number }[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const size = boundaries[i + 1] - boundaries[i];
    if (size > 0.5) {
      gaps.push({ mid: (boundaries[i] + boundaries[i + 1]) / 2, size });
    }
  }
  // Sort by gap size descending and pick the largest gaps
  gaps.sort((a, b) => b.size - a.size);

  let nextIndex = maxIndex + 1;
  const newTimestamps = gaps.slice(0, count).map(g => g.mid);

  for (const ts of newTimestamps) {
    const tsStr = formatTimestamp(ts);
    const outputPath = path.join(THUMBS_DIR, video.thumb_hash, `${tsStr}.jpg`);

    try {
      await generateThumbnail(video.path, ts, outputPath);
      db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)')
        .run(videoId, nextIndex++, ts, outputPath);
      logger.info({ file: video.filename, timestamp: tsStr }, 'Generated extra thumbnail');
      emit('thumb:generated', { videoId, index: nextIndex - 1 });
    } catch (e) {
      logger.error({ file: video.filename, timestamp: tsStr, err: e }, 'Extra thumbnail failed');
    }
  }
}
