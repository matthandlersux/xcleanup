package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"

	"xcleanup/internal/scan"
	"xcleanup/internal/thumbs"
)

// TopInitialFrames is how many stills the review lightbox loads per video
// before the user asks for more.
const TopInitialFrames = 5

type TopVideo struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

// topVideos lists everything in the top tree still awaiting a verdict.
// Anything previously marked "keep" is filtered out permanently.
func (s *Server) topVideos(w http.ResponseWriter, _ *http.Request) {
	kept, err := s.Store.ReviewedPaths("top_reviews", "keep")
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	var out []TopVideo
	err = filepath.WalkDir(s.TopDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !scan.IsVideo(path) {
			return nil
		}
		if _, ok := kept[path]; ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		out = append(out, TopVideo{
			Path:  path,
			Name:  filepath.Base(path),
			Size:  info.Size(),
			Mtime: info.ModTime().Unix(),
		})
		return nil
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })

	writeJSON(w, 200, map[string]any{
		"videos":         out,
		"total":          len(out),
		"initial_frames": TopInitialFrames,
		"max_frames":     thumbs.MaxSpreadFrames,
	})
}

func (s *Server) topThumb(w http.ResponseWriter, r *http.Request) {
	s.serveThumbByPath(w, r, s.TopDir)
}

type topDecisionReq struct {
	Path     string `json:"path"`
	Decision string `json:"decision"` // "keep" | "delete"
}

func (s *Server) topDecision(w http.ResponseWriter, r *http.Request) {
	var req topDecisionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	p, err := resolveUnder(s.TopDir, req.Path)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !scan.IsVideo(p) {
		writeErr(w, 400, "not a video file")
		return
	}

	switch req.Decision {
	case "keep":
		if err := s.Store.SetReview("top_reviews", p, "keep"); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Store.LogAction("top-keep", p, "", true, "")
	case "delete":
		// Stat before removing — the thumb cache key needs the file size.
		var size int64
		if info, err := os.Stat(p); err == nil {
			size = info.Size()
		}
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			_ = s.Store.LogAction("top-delete", p, "", false, err.Error())
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Thumbs.Remove(p, size)
		if err := s.Store.SetReview("top_reviews", p, "delete"); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Store.LogAction("top-delete", p, "", true, "")
	default:
		writeErr(w, 400, "decision must be keep or delete")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
