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

async function processVideo(videoId: number, videoPath: string, filename: string, duration: number, logger: any): Promise<void> {
  const db = getDb();
  const existingThumbs = db.prepare('SELECT index_num FROM thumbnails WHERE video_id = ?').all(videoId) as { index_num: number }[];
  const existingSet = new Set(existingThumbs.map(t => t.index_num));

  for (let i = 0; i < THUMB_COUNT; i++) {
    if (existingSet.has(i)) continue;

    const timestamp = duration * (i + 1) / (THUMB_COUNT + 1);
    const outputPath = path.join(THUMBS_DIR, String(videoId), `${i}.jpg`);

    try {
      await fs.access(outputPath);
      db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)')
        .run(videoId, i, timestamp, outputPath);
      emit('thumb:generated', { videoId, index: i });
      continue;
    } catch {
      // File doesn't exist, generate it
    }

    try {
      await generateThumbnail(videoPath, timestamp, outputPath);
      db.prepare('INSERT OR IGNORE INTO thumbnails (video_id, index_num, timestamp_secs, path) VALUES (?, ?, ?, ?)')
        .run(videoId, i, timestamp, outputPath);
      logger.info({ file: filename, thumb: i }, 'Generated thumbnail');
      emit('thumb:generated', { videoId, index: i });
    } catch (e) {
      logger.error({ file: filename, thumb: i, err: e }, 'Thumbnail failed');
    }
  }
}

export async function startThumbnailGeneration(logger: any): Promise<void> {
  if (running) return;

  const db = getDb();
  const videos = db.prepare(`
    SELECT v.id, v.path, v.filename, v.duration_secs
    FROM videos v
    WHERE v.deleted = 0 AND v.duration_secs IS NOT NULL
    AND (SELECT COUNT(*) FROM thumbnails t WHERE t.video_id = v.id) < ?
  `).all(THUMB_COUNT) as { id: number; path: string; filename: string; duration_secs: number }[];

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
      await processVideo(video.id, video.path, video.filename, video.duration_secs, logger);
      done++;
      emit('thumb:status', { total: videos.length, done, running: true });
    }
  });

  await Promise.all(workers);
  running = false;
  emit('thumb:status', { total: videos.length, done: videos.length, running: false });
  logger.info('Thumbnail generation complete');
}
