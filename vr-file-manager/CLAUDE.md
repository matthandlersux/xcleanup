# VR File Manager

Local app for browsing/managing VR video files via thumbnail previews.

## Stack

- **Backend**: Fastify + TypeScript + better-sqlite3 + pino-pretty (server/)
- **Frontend**: React + Vite with HMR (web/)
- **Package manager**: Yarn (classic)
- **Thumbnails**: ffmpeg
- **Task runner**: just

## Commands

```bash
just setup          # install deps, create directories
just dev            # run backend (port 3001) + frontend (port 3000), ctrl+c kills both
just check          # type-check both server and web
just check-server
just check-web
just build-web      # production build of frontend
just clean          # remove generated files, node_modules, db
```

## Allowed Tool Usage

Claude may run these commands without asking:

- `just check` / `just check-server` / `just check-web` — type-checking is always safe
- `just setup` — installs dependencies
- `just build-web` — builds frontend
Claude should ask before running:

- `just clean` — destructive, deletes data
- `just dev` — starts long-running processes

## Project Structure

- `dev.sh` — Process manager script, `kill 0` ensures clean shutdown
- `server/src/index.ts` — Fastify entry point with pino-pretty logging
- `server/src/db.ts` — SQLite schema + connection + migrations (idempotent ALTER TABLE)
- `server/src/events.ts` — SSE event bus for real-time frontend updates
- `server/src/routes/folders.ts` — Folder scan + auto-scan endpoints
- `server/src/routes/videos.ts` — Video CRUD, move, rename, stereo mode, settings, move history, extra thumbnails
- `server/src/services/indexer.ts` — Directory walker + ffprobe metadata + thumbnail recovery from disk
- `server/src/services/thumbnailer.ts` — Throttled ffmpeg thumbnail generation (initial + additional)
- `server/src/services/thumbHash.ts` — sha256-based hash for thumbnail directory naming
- `server/src/services/ffmpeg.ts` — ffprobe/ffmpeg helpers
- `server/src/migrate-thumbs.ts` — Standalone migration script for existing thumbnails
- `web/src/App.tsx` — Main app component with SSE subscription, sort/view state
- `web/src/api.ts` — API client, types, and EventSource helper
- `web/src/components/` — FolderPicker, VideoCard, VideoListRow, LightboxView, VRProjectionView

## Key Design Decisions

- SQLite DB at `server/data/app.db`, thumbnails at `thumbnails/<hash>/<timestamp>.jpg` (both gitignored)
- Thumbnail hash = `sha256(filename + ':' + sizeBytes).slice(0, 16)` — survives DB wipes
- Videos soft-deleted (`deleted=1`) when missing from disk on rescan
- Scan is split: fast file walk (with fs.stat) → background ffprobe → background thumbnail generation
- Thumbnail recovery: on scan, if `thumbnails/<hash>/` exists on disk, re-registers in DB
- Frontend gets live updates via SSE (`/api/events`), not polling
- Vite proxies `/api` and `/thumbs` to backend in dev; React HMR works for frontend changes
- `dev.sh` uses `kill 0` to kill the entire process group on Ctrl+C
- Move history stored in `move_history` table (replaces old `last_move_folder` setting)
- Stereo mode (`sbs`/`tb`) stored per-video, defaults to `sbs`
- Mobile-optimized with responsive CSS, touch swipe navigation in lightbox
