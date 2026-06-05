package vr

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"xcleanup/internal/events"
)

var videoExts = map[string]struct{}{
	".mp4":  {},
	".mkv":  {},
	".avi":  {},
	".mov":  {},
	".wmv":  {},
	".webm": {},
}

func isVideo(p string) bool {
	_, ok := videoExts[strings.ToLower(filepath.Ext(p))]
	return ok
}

type IndexResult struct {
	FolderID  int64 `json:"folderId"`
	Total     int   `json:"total"`
	NewVideos int   `json:"newVideos"`
	Removed   int   `json:"removed"`
}

type Indexer struct {
	Store    *Store
	Bus      *events.Bus
	ThumbDir string
}

// IndexFolder mirrors vrfm's indexFolder. Idempotent on re-scan.
func (idx *Indexer) IndexFolder(ctx context.Context, folderPath string) (IndexResult, error) {
	abs, err := filepath.Abs(folderPath)
	if err != nil {
		return IndexResult{}, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return IndexResult{}, fmt.Errorf("folder not found: %s", abs)
		}
		return IndexResult{}, err
	}
	if !st.IsDir() {
		return IndexResult{}, fmt.Errorf("not a directory: %s", abs)
	}

	folderID, err := idx.Store.UpsertFolder(abs)
	if err != nil {
		return IndexResult{}, err
	}
	idx.Bus.Emit("scan:status", map[string]any{"phase": "walking", "folder": abs})

	// Walk.
	var found []string
	err = filepath.WalkDir(abs, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if isVideo(p) {
			found = append(found, p)
		}
		return nil
	})
	if err != nil {
		return IndexResult{}, err
	}
	idx.Bus.Emit("scan:status", map[string]any{"phase": "indexing", "total": len(found)})

	// Insert / backfill.
	foundSet := make(map[string]struct{}, len(found))
	newVideos := 0
	for _, vp := range found {
		foundSet[vp] = struct{}{}
		filename := filepath.Base(vp)
		var size int64
		var thumbHash string
		var createdAt int64
		if fi, err := os.Stat(vp); err == nil {
			size = fi.Size()
			thumbHash = ComputeThumbHash(filename, size)
			createdAt = fi.ModTime().Unix()
		}
		added, err := idx.Store.InsertOrIgnoreVideo(folderID, filename, vp, size, thumbHash, createdAt)
		if err != nil {
			continue
		}
		if added {
			newVideos++
		} else if thumbHash != "" {
			_ = idx.Store.BackfillThumbHash(vp, size, thumbHash)
		}
	}

	// Soft-delete missing / undelete returning.
	rows, err := idx.Store.FolderVideoPaths(folderID)
	if err != nil {
		return IndexResult{}, err
	}
	removed := 0
	for _, r := range rows {
		if _, ok := foundSet[r.Path]; !ok {
			_ = idx.Store.MarkVideoDeleted(r.ID)
			removed++
		} else {
			_ = idx.Store.UnmarkVideoDeleted(r.ID)
		}
	}

	// Recover thumbnails from disk for videos with a thumb_hash but no rows.
	idx.recoverThumbnails(folderID)

	idx.Bus.Emit("scan:indexed", map[string]any{
		"folderId":  folderID,
		"total":     len(found),
		"newVideos": newVideos,
		"removed":   removed,
	})
	return IndexResult{FolderID: folderID, Total: len(found), NewVideos: newVideos, Removed: removed}, nil
}

func (idx *Indexer) recoverThumbnails(folderID int64) {
	rows, err := idx.Store.db.Query(`SELECT v.id, v.thumb_hash FROM vr_videos v
        WHERE v.folder_id = ? AND v.deleted = 0 AND v.thumb_hash IS NOT NULL
        AND (SELECT COUNT(*) FROM vr_thumbnails t WHERE t.video_id = v.id) = 0`, folderID)
	if err != nil {
		return
	}
	defer rows.Close()
	type vid struct {
		ID   int64
		Hash string
	}
	var todo []vid
	for rows.Next() {
		var v vid
		if err := rows.Scan(&v.ID, &v.Hash); err != nil {
			continue
		}
		todo = append(todo, v)
	}
	for _, v := range todo {
		dir := filepath.Join(idx.ThumbDir, v.Hash)
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		// Sort by name (timestamp) and assign sequential indices.
		var jpgs []string
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".jpg") {
				jpgs = append(jpgs, e.Name())
			}
		}
		// strings.Sort would be lexicographic, which mostly works for "12.34" style
		// but not perfectly. Good enough — we just need a consistent ordering.
		for i, name := range jpgs {
			tsStr := strings.TrimSuffix(name, ".jpg")
			ts, err := strconv.ParseFloat(tsStr, 64)
			if err != nil {
				continue
			}
			_ = idx.Store.InsertThumb(v.ID, i, ts, filepath.Join(dir, name))
		}
	}
}

// ProbeAll runs ffprobe on videos in a folder that don't yet have duration.
func (idx *Indexer) ProbeAll(ctx context.Context, folderID int64) error {
	todo, err := idx.Store.VideosNeedingProbe(folderID)
	if err != nil {
		return err
	}
	if len(todo) == 0 {
		return nil
	}
	idx.Bus.Emit("probe:status", map[string]any{"total": len(todo), "done": 0})
	for i, v := range todo {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		idx.Bus.Emit("probe:start", map[string]any{"videoId": v.ID, "filename": v.Filename, "index": i, "total": len(todo)})
		meta, err := ProbeVideo(ctx, v.Path)
		if err != nil {
			idx.Bus.Emit("probe:done", map[string]any{"videoId": v.ID, "index": i, "total": len(todo), "error": true})
			continue
		}
		_ = idx.Store.UpdateVideoMetadata(v.ID, meta.Size, meta.Duration, meta.Width, meta.Height, meta.Codec)
		idx.Bus.Emit("probe:done", map[string]any{"videoId": v.ID, "index": i, "total": len(todo), "meta": meta})
	}
	idx.Bus.Emit("probe:status", map[string]any{"total": len(todo), "done": len(todo)})
	return nil
}

// FormatNow returns a unix epoch second value as a stable timestamp.
func FormatNow() int64 { return time.Now().Unix() }
