import { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { indexFolder, probeAllMetadata } from '../services/indexer.js';
import { startThumbnailGeneration } from '../services/thumbnailer.js';

export async function folderRoutes(app: FastifyInstance) {
  app.post<{ Body: { path: string } }>('/folders/scan', async (req, reply) => {
    const { path: folderPath } = req.body;
    if (!folderPath) return reply.status(400).send({ error: 'path is required' });

    let result;
    try {
      result = await indexFolder(folderPath, req.log);
    } catch (e: any) {
      if (e.statusCode === 400) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }

    // Background: probe metadata, then generate thumbnails
    (async () => {
      await probeAllMetadata(result.folderId, app.log);
      await startThumbnailGeneration(app.log);
    })().catch(e => app.log.error(e, 'Background processing error'));

    return result;
  });

  app.post('/folders/auto-scan', async (req, reply) => {
    const db = getDb();
    const folders = db.prepare('SELECT * FROM folders ORDER BY last_scanned_at DESC').all() as any[];
    if (folders.length === 0) return reply.status(404).send({ error: 'no folders to auto-scan' });

    // Try folders in order until one succeeds (skip folders that no longer exist)
    for (const folder of folders) {
      let result;
      try {
        result = await indexFolder(folder.path, req.log);
      } catch (e: any) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
          req.log.warn({ path: folder.path }, 'Auto-scan skipping missing folder');
          continue;
        }
        throw e;
      }

      // Background: probe metadata, then generate thumbnails
      (async () => {
        await probeAllMetadata(result.folderId, app.log);
        await startThumbnailGeneration(app.log);
      })().catch(e => app.log.error(e, 'Auto-scan background processing error'));

      return result;
    }

    return reply.status(404).send({ error: 'no valid folders to auto-scan' });
  });

  app.get('/folders', async () => {
    return getDb().prepare('SELECT * FROM folders ORDER BY last_scanned_at DESC').all();
  });

  app.delete<{ Params: { id: string } }>('/folders/:id', async (req, reply) => {
    const db = getDb();
    const id = Number(req.params.id);
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as any;
    if (!folder) return reply.status(404).send({ error: 'not found' });

    db.prepare('DELETE FROM thumbnails WHERE video_id IN (SELECT id FROM videos WHERE folder_id = ?)').run(id);
    db.prepare('DELETE FROM videos WHERE folder_id = ?').run(id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    return { ok: true };
  });
}
