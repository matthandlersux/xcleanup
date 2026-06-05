import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';
import { generateAdditionalThumbnails } from '../services/thumbnailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = path.join(__dirname, '../../../thumbnails');

export async function videoRoutes(app: FastifyInstance) {
  const SORT_WHITELIST = ['filename', 'path', 'size_bytes', 'created_at'] as const;

  app.get<{ Querystring: { folderId?: string; page?: string; limit?: string; sort?: string; order?: string } }>('/videos', async (req) => {
    const db = getDb();
    const folderId = req.query.folderId ? Number(req.query.folderId) : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const sortField = SORT_WHITELIST.includes(req.query.sort as any) ? req.query.sort! : 'filename';
    const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';

    let where = 'WHERE v.deleted = 0';
    const params: any[] = [];
    if (folderId) {
      where += ' AND v.folder_id = ?';
      params.push(folderId);
    }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM videos v ${where}`).get(...params) as any).count;
    const videos = db.prepare(`
      SELECT v.*, f.path as folder_path, json_group_array(
        CASE WHEN t.id IS NOT NULL THEN json_object('index', t.index_num, 'videoId', v.id, 'thumb_hash', v.thumb_hash, 'timestamp_secs', t.timestamp_secs) ELSE NULL END
      ) as thumbs
      FROM videos v
      JOIN folders f ON f.id = v.folder_id
      LEFT JOIN thumbnails t ON t.video_id = v.id
      ${where}
      GROUP BY v.id
      ORDER BY v.${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      videos: videos.map(v => ({
        ...v,
        thumbs: JSON.parse(v.thumbs).filter((t: any) => t !== null),
      })),
      total,
      page,
      limit,
    };
  });

  app.delete<{ Params: { id: string } }>('/videos/:id', async (req, reply) => {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id)) as any;
    if (!video) return reply.status(404).send({ error: 'not found' });

    try {
      await fs.unlink(video.path);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    // Clean up hash-based thumbnail dir
    if (video.thumb_hash) {
      try {
        await fs.rm(path.join(THUMBS_DIR, video.thumb_hash), { recursive: true });
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
    }

    // Clean up legacy ID-based thumbnail dir
    try {
      await fs.rm(path.join(THUMBS_DIR, String(video.id)), { recursive: true });
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    db.prepare('DELETE FROM thumbnails WHERE video_id = ?').run(video.id);
    db.prepare('DELETE FROM videos WHERE id = ?').run(video.id);

    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { rename?: string; moveTo?: string; stereoMode?: string } }>('/videos/:id', async (req, reply) => {
    const db = getDb();
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id)) as any;
    if (!video) return reply.status(404).send({ error: 'not found' });

    if (req.body.stereoMode) {
      const mode = req.body.stereoMode;
      if (mode !== 'sbs' && mode !== 'tb') return reply.status(400).send({ error: 'stereoMode must be sbs or tb' });
      db.prepare('UPDATE videos SET stereo_mode = ? WHERE id = ?').run(mode, video.id);
      if (!req.body.rename && !req.body.moveTo) return { ok: true };
    }

    if (req.body.rename) {
      const newPath = path.join(path.dirname(video.path), req.body.rename);
      try {
        await fs.access(newPath);
        return reply.status(409).send({ error: 'file already exists at destination' });
      } catch { /* good, doesn't exist */ }
      await fs.rename(video.path, newPath);
      db.prepare('UPDATE videos SET path = ?, filename = ? WHERE id = ?').run(newPath, req.body.rename, video.id);
      return { ok: true, path: newPath };
    }

    if (req.body.moveTo) {
      const destDir = req.body.moveTo;
      const newPath = path.join(destDir, video.filename);
      try {
        await fs.access(newPath);
        return reply.status(409).send({ error: 'file already exists at destination' });
      } catch { /* good */ }
      await fs.mkdir(destDir, { recursive: true });
      await fs.rename(video.path, newPath);
      db.prepare('UPDATE videos SET path = ? WHERE id = ?').run(newPath, video.id);

      db.prepare("INSERT INTO move_history (folder_path, used_at) VALUES (?, datetime('now')) ON CONFLICT(folder_path) DO UPDATE SET used_at = datetime('now')")
        .run(destDir);

      return { ok: true, path: newPath };
    }

    return reply.status(400).send({ error: 'provide rename, moveTo, or stereoMode' });
  });

  app.post<{ Params: { id: string }; Body: { count?: number } }>('/videos/:id/thumbnails', async (req, reply) => {
    const db = getDb();
    const video = db.prepare('SELECT id, duration_secs, thumb_hash FROM videos WHERE id = ?').get(Number(req.params.id)) as any;
    if (!video) return reply.status(404).send({ error: 'not found' });
    if (!video.duration_secs) return reply.status(400).send({ error: 'video not yet probed' });
    if (!video.thumb_hash) return reply.status(400).send({ error: 'video has no thumb_hash' });

    const count = Math.min(50, Math.max(1, Number(req.body.count) || 15));

    // Run in background so the response returns immediately
    generateAdditionalThumbnails(video.id, count, req.log).catch(e =>
      req.log.error(e, 'Failed to generate additional thumbnails')
    );

    return { ok: true, generating: count };
  });

  app.get('/move-history', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT folder_path FROM move_history ORDER BY used_at DESC LIMIT 10').all() as { folder_path: string }[];
    return rows.map(r => r.folder_path);
  });

  app.get('/settings', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  app.put<{ Body: Record<string, string> }>('/settings', async (req) => {
    const db = getDb();
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?');
    for (const [key, value] of Object.entries(req.body)) {
      stmt.run(key, value, value);
    }
    return { ok: true };
  });
}
