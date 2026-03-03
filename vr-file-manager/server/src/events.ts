import { FastifyInstance, FastifyReply } from 'fastify';

// Simple SSE event bus
type Listener = (event: string, data: any) => void;
const listeners = new Set<Listener>();

export function emit(event: string, data: any) {
  for (const listener of listeners) {
    listener(event, data);
  }
}

export async function eventRoutes(app: FastifyInstance) {
  app.get('/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const listener: Listener = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    listeners.add(listener);

    req.raw.on('close', () => {
      listeners.delete(listener);
    });
  });
}
