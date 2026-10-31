package api

import (
	"io/fs"
	"net/http"
	"path/filepath"
	"time"

	"xcleanup/internal/scan"
	"xcleanup/internal/thumbs"
)

// liveThumbKeys walks every tree that can own an archive-side thumbnail and
// returns the set of cache keys still backed by a real file.
func (s *Server) liveThumbKeys() (map[string]struct{}, int) {
	keys := map[string]struct{}{}
	var seen int
	for _, root := range []string{s.ArchiveDir, s.GroupedDir, s.TopDir} {
		if root == "" {
			continue
		}
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !scan.IsVideo(path) {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			keys[thumbs.Key(path, info.Size())] = struct{}{}
			seen++
			return nil
		})
	}
	return keys, seen
}

// thumbsPurge deletes cache directories with no surviving source file. This
// exists because deletes historically left their stills behind; new deletes
// clean up inline, so this is a one-off/occasional reclaim.
func (s *Server) thumbsPurge(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	keys, seen := s.liveThumbKeys()

	dry := r.URL.Query().Get("dry") == "1"
	if dry {
		orphans, bytes, err := s.Thumbs.CountExcept(keys)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{
			"dry_run":      true,
			"live_videos":  seen,
			"orphan_dirs":  orphans,
			"orphan_bytes": bytes,
			"duration_ms":  time.Since(started).Milliseconds(),
		})
		return
	}

	removed, freed, err := s.Thumbs.PurgeExcept(keys)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.Store.LogAction("thumbs-purge", s.Thumbs.Dir, "", true, "")
	writeJSON(w, 200, map[string]any{
		"dry_run":      false,
		"live_videos":  seen,
		"removed_dirs": removed,
		"freed_bytes":  freed,
		"duration_ms":  time.Since(started).Milliseconds(),
	})
}
