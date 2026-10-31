package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"xcleanup/internal/apply"
	"xcleanup/internal/patterns"
	"xcleanup/internal/scan"
	"xcleanup/internal/storage"
	"xcleanup/internal/store"
	"xcleanup/internal/thumbs"
	"xcleanup/internal/vr"
)

type ApplyProgress struct {
	Running    bool      `json:"running"`
	Bucket     string    `json:"bucket,omitempty"`
	Started    time.Time `json:"started,omitempty"`
	Finished   time.Time `json:"finished,omitempty"`
	Total      int64     `json:"total"`
	Done       int64     `json:"done"`
	SkippedVLC int64     `json:"skipped_vlc"`
	Failed     int64     `json:"failed"`
	Error      string    `json:"error,omitempty"`
}

type Server struct {
	Store      *store.Store
	Matcher    *patterns.Matcher
	Scanner    *scan.Scanner
	Thumbs     *thumbs.Manager
	Apply      *apply.Engine
	ArchiveDir string
	GroupedDir string
	TopDir     string
	VLCPath    string
	VR         *vr.Server
	Storage    *storage.Manager

	scanMu     sync.Mutex
	scanRun    bool
	scanCancel context.CancelFunc

	applyMu       sync.Mutex
	applyRun      bool
	applyProgress atomic.Pointer[ApplyProgress]

	groupedMu    sync.Mutex
	groupedCache atomic.Pointer[groupedSnapshot]
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/api/health", s.health)
	r.Get("/api/status", s.status)
	r.Get("/api/destinations", s.destinations)
	r.Get("/api/exclusions", s.exclusions)

	r.Post("/api/scan", s.startScan)
	r.Get("/api/scan/progress", s.scanProgress)

	r.Get("/api/files", s.listFiles)
	r.Patch("/api/files/{id}", s.updateFile)
	r.Post("/api/files/{id}/move-to-top", s.moveToTop)

	r.Get("/api/counts", s.counts)

	r.Post("/api/apply/preview", s.applyPreview)
	r.Post("/api/apply/commit", s.applyCommit)
	r.Get("/api/apply/progress", s.applyProgressEndpoint)

	r.Post("/api/cleanup-nonvideo/preview", s.cleanupPreview)
	r.Post("/api/cleanup-nonvideo/commit", s.cleanupCommit)

	r.Get("/api/thumb/{id}.jpg", s.thumb)
	r.Get("/api/thumb/{id}/{idx}.jpg", s.thumb)

	r.Get("/api/storage", s.storageGet)
	r.Post("/api/storage/refresh", s.storageRefresh)

	r.Get("/api/grouped/folders", s.groupedFolders)
	r.Get("/api/grouped/videos", s.groupedVideos)
	r.Get("/api/grouped/thumb", s.groupedThumb)
	r.Post("/api/grouped/action", s.groupedAction)
	r.Post("/api/grouped/delete-video", s.groupedDeleteVideo)

	r.Post("/api/thumbs/purge", s.thumbsPurge)

	r.Get("/api/top/videos", s.topVideos)
	r.Get("/api/top/thumb", s.topThumb)
	r.Post("/api/top/decision", s.topDecision)

	if s.VR != nil {
		s.VR.Mount(r)
	}

	return r
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	last, _ := s.Store.LastScan()
	excl, _ := scan.LoadVLCExclusions(s.VLCPath)
	counts, _ := s.Store.CountByStatus()
	disk, _ := diskUsage(s.ArchiveDir)
	var applyProg ApplyProgress
	if p := s.applyProgress.Load(); p != nil {
		applyProg = *p
	}
	writeJSON(w, 200, map[string]any{
		"archive_dir":     s.ArchiveDir,
		"grouped_dir":     s.GroupedDir,
		"top_dir":         s.TopDir,
		"vlc_path":        s.VLCPath,
		"exclusion_count": len(excl),
		"last_scan":       last,
		"scan_progress":   s.Scanner.Progress(),
		"apply_progress":  applyProg,
		"counts":          counts,
		"disk":            disk,
	})
}

func (s *Server) counts(w http.ResponseWriter, _ *http.Request) {
	c, err := s.Store.CountByStatus()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, c)
}

func (s *Server) destinations(w http.ResponseWriter, _ *http.Request) {
	names := make([]string, 0, len(s.Matcher.Destinations))
	for _, d := range s.Matcher.Destinations {
		names = append(names, d.Name)
	}
	writeJSON(w, 200, map[string]any{"destinations": names})
}

func (s *Server) exclusions(w http.ResponseWriter, _ *http.Request) {
	excl, err := scan.LoadVLCExclusions(s.VLCPath)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]string, 0, len(excl))
	for p := range excl {
		out = append(out, p)
	}
	writeJSON(w, 200, map[string]any{"paths": out, "count": len(out)})
}

func (s *Server) startScan(w http.ResponseWriter, _ *http.Request) {
	s.scanMu.Lock()
	if s.scanRun {
		s.scanMu.Unlock()
		writeErr(w, 409, "scan already running")
		return
	}
	s.scanRun = true
	ctx, cancel := context.WithCancel(context.Background())
	s.scanCancel = cancel
	s.scanMu.Unlock()

	go func() {
		_ = s.Scanner.Run(ctx)
		s.scanMu.Lock()
		s.scanRun = false
		s.scanCancel = nil
		s.scanMu.Unlock()
	}()
	writeJSON(w, 202, map[string]string{"status": "started"})
}

func (s *Server) scanProgress(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, s.Scanner.Progress())
}

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	files, total, err := s.Store.ListFiles(store.ListParams{Status: status, Limit: limit, Offset: offset})
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"files": filesToJSON(files),
		"total": total,
	})
}

type fileJSON struct {
	ID          int64            `json:"id"`
	Path        string           `json:"path"`
	Name        string           `json:"name"`
	Size        int64            `json:"size"`
	Mtime       int64            `json:"mtime"`
	Status      string           `json:"status"`
	Destination string           `json:"destination,omitempty"`
	Matched     []patterns.Match `json:"matched,omitempty"`
	Override    bool             `json:"override"`
	Extension   string           `json:"extension,omitempty"`
}

func filesToJSON(in []store.FileRecord) []fileJSON {
	out := make([]fileJSON, 0, len(in))
	for _, f := range in {
		var matched []patterns.Match
		if f.Matched != "" {
			_ = json.Unmarshal([]byte(f.Matched), &matched)
		}
		out = append(out, fileJSON{
			ID:          f.ID,
			Path:        f.Path,
			Name:        baseName(f.Path),
			Size:        f.Size,
			Mtime:       f.Mtime,
			Status:      f.Status,
			Destination: f.Destination,
			Matched:     matched,
			Override:    f.Override,
			Extension:   f.Extension,
		})
	}
	return out
}

func baseName(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[i+1:]
		}
	}
	return p
}

type updateReq struct {
	Status      string `json:"status"`
	Destination string `json:"destination"`
}

func (s *Server) updateFile(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	var body updateReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	switch body.Status {
	case "move", "delete", "keep", "fuzzy", "recent":
	default:
		writeErr(w, 400, "invalid status")
		return
	}
	if body.Status == "move" && body.Destination == "" {
		writeErr(w, 400, "destination required for move")
		return
	}
	if err := s.Store.UpdateFileStatus(id, body.Status, body.Destination); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

type applyReq struct {
	Bucket string  `json:"bucket"`
	IDs    []int64 `json:"ids"`
}

func (s *Server) moveToTop(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	f, err := s.Store.GetFile(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if f == nil {
		writeErr(w, 404, "not found")
		return
	}
	exclusions, _ := scan.LoadVLCExclusions(s.VLCPath)
	if _, inVLC := exclusions[f.Path]; inVLC {
		writeJSON(w, 409, s.Apply.SkippedForVLC(*f))
		return
	}
	res := s.Apply.MoveToTop(*f)
	if !res.Success {
		writeJSON(w, 500, res)
		return
	}
	writeJSON(w, 200, res)
}

func (s *Server) gatherForApply(req applyReq) ([]store.FileRecord, error) {
	switch req.Bucket {
	case "auto_moves":
		return s.Store.FilesByStatus("move")
	case "auto_deletes":
		return s.Store.FilesByStatus("delete")
	case "selected":
		return s.Store.FilesByIDs(req.IDs)
	}
	return nil, nil
}

func (s *Server) applyPreview(w http.ResponseWriter, r *http.Request) {
	var req applyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	files, err := s.gatherForApply(req)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	ops := make([]apply.Op, 0, len(files))
	for _, f := range files {
		op, err := s.Apply.PlanFile(f)
		if err != nil {
			ops = append(ops, apply.Op{ID: f.ID, Src: f.Path, Note: err.Error()})
			continue
		}
		ops = append(ops, op)
	}
	writeJSON(w, 200, map[string]any{"ops": ops, "count": len(ops)})
}

func (s *Server) applyCommit(w http.ResponseWriter, r *http.Request) {
	var req applyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}

	s.applyMu.Lock()
	if s.applyRun {
		s.applyMu.Unlock()
		writeErr(w, 409, "apply already running")
		return
	}
	s.applyRun = true
	s.applyMu.Unlock()
	defer func() {
		s.applyMu.Lock()
		s.applyRun = false
		s.applyMu.Unlock()
	}()

	files, err := s.gatherForApply(req)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	exclusions, _ := scan.LoadVLCExclusions(s.VLCPath)

	prog := &ApplyProgress{
		Running: true,
		Bucket:  req.Bucket,
		Started: time.Now(),
		Total:   int64(len(files)),
	}
	s.applyProgress.Store(prog)

	results := make([]apply.Result, 0, len(files))
	for _, f := range files {
		if _, inVLC := exclusions[f.Path]; inVLC {
			results = append(results, s.Apply.SkippedForVLC(f))
			atomic.AddInt64(&prog.SkippedVLC, 1)
			atomic.AddInt64(&prog.Done, 1)
			continue
		}
		op, err := s.Apply.PlanFile(f)
		if err != nil {
			results = append(results, apply.Result{Op: apply.Op{ID: f.ID, Src: f.Path}, Error: err.Error()})
			atomic.AddInt64(&prog.Failed, 1)
			atomic.AddInt64(&prog.Done, 1)
			continue
		}
		res := s.Apply.ExecuteOp(op)
		results = append(results, res)
		if !res.Success {
			atomic.AddInt64(&prog.Failed, 1)
		}
		atomic.AddInt64(&prog.Done, 1)
	}

	final := *prog
	final.Running = false
	final.Finished = time.Now()
	s.applyProgress.Store(&final)

	writeJSON(w, 200, map[string]any{
		"results":     results,
		"count":       len(results),
		"skipped_vlc": final.SkippedVLC,
		"failed":      final.Failed,
	})
}

func (s *Server) applyProgressEndpoint(w http.ResponseWriter, _ *http.Request) {
	var p ApplyProgress
	if cur := s.applyProgress.Load(); cur != nil {
		p = *cur
	}
	writeJSON(w, 200, p)
}

func (s *Server) cleanupPreview(w http.ResponseWriter, _ *http.Request) {
	excl, err := scan.LoadVLCExclusions(s.VLCPath)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	items, err := apply.PreviewCleanupNonVideo(s.ArchiveDir, excl)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "count": len(items)})
}

func (s *Server) cleanupCommit(w http.ResponseWriter, _ *http.Request) {
	excl, err := scan.LoadVLCExclusions(s.VLCPath)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	items, err := apply.PreviewCleanupNonVideo(s.ArchiveDir, excl)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	results := apply.ExecuteCleanup(items, s.Store)
	writeJSON(w, 200, map[string]any{"results": results, "count": len(results)})
}

func (s *Server) thumb(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, "invalid id")
		return
	}
	idx := 0
	if v := chi.URLParam(r, "idx"); v != "" {
		idx, err = strconv.Atoi(v)
		if err != nil {
			writeErr(w, 400, "invalid idx")
			return
		}
	}
	f, err := s.Store.GetFile(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if f == nil {
		writeErr(w, 404, "not found")
		return
	}
	path, err := s.Thumbs.EnsureThumb(r.Context(), f.Path, f.Size, idx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, path)
}
