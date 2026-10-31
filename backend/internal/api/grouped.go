package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"xcleanup/internal/scan"
)

const (
	// groupedNewFolderDays hides folders whose contents were added recently —
	// they haven't been sitting around long enough to be worth a verdict.
	groupedNewFolderDays = 30
	// groupedSampleCount is how many stills each folder row shows.
	groupedSampleCount = 8
	// groupedCacheTTL bounds how often we re-walk the grouped tree, which is
	// large enough that doing it per-request would be painful.
	groupedCacheTTL = 10 * time.Minute
	// groupedWalkCap stops a single pathological folder from dominating a scan.
	groupedWalkCap = 5000
)

type GroupedSample struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type GroupedFolder struct {
	Name       string          `json:"name"`
	Path       string          `json:"path"`
	VideoCount int             `json:"video_count"`
	TotalSize  int64           `json:"total_size"`
	Mtime      int64           `json:"mtime"`
	Samples    []GroupedSample `json:"samples"`
}

type groupedSnapshot struct {
	Folders    []GroupedFolder `json:"folders"`
	ComputedAt time.Time       `json:"computed_at"`
	DurationMs int64           `json:"duration_ms"`
}

// excludedGroupedRoots returns the top-level names under GroupedDir that the
// review tab must never surface: the VR library, and every folder that is the
// landing zone for an auto-move destination (those are already-decided
// keepers).
func (s *Server) excludedGroupedRoots() map[string]struct{} {
	out := map[string]struct{}{"vr": {}}
	for _, d := range s.Matcher.Destinations {
		name := strings.TrimPrefix(filepath.Clean(d.Name), "./")
		if name == "" || name == "." {
			continue
		}
		// "organized/netvideogirls" excludes the whole "organized" tree.
		root := strings.SplitN(name, string(filepath.Separator), 2)[0]
		out[root] = struct{}{}
	}
	return out
}

// scanGroupedFolder walks one top-level folder, counting videos and picking
// stills from videos spread across the folder rather than the first N.
func scanGroupedFolder(dir string) (int, int64, int64, []GroupedSample) {
	type vid struct {
		path string
		size int64
	}
	var vids []vid
	var totalSize int64
	var newest int64

	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !scan.IsVideo(path) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		totalSize += info.Size()
		if m := info.ModTime().Unix(); m > newest {
			newest = m
		}
		if len(vids) < groupedWalkCap {
			vids = append(vids, vid{path: path, size: info.Size()})
		}
		return nil
	})

	sort.Slice(vids, func(i, j int) bool { return vids[i].path < vids[j].path })

	samples := make([]GroupedSample, 0, groupedSampleCount)
	if n := len(vids); n > 0 {
		want := groupedSampleCount
		if want > n {
			want = n
		}
		for i := 0; i < want; i++ {
			// Evenly spaced picks across the sorted list.
			v := vids[i*n/want]
			samples = append(samples, GroupedSample{
				Path: v.path,
				Name: filepath.Base(v.path),
				Size: v.size,
			})
		}
	}
	return len(vids), totalSize, newest, samples
}

func (s *Server) computeGrouped() groupedSnapshot {
	started := time.Now()
	excluded := s.excludedGroupedRoots()
	kept, _ := s.Store.ReviewedPaths("grouped_reviews", "keep")
	cutoff := started.AddDate(0, 0, -groupedNewFolderDays).Unix()

	entries, err := os.ReadDir(s.GroupedDir)
	if err != nil {
		return groupedSnapshot{ComputedAt: started, DurationMs: time.Since(started).Milliseconds()}
	}

	type job struct {
		name string
		path string
	}
	var jobs []job
	for _, ent := range entries {
		if !ent.IsDir() || strings.HasPrefix(ent.Name(), ".") {
			continue
		}
		if _, skip := excluded[ent.Name()]; skip {
			continue
		}
		full := filepath.Join(s.GroupedDir, ent.Name())
		if _, ok := kept[full]; ok {
			continue
		}
		jobs = append(jobs, job{name: ent.Name(), path: full})
	}

	results := make([]GroupedFolder, len(jobs))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Add(1)
		go func(i int, j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			count, size, mtime, samples := scanGroupedFolder(j.path)
			results[i] = GroupedFolder{
				Name:       j.name,
				Path:       j.path,
				VideoCount: count,
				TotalSize:  size,
				Mtime:      mtime,
				Samples:    samples,
			}
		}(i, j)
	}
	wg.Wait()

	folders := make([]GroupedFolder, 0, len(results))
	for _, f := range results {
		if f.VideoCount == 0 {
			continue
		}
		// Skip folders whose newest video landed inside the recent window.
		if f.Mtime >= cutoff {
			continue
		}
		folders = append(folders, f)
	}
	sort.Slice(folders, func(i, j int) bool { return folders[i].TotalSize > folders[j].TotalSize })

	return groupedSnapshot{
		Folders:    folders,
		ComputedAt: started,
		DurationMs: time.Since(started).Milliseconds(),
	}
}

func (s *Server) groupedFolders(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"

	s.groupedMu.Lock()
	defer s.groupedMu.Unlock()

	if !force {
		if cur := s.groupedCache.Load(); cur != nil && time.Since(cur.ComputedAt) < groupedCacheTTL {
			writeJSON(w, 200, cur)
			return
		}
	}
	snap := s.computeGrouped()
	s.groupedCache.Store(&snap)
	writeJSON(w, 200, snap)
}

// groupedThumb serves a still for an arbitrary video under GroupedDir. The
// files/{id} thumb route can't be used here because grouped videos are not
// rows in the archive `files` table.
func (s *Server) groupedThumb(w http.ResponseWriter, r *http.Request) {
	s.serveThumbByPath(w, r, s.GroupedDir)
}

// serveThumbByPath is the shared path-keyed thumbnail handler for the grouped
// and top trees.
func (s *Server) serveThumbByPath(w http.ResponseWriter, r *http.Request, root string) {
	p, err := resolveUnder(root, r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	info, err := os.Stat(p)
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	if info.IsDir() || !scan.IsVideo(p) {
		writeErr(w, 400, "not a video file")
		return
	}
	idx := 0
	if v := r.URL.Query().Get("idx"); v != "" {
		idx, err = strconv.Atoi(v)
		if err != nil {
			writeErr(w, 400, "invalid idx")
			return
		}
	}
	out, err := s.Thumbs.EnsureThumbSpread(r.Context(), p, info.Size(), idx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, r, out)
}

type GroupedVideo struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Rel   string `json:"rel"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

// collectVideos lists every video under dir, recursively.
func collectVideos(dir string) []GroupedVideo {
	var out []GroupedVideo
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !scan.IsVideo(path) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			rel = filepath.Base(path)
		}
		out = append(out, GroupedVideo{
			Path:  path,
			Name:  filepath.Base(path),
			Rel:   rel,
			Size:  info.Size(),
			Mtime: info.ModTime().Unix(),
		})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Rel < out[j].Rel })
	return out
}

// groupedVideos backs the drill-in view: every video in one folder, so the
// user can delete individual files instead of taking the whole folder.
func (s *Server) groupedVideos(w http.ResponseWriter, r *http.Request) {
	p, err := resolveUnder(s.GroupedDir, r.URL.Query().Get("path"))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	info, err := os.Stat(p)
	if err != nil || !info.IsDir() {
		writeErr(w, 404, "folder not found")
		return
	}
	vids := collectVideos(p)
	var total int64
	for _, v := range vids {
		total += v.Size
	}
	writeJSON(w, 200, map[string]any{
		"folder":     p,
		"name":       filepath.Base(p),
		"videos":     vids,
		"total":      len(vids),
		"total_size": total,
	})
}

type groupedVideoDeleteReq struct {
	Path string `json:"path"`
}

// groupedDeleteVideo removes a single video from a grouped folder, along with
// its cached stills.
func (s *Server) groupedDeleteVideo(w http.ResponseWriter, r *http.Request) {
	var req groupedVideoDeleteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	p, err := resolveUnder(s.GroupedDir, req.Path)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !scan.IsVideo(p) {
		writeErr(w, 400, "not a video file")
		return
	}
	var size int64
	if info, err := os.Stat(p); err == nil {
		size = info.Size()
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		_ = s.Store.LogAction("grouped-delete-video", p, "", false, err.Error())
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.Thumbs.Remove(p, size)
	_ = s.Store.LogAction("grouped-delete-video", p, "", true, "")

	// The folder's counts and samples are now stale.
	s.groupedMu.Lock()
	s.groupedCache.Store(nil)
	s.groupedMu.Unlock()

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

type groupedActionReq struct {
	Path     string `json:"path"`
	Decision string `json:"decision"` // "keep" | "delete"
}

func (s *Server) groupedAction(w http.ResponseWriter, r *http.Request) {
	var req groupedActionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	p, err := resolveUnder(s.GroupedDir, req.Path)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if p == filepath.Clean(s.GroupedDir) {
		writeErr(w, 400, "refusing to act on the grouped root")
		return
	}
	// Only ever act on a direct child of GroupedDir — the review UI is
	// folder-level and this keeps a crafted nested path from deleting a
	// subtree the user never saw.
	if filepath.Dir(p) != filepath.Clean(s.GroupedDir) {
		writeErr(w, 400, "path must be a direct child of the grouped root")
		return
	}
	if _, skip := s.excludedGroupedRoots()[filepath.Base(p)]; skip {
		writeErr(w, 400, "folder is excluded from grouped review")
		return
	}

	switch req.Decision {
	case "keep":
		if err := s.Store.SetReview("grouped_reviews", p, "keep"); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Store.LogAction("grouped-keep", p, "", true, "")
	case "delete":
		// Capture the videos first so their cached stills can be dropped —
		// once the tree is gone the sizes needed to derive each key are too.
		doomed := collectVideos(p)
		if err := os.RemoveAll(p); err != nil {
			_ = s.Store.LogAction("grouped-delete", p, "", false, err.Error())
			writeErr(w, 500, err.Error())
			return
		}
		for _, v := range doomed {
			_ = s.Thumbs.Remove(v.Path, v.Size)
		}
		if err := s.Store.SetReview("grouped_reviews", p, "delete"); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		_ = s.Store.LogAction("grouped-delete", p, "", true, "")
	default:
		writeErr(w, 400, "decision must be keep or delete")
		return
	}

	// Drop the folder from the cached snapshot so the row disappears without
	// forcing a full re-walk.
	s.groupedMu.Lock()
	if cur := s.groupedCache.Load(); cur != nil {
		next := *cur
		next.Folders = make([]GroupedFolder, 0, len(cur.Folders))
		for _, f := range cur.Folders {
			if f.Path != p {
				next.Folders = append(next.Folders, f)
			}
		}
		s.groupedCache.Store(&next)
	}
	s.groupedMu.Unlock()

	writeJSON(w, 200, map[string]string{"status": "ok"})
}
