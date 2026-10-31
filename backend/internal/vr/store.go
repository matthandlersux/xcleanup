package vr

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// unixSecs is a Unix epoch second value that marshals into the same
// "YYYY-MM-DD HH:MM:SS" text the original vr-file-manager stored. The
// frontend's formatDate appends 'Z' and lets the browser parse it.
type unixSecs int64

func (u unixSecs) MarshalJSON() ([]byte, error) {
	if u == 0 {
		return []byte(`""`), nil
	}
	t := time.Unix(int64(u), 0).UTC()
	return []byte(`"` + t.Format("2006-01-02 15:04:05") + `"`), nil
}

type Folder struct {
	ID            int64     `json:"id"`
	Path          string    `json:"path"`
	LastScannedAt unixSecs  `json:"last_scanned_at"`
}

type Video struct {
	ID           int64    `json:"id"`
	FolderID     int64    `json:"folder_id"`
	Filename     string   `json:"filename"`
	Path         string   `json:"path"`
	SizeBytes    *int64   `json:"size_bytes"`
	DurationSecs *float64 `json:"duration_secs"`
	Width        *int     `json:"width"`
	Height       *int     `json:"height"`
	Codec        *string  `json:"codec"`
	CreatedAt    unixSecs `json:"created_at"`
	Deleted      int      `json:"deleted"`
	StereoMode   string   `json:"stereo_mode"`
	ThumbHash    *string  `json:"thumb_hash"`
	FolderPath   string   `json:"folder_path"`
	Thumbs       []Thumb  `json:"thumbs"`
}

type Thumb struct {
	Index         int     `json:"index"`
	VideoID       int64   `json:"videoId"`
	ThumbHash     *string `json:"thumb_hash"`
	TimestampSecs float64 `json:"timestamp_secs"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// ----- folders -----

func (s *Store) UpsertFolder(path string) (int64, error) {
	now := time.Now().Unix()
	_, err := s.db.Exec(`INSERT INTO vr_folders (path, last_scanned_at) VALUES (?, ?)
        ON CONFLICT(path) DO UPDATE SET last_scanned_at = excluded.last_scanned_at`, path, now)
	if err != nil {
		return 0, err
	}
	var id int64
	if err := s.db.QueryRow(`SELECT id FROM vr_folders WHERE path = ?`, path).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) ListFolders() ([]Folder, error) {
	rows, err := s.db.Query(`SELECT id, path, COALESCE(last_scanned_at, 0) FROM vr_folders ORDER BY last_scanned_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Folder
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Path, &f.LastScannedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) GetFolder(id int64) (*Folder, error) {
	row := s.db.QueryRow(`SELECT id, path, COALESCE(last_scanned_at, 0) FROM vr_folders WHERE id = ?`, id)
	var f Folder
	if err := row.Scan(&f.ID, &f.Path, &f.LastScannedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

func (s *Store) DeleteFolderCascade(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM vr_thumbnails WHERE video_id IN (SELECT id FROM vr_videos WHERE folder_id = ?)`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vr_videos WHERE folder_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vr_folders WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// ----- videos -----

func (s *Store) InsertOrIgnoreVideo(folderID int64, filename, path string, sizeBytes int64, thumbHash string, createdAt int64) (bool, error) {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO vr_videos
        (folder_id, filename, path, size_bytes, thumb_hash, created_at, stereo_mode)
        VALUES (?, ?, ?, ?, ?, ?, 'sbs')`,
		folderID, filename, path, sizeBytes, thumbHash, createdAt)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *Store) BackfillThumbHash(path string, sizeBytes int64, thumbHash string) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET size_bytes = COALESCE(size_bytes, ?), thumb_hash = ?
        WHERE path = ? AND thumb_hash IS NULL`, sizeBytes, path, thumbHash)
	return err
}

func (s *Store) FolderVideoPaths(folderID int64) ([]struct {
	ID   int64
	Path string
}, error,
) {
	rows, err := s.db.Query(`SELECT id, path FROM vr_videos WHERE folder_id = ?`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID   int64
		Path string
	}
	for rows.Next() {
		var x struct {
			ID   int64
			Path string
		}
		if err := rows.Scan(&x.ID, &x.Path); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) MarkVideoDeleted(id int64) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET deleted = 1 WHERE id = ?`, id)
	return err
}

func (s *Store) UnmarkVideoDeleted(id int64) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET deleted = 0 WHERE id = ? AND deleted = 1`, id)
	return err
}

type ListVideosParams struct {
	FolderID  *int64
	Search    string // matched case-insensitive against filename and path
	SortField string // filename | path | size_bytes | created_at
	SortOrder string // asc | desc
	Limit     int
	Offset    int
}

func (s *Store) ListVideos(p ListVideosParams) ([]Video, int, error) {
	allowedSort := map[string]bool{"filename": true, "path": true, "size_bytes": true, "created_at": true}
	if !allowedSort[p.SortField] {
		p.SortField = "filename"
	}
	order := "ASC"
	if p.SortOrder == "desc" {
		order = "DESC"
	}
	where := "WHERE v.deleted = 0"
	args := []any{}
	if p.FolderID != nil {
		where += " AND v.folder_id = ?"
		args = append(args, *p.FolderID)
	}
	if q := strings.TrimSpace(p.Search); q != "" {
		like := "%" + strings.ToLower(q) + "%"
		where += " AND (LOWER(v.filename) LIKE ? OR LOWER(v.path) LIKE ?)"
		args = append(args, like, like)
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM vr_videos v `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if p.Limit <= 0 {
		p.Limit = 50
	}
	argsWithPg := append(append([]any{}, args...), p.Limit, p.Offset)
	q := `SELECT v.id, v.folder_id, v.filename, v.path, v.size_bytes, v.duration_secs,
        v.width, v.height, v.codec, COALESCE(v.created_at, 0), v.deleted, v.stereo_mode, v.thumb_hash,
        f.path AS folder_path
        FROM vr_videos v JOIN vr_folders f ON f.id = v.folder_id ` +
		where + ` ORDER BY v.` + p.SortField + ` ` + order + ` LIMIT ? OFFSET ?`
	rows, err := s.db.Query(q, argsWithPg...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Video
	for rows.Next() {
		var v Video
		if err := rows.Scan(&v.ID, &v.FolderID, &v.Filename, &v.Path, &v.SizeBytes, &v.DurationSecs,
			&v.Width, &v.Height, &v.Codec, &v.CreatedAt, &v.Deleted, &v.StereoMode, &v.ThumbHash, &v.FolderPath); err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// Attach thumbnails.
	for i := range out {
		thumbs, err := s.thumbsForVideo(out[i].ID, out[i].ThumbHash)
		if err != nil {
			return nil, 0, err
		}
		out[i].Thumbs = thumbs
	}
	return out, total, nil
}

func (s *Store) thumbsForVideo(videoID int64, hashPtr *string) ([]Thumb, error) {
	rows, err := s.db.Query(`SELECT index_num, timestamp_secs FROM vr_thumbnails WHERE video_id = ? ORDER BY index_num`, videoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Thumb{}
	for rows.Next() {
		var t Thumb
		if err := rows.Scan(&t.Index, &t.TimestampSecs); err != nil {
			return nil, err
		}
		t.VideoID = videoID
		t.ThumbHash = hashPtr
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) GetVideo(id int64) (*Video, error) {
	row := s.db.QueryRow(`SELECT v.id, v.folder_id, v.filename, v.path, v.size_bytes, v.duration_secs,
        v.width, v.height, v.codec, COALESCE(v.created_at, 0), v.deleted, v.stereo_mode, v.thumb_hash,
        f.path AS folder_path
        FROM vr_videos v JOIN vr_folders f ON f.id = v.folder_id WHERE v.id = ?`, id)
	var v Video
	if err := row.Scan(&v.ID, &v.FolderID, &v.Filename, &v.Path, &v.SizeBytes, &v.DurationSecs,
		&v.Width, &v.Height, &v.Codec, &v.CreatedAt, &v.Deleted, &v.StereoMode, &v.ThumbHash, &v.FolderPath); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

func (s *Store) UpdateVideoPath(id int64, newPath, newFilename string) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET path = ?, filename = ? WHERE id = ?`, newPath, newFilename, id)
	return err
}

func (s *Store) UpdateVideoStereoMode(id int64, mode string) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET stereo_mode = ? WHERE id = ?`, mode, id)
	return err
}

func (s *Store) UpdateVideoMetadata(id int64, size int64, duration float64, width, height int, codec string) error {
	_, err := s.db.Exec(`UPDATE vr_videos SET size_bytes = ?, duration_secs = ?, width = ?, height = ?, codec = ? WHERE id = ?`,
		size, duration, width, height, codec, id)
	return err
}

func (s *Store) DeleteVideoCascade(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM vr_thumbnails WHERE video_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vr_videos WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) VideosNeedingProbe(folderID int64) ([]struct {
	ID       int64
	Path     string
	Filename string
}, error) {
	rows, err := s.db.Query(`SELECT id, path, filename FROM vr_videos
        WHERE folder_id = ? AND deleted = 0 AND duration_secs IS NULL`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID       int64
		Path     string
		Filename string
	}
	for rows.Next() {
		var x struct {
			ID       int64
			Path     string
			Filename string
		}
		if err := rows.Scan(&x.ID, &x.Path, &x.Filename); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ----- thumbnails -----

func (s *Store) InsertThumb(videoID int64, index int, ts float64, path string) error {
	_, err := s.db.Exec(`INSERT OR IGNORE INTO vr_thumbnails (video_id, index_num, timestamp_secs, path, created_at)
        VALUES (?, ?, ?, ?, ?)`, videoID, index, ts, path, time.Now().Unix())
	return err
}

func (s *Store) ExistingThumbs(videoID int64) ([]struct {
	IndexNum      int
	TimestampSecs float64
}, error,
) {
	rows, err := s.db.Query(`SELECT index_num, timestamp_secs FROM vr_thumbnails WHERE video_id = ? ORDER BY index_num`, videoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		IndexNum      int
		TimestampSecs float64
	}
	for rows.Next() {
		var x struct {
			IndexNum      int
			TimestampSecs float64
		}
		if err := rows.Scan(&x.IndexNum, &x.TimestampSecs); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) MaxThumbIndex(videoID int64) (int, error) {
	var n sql.NullInt64
	if err := s.db.QueryRow(`SELECT MAX(index_num) FROM vr_thumbnails WHERE video_id = ?`, videoID).Scan(&n); err != nil {
		return -1, err
	}
	if !n.Valid {
		return -1, nil
	}
	return int(n.Int64), nil
}

func (s *Store) VideosNeedingThumbs(minCount int) ([]struct {
	ID       int64
	Path     string
	Filename string
	Duration float64
	Hash     string
}, error) {
	rows, err := s.db.Query(`SELECT v.id, v.path, v.filename, v.duration_secs, v.thumb_hash
        FROM vr_videos v
        WHERE v.deleted = 0 AND v.duration_secs IS NOT NULL AND v.thumb_hash IS NOT NULL
        AND (SELECT COUNT(*) FROM vr_thumbnails t WHERE t.video_id = v.id) < ?`, minCount)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ID       int64
		Path     string
		Filename string
		Duration float64
		Hash     string
	}
	for rows.Next() {
		var x struct {
			ID       int64
			Path     string
			Filename string
			Duration float64
			Hash     string
		}
		if err := rows.Scan(&x.ID, &x.Path, &x.Filename, &x.Duration, &x.Hash); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ----- move history -----

func (s *Store) RecordMove(folder string) error {
	_, err := s.db.Exec(`INSERT INTO vr_move_history (folder_path, used_at) VALUES (?, ?)
        ON CONFLICT(folder_path) DO UPDATE SET used_at = excluded.used_at`, folder, time.Now().Unix())
	return err
}

func (s *Store) DeleteMoveHistoryEntry(folder string) error {
	_, err := s.db.Exec(`DELETE FROM vr_move_history WHERE folder_path = ?`, folder)
	return err
}

func (s *Store) MoveHistory() ([]string, error) {
	rows, err := s.db.Query(`SELECT folder_path FROM vr_move_history ORDER BY used_at DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ----- settings -----

func (s *Store) GetSettings() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT key, value FROM vr_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) PutSettings(kv map[string]string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, v := range kv {
		if _, err := tx.Exec(`INSERT INTO vr_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// DB exposes the underlying *sql.DB for migration and other low-level use.
func (s *Store) DB() *sql.DB { return s.db }
