# VR File Manager

Local-only tool for browsing, previewing, and managing large VR video files via thumbnails.

## Problem

VR video files are large (5-20GB), have unhelpful names, and take too long to load in a player just to decide whether to keep/delete/move them.

## Solution

A lightweight local app that indexes video folders, generates thumbnail previews using ffmpeg, and provides a UI for browsing and managing files.

## Tech Stack

- **Backend**: Fastify + TypeScript, better-sqlite3 for persistence
- **Frontend**: React + Vite (proxied to backend)
- **Thumbnails**: ffmpeg (fast input seeking, scale to 1080px height)
- **Package manager**: Yarn (classic)
- **Runner**: Justfile — single `just dev` command runs everything, Ctrl+C kills all

## Features

1. **Folder scanning**: Point at a local folder, app indexes all video files (mp4, mkv, avi, mov, wmv, webm) with metadata via ffprobe
2. **Thumbnail generation**: Throttled background job generates 5 thumbnails per video at evenly-spaced timestamps, 1080px high, JPEG. Skips if already generated.
3. **Restart resilience**: All state in SQLite. Resyncs on scan — no duplicate work, picks up where it left off.
4. **List UI**: Grid of video cards showing thumbnails, filename, duration, resolution
5. **Lightbox**: Click thumbnail to see larger version, scroll wheel to zoom in/out, arrow keys to cycle through 5 thumbnails
6. **File actions**: Delete (removes from disk + DB), Move (to chosen folder, remembers last folder), Rename

## Architecture

```
├── justfile                    # just dev / just setup
├── server/
│   └── src/
│       ├── index.ts            # Fastify entry
│       ├── db.ts               # SQLite schema + connection
│       ├── routes/
│       │   ├── folders.ts      # POST /api/folders/scan, GET /api/folders
│       │   └── videos.ts       # CRUD + move/rename
│       └── services/
│           ├── indexer.ts      # Walk dir, ffprobe, upsert
│           └── thumbnailer.ts  # Throttled ffmpeg thumbnail jobs
├── web/
│   └── src/
│       ├── App.tsx             # Main app, state-based routing
│       ├── api.ts              # Fetch wrappers
│       └── components/
│           ├── FolderPicker.tsx
│           ├── VideoList.tsx
│           ├── VideoCard.tsx
│           └── LightboxView.tsx
├── thumbnails/                 # Generated thumbnails (gitignored)
└── server/data/                # SQLite DB (gitignored)
```

## Database Schema

**folders**: id, path, last_scanned_at
**videos**: id, folder_id, filename, path, size_bytes, duration_secs, width, height, codec, created_at, deleted
**thumbnails**: id, video_id, index_num (0-4), timestamp_secs, path, created_at
**settings**: key, value (stores last_move_folder etc.)

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/folders/scan | Scan a folder path |
| GET | /api/folders | List scanned folders |
| GET | /api/videos?folderId=&page=&limit= | Paginated video list |
| DELETE | /api/videos/:id | Delete video from disk + DB |
| PATCH | /api/videos/:id | Rename or move |
| GET | /api/thumb-status | Thumbnail generation progress |
| GET | /api/settings | Get settings (last move folder) |
| PUT | /api/settings | Save settings |

## Thumbnail Strategy

- 5 thumbnails per video at timestamps: `duration * (i+1) / 6` for i in 0..4
- Stored at: `thumbnails/<video_id>/<index>.jpg`
- Concurrency: 2 ffmpeg processes at a time
- Skip logic: check file exists on disk AND DB record exists

## Resync on Scan

1. Walk directory, collect video file paths
2. INSERT OR IGNORE by path (no duplicates)
3. Probe metadata only for new entries
4. Soft-delete videos no longer on disk (deleted=1)
5. Thumbnail job processes videos with <5 thumbnails

## Running

```bash
just setup   # yarn install in server/ and web/, create directories
just dev     # start backend + frontend, Ctrl+C kills both
```

App runs at http://localhost:3000, API at http://localhost:3001.
