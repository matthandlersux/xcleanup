import { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';
import { indexFolder, probeAllMetadata } from '../services/indexer.js';
import { startThumbnailGeneration } from '../services/thumbnailer.js';

export async function folderRoutes(app: FastifyInstance) {
  app.post<{ Body: { path: string } }>('/folders/scan', async (req, reply) => {
    const { path: folderPath } = req.body;
    if (!folderPath) return reply.status(400).send({ error: 'path is required' });

    // Fast pass: walk + insert file records (no ffprobe)
    const result = await indexFolder(folderPath, req.log);

    // Background: probe metadata, then generate thumbnails
    (async () => {
      await probeAllMetadata(result.folderId, app.log);
      await startThumbnailGeneration(app.log);
    })().catch(e => app.log.error(e, 'Background processing error'));

    return result;
  });

  app.post('/folders/auto-scan', async (req, reply) => {
    const db = getDb();
    const folder = db.prepare('SELECT * FROM folders ORDER BY last_scanned_at DESC LIMIT 1').get() as any;
    if (!folder) return reply.status(404).send({ error: 'no folders to auto-scan' });

    // Fast pass: walk + insert file records
    const result = await indexFolder(folder.path, req.log);

    // Background: probe metadata, then generate thumbnails
    (async () => {
      await probeAllMetadata(result.folderId, app.log);
      await startThumbnailGeneration(app.log);
    })().catch(e => app.log.error(e, 'Auto-scan background processing error'));

    return result;
  });

  app.get('/folders', async () => {
    return getDb().prepare('SELECT * FROM folders ORDER BY last_scanned_at DESC').all();
  });
}
