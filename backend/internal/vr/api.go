package vr

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"xcleanup/internal/events"
)

// IsProtectedPath reports whether the file lives in a "/top/" folder, which
// the user keeps as a manually-curated save set.
func IsProtectedPath(p string) bool {
	return strings.Contains(p, "/top/")
}

type Server struct {
	Store       *Store
	Indexer     *Indexer
	Thumbnailer *Thumbnailer
	Bus         *events.Bus
	ThumbDir    string
}

func (s *Server) Mount(r chi.Router) {
	r.Get("/api/vr/events", s.Bus.Handler())

	r.Get("/api/vr/folders", s.listFolders)
	r.Post("/api/vr/folders/scan", s.scanFolder)
	r.Post("/api/vr/folders/auto-scan", s.autoScan)
	r.Delete("/api/vr/folders/{id}", s.deleteFolder)

	r.Get("/api/vr/videos", s.listVideos)
	r.Patch("/api/vr/videos/{id}", s.updateVideo)
	r.Delete("/api/vr/videos/{id}", s.deleteVideo)
	r.Post("/api/vr/videos/{id}/thumbnails", s.moreThumbs)

	r.Get("/api/vr/move-history", s.moveHistory)
	r.Get("/api/vr/settings", s.getSettings)
	r.Put("/api/vr/settings", s.putSettings)

	// Thumbnail file server: /api/vr/thumb/<hash>/<timestamp>.jpg
	// chi captures up through the final segment; `*` is the simplest way to
	// admit a filename with a dot extension.
	r.Get("/api/vr/thumb/{hash}/*", s.serveThumb)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ----- folders -----

func (s *Server) listFolders(w http.ResponseWriter, _ *http.Request) {
	out, err := s.Store.ListFolders()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if out == nil {
		out = []Folder{}
	}
	writeJSON(w, 200, out)
}

func (s *Server) scanFolder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
		writeErr(w, 400, "path is required")
		return
	}
	res, err := s.Indexer.IndexFolder(r.Context(), body.Path)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	go s.runBackgroundJobs(res.FolderID)
	writeJSON(w, 200, res)
}

func (s *Server) autoScan(w http.ResponseWriter, r *http.Request) {
	folders, err := s.Store.ListFolders()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if len(folders) == 0 {
		writeErr(w, 404, "no folders to auto-scan")
		return
	}
	for _, f := range folders {
		res, err := s.Indexer.IndexFolder(r.Context(), f.Path)
		if err != nil {
			continue
		}
		go s.runBackgroundJobs(res.FolderID)
		writeJSON(w, 200, res)
		return
	}
	writeErr(w, 404, "no valid folders to auto-scan")
}

func (s *Server) runBackgroundJobs(folderID int64) {
	ctx := context.Background()
	_ = s.Indexer.ProbeAll(ctx, folderID)
	s.Thumbnailer.Run(ctx)
}

func (s *Server) deleteFolder(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	f, err := s.Store.GetFolder(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if f == nil {
		writeErr(w, 404, "not found")
		return
	}
	if err := s.Store.DeleteFolderCascade(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ----- videos -----

func (s *Server) listVideos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var folderID *int64
	if v := q.Get("folderId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			folderID = &id
		}
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	sort := q.Get("sort")
	order := q.Get("order")

	videos, total, err := s.Store.ListVideos(ListVideosParams{
		FolderID:  folderID,
		SortField: sort,
		SortOrder: order,
		Limit:     limit,
		Offset:    (page - 1) * limit,
	})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if videos == nil {
		videos = []Video{}
	}
	writeJSON(w, 200, map[string]any{
		"videos": videos, "total": total, "page": page, "limit": limit,
	})
}

func (s *Server) updateVideo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	v, err := s.Store.GetVideo(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if v == nil {
		writeErr(w, 404, "not found")
		return
	}

	var body struct {
		Rename     string `json:"rename"`
		MoveTo     string `json:"moveTo"`
		StereoMode string `json:"stereoMode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}

	if body.StereoMode != "" {
		if body.StereoMode != "sbs" && body.StereoMode != "tb" {
			writeErr(w, 400, "stereoMode must be sbs or tb")
			return
		}
		if err := s.Store.UpdateVideoStereoMode(id, body.StereoMode); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if body.Rename == "" && body.MoveTo == "" {
			writeJSON(w, 200, map[string]bool{"ok": true})
			return
		}
	}

	if body.Rename != "" {
		newPath := filepath.Join(filepath.Dir(v.Path), body.Rename)
		if _, err := os.Stat(newPath); err == nil {
			writeErr(w, 409, "file already exists at destination")
			return
		}
		if err := os.Rename(v.Path, newPath); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if err := s.Store.UpdateVideoPath(id, newPath, body.Rename); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "path": newPath})
		return
	}

	if body.MoveTo != "" {
		dst := filepath.Join(body.MoveTo, v.Filename)
		if _, err := os.Stat(dst); err == nil {
			writeErr(w, 409, "file already exists at destination")
			return
		}
		if err := os.MkdirAll(body.MoveTo, 0o755); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if err := moveFile(v.Path, dst); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if err := s.Store.UpdateVideoPath(id, dst, v.Filename); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Store.RecordMove(body.MoveTo)
		writeJSON(w, 200, map[string]any{"ok": true, "path": dst})
		return
	}

	writeErr(w, 400, "provide rename, moveTo, or stereoMode")
}

func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Remove(src)
}

func (s *Server) deleteVideo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	v, err := s.Store.GetVideo(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if v == nil {
		writeErr(w, 404, "not found")
		return
	}

	if IsProtectedPath(v.Path) {
		writeErr(w, 403, "files in /top/ folders are protected and cannot be deleted")
		return
	}

	if err := os.Remove(v.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeErr(w, 500, err.Error())
		return
	}
	if v.ThumbHash != nil && *v.ThumbHash != "" {
		_ = os.RemoveAll(filepath.Join(s.ThumbDir, *v.ThumbHash))
	}
	if err := s.Store.DeleteVideoCascade(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) moreThumbs(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	var body struct {
		Count int `json:"count"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	count := body.Count
	if count < 1 {
		count = 15
	}
	if count > 50 {
		count = 50
	}
	go func() {
		_ = s.Thumbnailer.GenerateMore(context.Background(), id, count)
	}()
	writeJSON(w, 200, map[string]any{"ok": true, "generating": count})
}

// ----- misc -----

func (s *Server) moveHistory(w http.ResponseWriter, _ *http.Request) {
	out, err := s.Store.MoveHistory()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if out == nil {
		out = []string{}
	}
	writeJSON(w, 200, out)
}

func (s *Server) getSettings(w http.ResponseWriter, _ *http.Request) {
	out, err := s.Store.GetSettings()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	if err := s.Store.PutSettings(body); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) serveThumb(w http.ResponseWriter, r *http.Request) {
	hash := chi.URLParam(r, "hash")
	filename := chi.URLParam(r, "*")
	if hash == "" || filename == "" {
		writeErr(w, 400, "invalid params")
		return
	}
	// Reject any path traversal attempts; allowlist `<floatTs>.jpg`.
	if filepath.Base(filename) != filename {
		writeErr(w, 400, "invalid filename")
		return
	}
	p := filepath.Join(s.ThumbDir, hash, filename)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, p)
}
