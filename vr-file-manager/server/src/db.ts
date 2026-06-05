import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/app.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        last_scanned_at TEXT
      );

      CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES folders(id),
        filename TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        size_bytes INTEGER,
        duration_secs REAL,
        width INTEGER,
        height INTEGER,
        codec TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        deleted INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS thumbnails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL REFERENCES videos(id),
        index_num INTEGER NOT NULL,
        timestamp_secs REAL NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(video_id, index_num)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS move_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_path TEXT UNIQUE NOT NULL,
        used_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_thumbnails_video ON thumbnails(video_id);
      CREATE INDEX IF NOT EXISTS idx_videos_path ON videos(path);
      CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);
      CREATE INDEX IF NOT EXISTS idx_move_history_used ON move_history(used_at DESC);
    `);

    // Add columns idempotently (ALTER TABLE ADD COLUMN fails if column exists)
    const addColumn = (table: string, col: string, def: string) => {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch {}
    };
    addColumn('videos', 'stereo_mode', "TEXT DEFAULT 'sbs'");
    addColumn('videos', 'thumb_hash', 'TEXT');

    // Migrate existing last_move_folder setting into move_history
    const lastMove = db.prepare("SELECT value FROM settings WHERE key = 'last_move_folder'").get() as { value: string } | undefined;
    if (lastMove?.value) {
      db.prepare("INSERT OR IGNORE INTO move_history (folder_path) VALUES (?)").run(lastMove.value);
      db.prepare("DELETE FROM settings WHERE key = 'last_move_folder'").run();
    }
  }
  return db;
}
