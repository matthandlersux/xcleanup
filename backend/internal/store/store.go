package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    status TEXT NOT NULL,
    destination TEXT,
    matched TEXT,
    override INTEGER NOT NULL DEFAULT 0,
    extension TEXT,
    scanned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    files_total INTEGER,
    files_move INTEGER,
    files_delete INTEGER,
    files_fuzzy INTEGER,
    files_keep INTEGER,
    error TEXT
);

CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    op TEXT NOT NULL,
    src TEXT NOT NULL,
    dst TEXT,
    success INTEGER NOT NULL,
    error TEXT
);

-- VR section: mirrors vr-file-manager's schema. INTEGER timestamps for
-- scan/created_at (epoch seconds), preserves IDs from the source DB on
-- migration.
CREATE TABLE IF NOT EXISTS vr_folders (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    last_scanned_at INTEGER
);

CREATE TABLE IF NOT EXISTS vr_videos (
    id INTEGER PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES vr_folders(id),
    filename TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    size_bytes INTEGER,
    duration_secs REAL,
    width INTEGER,
    height INTEGER,
    codec TEXT,
    created_at INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    stereo_mode TEXT NOT NULL DEFAULT 'sbs',
    thumb_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_vr_videos_folder ON vr_videos(folder_id);
CREATE INDEX IF NOT EXISTS idx_vr_videos_path ON vr_videos(path);

CREATE TABLE IF NOT EXISTS vr_thumbnails (
    id INTEGER PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES vr_videos(id),
    index_num INTEGER NOT NULL,
    timestamp_secs REAL NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE(video_id, index_num)
);
CREATE INDEX IF NOT EXISTS idx_vr_thumbs_video ON vr_thumbnails(video_id);

CREATE TABLE IF NOT EXISTS vr_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS vr_move_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_path TEXT NOT NULL UNIQUE,
    used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_vr_move_history_used ON vr_move_history(used_at DESC);
`

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// DB exposes the underlying connection so adjacent packages (e.g. vr) can
// share the same database file without each opening their own handle.
func (s *Store) DB() *sql.DB { return s.db }

type FileRecord struct {
	ID          int64
	Path        string
	Size        int64
	Mtime       int64
	Status      string
	Destination string
	Matched     string
	Override    bool
	Extension   string
	ScannedAt   int64
}

func (s *Store) ClearFiles() error {
	_, err := s.db.Exec(`DELETE FROM files`)
	return err
}

func (s *Store) InsertFile(f *FileRecord) error {
	res, err := s.db.Exec(`INSERT OR REPLACE INTO files
        (path, size, mtime, status, destination, matched, override, extension, scanned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		f.Path, f.Size, f.Mtime, f.Status, f.Destination, f.Matched, boolInt(f.Override), f.Extension, f.ScannedAt)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	f.ID = id
	return nil
}

func (s *Store) DeleteFileRow(id int64) error {
	_, err := s.db.Exec(`DELETE FROM files WHERE id=?`, id)
	return err
}

func (s *Store) UpdateFileStatus(id int64, status, destination string) error {
	_, err := s.db.Exec(`UPDATE files SET status=?, destination=?, override=1 WHERE id=?`,
		status, destination, id)
	return err
}

func (s *Store) GetFile(id int64) (*FileRecord, error) {
	row := s.db.QueryRow(`SELECT id, path, size, mtime, status, COALESCE(destination,''),
        COALESCE(matched,''), override, COALESCE(extension,''), scanned_at
        FROM files WHERE id=?`, id)
	var f FileRecord
	var ov int
	if err := row.Scan(&f.ID, &f.Path, &f.Size, &f.Mtime, &f.Status, &f.Destination,
		&f.Matched, &ov, &f.Extension, &f.ScannedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	f.Override = ov == 1
	return &f, nil
}

type ListParams struct {
	Status string
	Limit  int
	Offset int
}

func (s *Store) ListFiles(p ListParams) ([]FileRecord, int, error) {
	args := []any{}
	where := ""
	if p.Status != "" && p.Status != "all" {
		where = " WHERE status = ?"
		args = append(args, p.Status)
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM files`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	var limitClause string
	if p.Limit > 0 {
		args = append(args, p.Limit, p.Offset)
		limitClause = ` LIMIT ? OFFSET ?`
	}
	rows, err := s.db.Query(`SELECT id, path, size, mtime, status, COALESCE(destination,''),
        COALESCE(matched,''), override, COALESCE(extension,''), scanned_at
        FROM files`+where+` ORDER BY status, path`+limitClause, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []FileRecord
	for rows.Next() {
		var f FileRecord
		var ov int
		if err := rows.Scan(&f.ID, &f.Path, &f.Size, &f.Mtime, &f.Status, &f.Destination,
			&f.Matched, &ov, &f.Extension, &f.ScannedAt); err != nil {
			return nil, 0, err
		}
		f.Override = ov == 1
		out = append(out, f)
	}
	return out, total, rows.Err()
}

// CountByStatus returns current row counts grouped by status (live, not
// snapshotted from the last scan).
func (s *Store) CountByStatus() (map[string]int64, error) {
	rows, err := s.db.Query(`SELECT status, COUNT(*) FROM files GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

func (s *Store) FilesByStatus(status string) ([]FileRecord, error) {
	rows, err := s.db.Query(`SELECT id, path, size, mtime, status, COALESCE(destination,''),
        COALESCE(matched,''), override, COALESCE(extension,''), scanned_at
        FROM files WHERE status=? ORDER BY path`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileRecord
	for rows.Next() {
		var f FileRecord
		var ov int
		if err := rows.Scan(&f.ID, &f.Path, &f.Size, &f.Mtime, &f.Status, &f.Destination,
			&f.Matched, &ov, &f.Extension, &f.ScannedAt); err != nil {
			return nil, err
		}
		f.Override = ov == 1
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) FilesByIDs(ids []int64) ([]FileRecord, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT id, path, size, mtime, status, COALESCE(destination,''),
        COALESCE(matched,''), override, COALESCE(extension,''), scanned_at
        FROM files WHERE id IN (`
	args := make([]any, len(ids))
	for i, id := range ids {
		if i > 0 {
			q += ","
		}
		q += "?"
		args[i] = id
	}
	q += `)`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FileRecord
	for rows.Next() {
		var f FileRecord
		var ov int
		if err := rows.Scan(&f.ID, &f.Path, &f.Size, &f.Mtime, &f.Status, &f.Destination,
			&f.Matched, &ov, &f.Extension, &f.ScannedAt); err != nil {
			return nil, err
		}
		f.Override = ov == 1
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) StartScan(t time.Time) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO scans (started_at) VALUES (?)`, t.Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) FinishScan(id int64, finished time.Time, total, mv, del, fz, kp int64, errMsg string) error {
	_, err := s.db.Exec(`UPDATE scans SET finished_at=?, files_total=?, files_move=?,
        files_delete=?, files_fuzzy=?, files_keep=?, error=? WHERE id=?`,
		finished.Unix(), total, mv, del, fz, kp, errMsg, id)
	return err
}

type ScanRecord struct {
	ID         int64  `json:"id"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt int64  `json:"finished_at"`
	Total      int64  `json:"total"`
	Move       int64  `json:"move"`
	Delete     int64  `json:"delete"`
	Fuzzy      int64  `json:"fuzzy"`
	Keep       int64  `json:"keep"`
	Error      string `json:"error,omitempty"`
}

func (s *Store) LastScan() (*ScanRecord, error) {
	row := s.db.QueryRow(`SELECT id, started_at, COALESCE(finished_at,0),
        COALESCE(files_total,0), COALESCE(files_move,0), COALESCE(files_delete,0),
        COALESCE(files_fuzzy,0), COALESCE(files_keep,0), COALESCE(error,'')
        FROM scans ORDER BY id DESC LIMIT 1`)
	var r ScanRecord
	if err := row.Scan(&r.ID, &r.StartedAt, &r.FinishedAt, &r.Total, &r.Move, &r.Delete,
		&r.Fuzzy, &r.Keep, &r.Error); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (s *Store) LogAction(op, src, dst string, ok bool, errMsg string) error {
	_, err := s.db.Exec(`INSERT INTO actions (ts, op, src, dst, success, error)
        VALUES (?, ?, ?, ?, ?, ?)`,
		time.Now().Unix(), op, src, dst, boolInt(ok), errMsg)
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
