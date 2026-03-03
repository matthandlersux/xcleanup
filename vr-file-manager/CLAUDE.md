# VR File Manager

Local app for browsing/managing VR video files via thumbnail previews.

## Stack

- **Backend**: Fastify + TypeScript + better-sqlite3 + pino-pretty (server/)
- **Frontend**: React + Vite with HMR (web/)
- **Package manager**: Yarn (classic)
- **Thumbnails**: ffmpeg

## Commands

```bash
just setup       # install deps, create directories
just dev         # run backend (port 3001) + frontend (port 3000), ctrl+c kills both
just check       # type-check both server and web
just check-server
just check-web
just build-web   # production build of frontend
just clean       # remove generated files, node_modules, db
```

## Project Structure

- `dev.sh` — Process manager script, `kill 0` ensures clean shutdown
- `server/src/index.ts` — Fastify entry point with pino-pretty logging
- `server/src/db.ts` — SQLite schema + connection
- `server/src/events.ts` — SSE event bus for real-time frontend updates
- `server/src/routes/folders.ts` — Folder scan endpoints
- `server/src/routes/videos.ts` — Video CRUD, move, rename, settings
- `server/src/services/indexer.ts` — Directory walker + ffprobe metadata (two phases: fast index then background probe)
- `server/src/services/thumbnailer.ts` — Throttled ffmpeg thumbnail generation
- `server/src/services/ffmpeg.ts` — ffprobe/ffmpeg helpers
- `web/src/App.tsx` — Main app component with SSE subscription
- `web/src/api.ts` — API client, types, and EventSource helper
- `web/src/components/` — FolderPicker, VideoCard, LightboxView

## Key Design Decisions

- SQLite DB at `server/data/app.db`, thumbnails at `thumbnails/<videoId>/<index>.jpg` (both gitignored)
- Videos soft-deleted (`deleted=1`) when missing from disk on rescan
- Scan is split: fast file walk → background ffprobe → background thumbnail generation
- Frontend gets live updates via SSE (`/api/events`), not polling
- Vite proxies `/api` and `/thumbs` to backend in dev; React HMR works for frontend changes
- `dev.sh` uses `kill 0` to kill the entire process group on Ctrl+C
