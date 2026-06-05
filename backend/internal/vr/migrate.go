package vr

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// MigrateFromVRFM is an idempotent one-time copy from a legacy vr-file-manager
// SQLite DB into the embedded vr_* tables. It also clones the on-disk
// thumbnail tree if missing. Original files are left untouched.
//
// It runs at most once: a row in vr_settings (`migrated_from_vrfm`) is the
// flag.
func MigrateFromVRFM(dst *sql.DB, srcDBPath, srcThumbDir, destThumbDir string) error {
	var flag string
	if err := dst.QueryRow(`SELECT value FROM vr_settings WHERE key = 'migrated_from_vrfm'`).Scan(&flag); err == nil && flag != "" {
		log.Printf("vr migration: already done (flag=%s)", flag)
		return nil
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	if _, err := os.Stat(srcDBPath); err != nil {
		log.Printf("vr migration: source DB %s not found — skipping", srcDBPath)
		return nil
	}

	// immutable=1 tells SQLite the file won't change while we read it. This
	// avoids touching WAL/shm files (which a read-only bind mount can't write
	// to anyway) and skips lock/journal recovery.
	src, err := sql.Open("sqlite3", "file:"+srcDBPath+"?mode=ro&immutable=1")
	if err != nil {
		return fmt.Errorf("open vrfm DB: %w", err)
	}
	defer src.Close()

	tx, err := dst.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// folders
	rows, err := src.Query(`SELECT id, path, last_scanned_at FROM folders`)
	if err != nil {
		return fmt.Errorf("read folders: %w", err)
	}
	folderCount := 0
	for rows.Next() {
		var id int64
		var path string
		var lastScannedRaw sql.NullString
		if err := rows.Scan(&id, &path, &lastScannedRaw); err != nil {
			rows.Close()
			return err
		}
		ts := parseVRFMTime(lastScannedRaw.String)
		if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_folders (id, path, last_scanned_at) VALUES (?, ?, ?)`, id, path, ts); err != nil {
			rows.Close()
			return fmt.Errorf("insert folder %d: %w", id, err)
		}
		folderCount++
	}
	rows.Close()

	// videos
	rows, err = src.Query(`SELECT id, folder_id, filename, path, size_bytes, duration_secs,
        width, height, codec, created_at, deleted, COALESCE(stereo_mode, 'sbs'), thumb_hash
        FROM videos`)
	if err != nil {
		return fmt.Errorf("read videos: %w", err)
	}
	videoCount := 0
	for rows.Next() {
		var (
			id, folderID, deleted          int64
			filename, path                 string
			size                           sql.NullInt64
			duration                       sql.NullFloat64
			width, height                  sql.NullInt64
			codec                          sql.NullString
			createdAtRaw                   sql.NullString
			stereoMode                     string
			thumbHash                      sql.NullString
		)
		if err := rows.Scan(&id, &folderID, &filename, &path, &size, &duration,
			&width, &height, &codec, &createdAtRaw, &deleted, &stereoMode, &thumbHash); err != nil {
			rows.Close()
			return err
		}
		createdAt := parseVRFMTime(createdAtRaw.String)
		if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_videos
            (id, folder_id, filename, path, size_bytes, duration_secs, width, height, codec, created_at, deleted, stereo_mode, thumb_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, folderID, filename, path,
			nullInt(size), nullFloat(duration), nullInt(width), nullInt(height), nullStr(codec),
			createdAt, deleted, stereoMode, nullStr(thumbHash)); err != nil {
			rows.Close()
			return fmt.Errorf("insert video %d: %w", id, err)
		}
		videoCount++
	}
	rows.Close()

	// thumbnails — rewrite path to point at destThumbDir while preserving rest.
	rows, err = src.Query(`SELECT id, video_id, index_num, timestamp_secs, path, created_at FROM thumbnails`)
	if err != nil {
		return fmt.Errorf("read thumbnails: %w", err)
	}
	thumbCount := 0
	for rows.Next() {
		var (
			id, videoID, idx int64
			ts               float64
			path             string
			createdAtRaw     sql.NullString
		)
		if err := rows.Scan(&id, &videoID, &idx, &ts, &path, &createdAtRaw); err != nil {
			rows.Close()
			return err
		}
		newPath := rewriteThumbPath(path, srcThumbDir, destThumbDir)
		createdAt := parseVRFMTime(createdAtRaw.String)
		if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_thumbnails
            (id, video_id, index_num, timestamp_secs, path, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`, id, videoID, idx, ts, newPath, createdAt); err != nil {
			rows.Close()
			return fmt.Errorf("insert thumb %d: %w", id, err)
		}
		thumbCount++
	}
	rows.Close()

	// move_history
	rows, err = src.Query(`SELECT folder_path, used_at FROM move_history`)
	if err != nil {
		return fmt.Errorf("read move_history: %w", err)
	}
	mhCount := 0
	for rows.Next() {
		var p string
		var usedRaw sql.NullString
		if err := rows.Scan(&p, &usedRaw); err != nil {
			rows.Close()
			return err
		}
		if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_move_history (folder_path, used_at) VALUES (?, ?)`,
			p, parseVRFMTime(usedRaw.String)); err != nil {
			rows.Close()
			return err
		}
		mhCount++
	}
	rows.Close()

	// settings
	rows, err = src.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return fmt.Errorf("read settings: %w", err)
	}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			rows.Close()
			return err
		}
		if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_settings (key, value) VALUES (?, ?)`, k, v); err != nil {
			rows.Close()
			return err
		}
	}
	rows.Close()

	// flag
	if _, err := tx.Exec(`INSERT OR REPLACE INTO vr_settings (key, value) VALUES ('migrated_from_vrfm', ?)`,
		time.Now().Format(time.RFC3339)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("vr migration: copied %d folders, %d videos, %d thumbnails, %d move-history entries",
		folderCount, videoCount, thumbCount, mhCount)

	// copy thumbnail tree if needed.
	if err := copyThumbsIfMissing(srcThumbDir, destThumbDir); err != nil {
		log.Printf("vr migration: warning copying thumbnails: %v", err)
	}
	return nil
}

func parseVRFMTime(s string) int64 {
	if s == "" {
		return 0
	}
	// vrfm stores datetime('now') format like "2026-03-05 16:42:33" (UTC).
	layouts := []string{"2006-01-02 15:04:05", time.RFC3339}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.Unix()
		}
	}
	return 0
}

func rewriteThumbPath(stored, srcRoot, dstRoot string) string {
	if stored == "" {
		return stored
	}
	// Normalize trailing slashes.
	srcRoot = strings.TrimRight(srcRoot, "/")
	dstRoot = strings.TrimRight(dstRoot, "/")
	if srcRoot != "" && strings.HasPrefix(stored, srcRoot+"/") {
		return filepath.Join(dstRoot, strings.TrimPrefix(stored, srcRoot+"/"))
	}
	// vrfm stores absolute paths under its repo's thumbnails dir; if our
	// recorded srcRoot doesn't match, try to peel off the common segment.
	if i := strings.Index(stored, "/thumbnails/"); i >= 0 {
		return filepath.Join(dstRoot, strings.TrimPrefix(stored[i:], "/thumbnails/"))
	}
	return stored
}

func copyThumbsIfMissing(src, dst string) error {
	if src == "" {
		return nil
	}
	srcInfo, err := os.Stat(src)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("vr migration: thumb source %s not found, skipping copy", src)
			return nil
		}
		return err
	}
	if !srcInfo.IsDir() {
		return fmt.Errorf("thumb source %s is not a directory", src)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	copied := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		srcDir := filepath.Join(src, e.Name())
		dstDir := filepath.Join(dst, e.Name())
		if _, err := os.Stat(dstDir); err == nil {
			continue // already exists, leave alone
		}
		if err := copyTree(srcDir, dstDir); err != nil {
			log.Printf("vr migration: warning copying %s: %v", srcDir, err)
			continue
		}
		copied++
	}
	if copied > 0 {
		log.Printf("vr migration: copied %d thumbnail directories", copied)
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		defer out.Close()
		if _, err := io.Copy(out, in); err != nil {
			return err
		}
		return out.Chmod(info.Mode())
	})
}

func nullInt(n sql.NullInt64) any {
	if n.Valid {
		return n.Int64
	}
	return nil
}
func nullFloat(n sql.NullFloat64) any {
	if n.Valid {
		return n.Float64
	}
	return nil
}
func nullStr(n sql.NullString) any {
	if n.Valid {
		return n.String
	}
	return nil
}
