import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { folderRoutes } from './routes/folders.js';
import { videoRoutes } from './routes/videos.js';
import { eventRoutes } from './events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  },
});

// Initialize DB on startup
getDb();

// Serve thumbnail files
app.register(fastifyStatic, {
  root: path.join(__dirname, '../../thumbnails'),
  prefix: '/thumbs/',
});

app.register(eventRoutes, { prefix: '/api' });
app.register(folderRoutes, { prefix: '/api' });
app.register(videoRoutes, { prefix: '/api' });

app.listen({ port: 3001, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
