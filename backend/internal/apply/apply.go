package apply

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"xcleanup/internal/scan"
	"xcleanup/internal/store"
)

type Op struct {
	ID          int64  `json:"id"`
	Op          string `json:"op"` // "move" or "delete"
	Src         string `json:"src"`
	Dst         string `json:"dst,omitempty"`
	Size        int64  `json:"size"`
	Note        string `json:"note,omitempty"`
}

type Result struct {
	Op
	Success bool   `json:"success"`
	Skipped bool   `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

type Engine struct {
	Store      *store.Store
	GroupedDir string
	ArchiveDir string
	TopDir     string
}

// MoveToTop immediately moves a file into TopDir, with the same parent-dir
// cleanup semantics as a normal move.
func (e *Engine) MoveToTop(f store.FileRecord) Result {
	dst := filepath.Join(e.TopDir, filepath.Base(f.Path))
	op := Op{ID: f.ID, Op: "move", Src: f.Path, Dst: dst, Size: f.Size, Note: "top"}
	return e.ExecuteOp(op)
}

// SkippedForVLC builds a Result indicating the action was blocked because the
// file is currently in the VLC media library. Also flips the DB row to "keep"
// so it stops appearing in move/delete buckets on subsequent refreshes.
func (e *Engine) SkippedForVLC(f store.FileRecord) Result {
	_ = e.Store.UpdateFileStatus(f.ID, "keep", "")
	_ = e.Store.LogAction("skip-vlc", f.Path, "", true, "")
	return Result{
		Op:      Op{ID: f.ID, Op: "skip", Src: f.Path, Size: f.Size, Note: "in VLC"},
		Skipped: true,
	}
}

func (e *Engine) PlanFile(f store.FileRecord) (Op, error) {
	switch f.Status {
	case "move":
		if f.Destination == "" {
			return Op{}, fmt.Errorf("file %d has status=move but no destination", f.ID)
		}
		dst := filepath.Join(e.GroupedDir, f.Destination, filepath.Base(f.Path))
		return Op{ID: f.ID, Op: "move", Src: f.Path, Dst: dst, Size: f.Size}, nil
	case "delete":
		return Op{ID: f.ID, Op: "delete", Src: f.Path, Size: f.Size}, nil
	default:
		return Op{}, fmt.Errorf("file %d status %q is not actionable", f.ID, f.Status)
	}
}

// ExecuteOp performs a single move or delete and cleans up the parent dir
// if it becomes empty of videos. It logs the action.
func (e *Engine) ExecuteOp(op Op) Result {
	res := Result{Op: op}
	switch op.Op {
	case "move":
		if err := os.MkdirAll(filepath.Dir(op.Dst), 0o755); err != nil {
			res.Error = err.Error()
			_ = e.Store.LogAction("move", op.Src, op.Dst, false, err.Error())
			return res
		}
		if err := moveFile(op.Src, op.Dst); err != nil {
			res.Error = err.Error()
			_ = e.Store.LogAction("move", op.Src, op.Dst, false, err.Error())
			return res
		}
		res.Success = true
		_ = e.Store.LogAction("move", op.Src, op.Dst, true, "")
		e.tryCleanupParent(op.Src)
		_ = e.Store.DeleteFileRow(op.ID)
		return res
	case "delete":
		if err := os.Remove(op.Src); err != nil {
			res.Error = err.Error()
			_ = e.Store.LogAction("delete", op.Src, "", false, err.Error())
			return res
		}
		res.Success = true
		_ = e.Store.LogAction("delete", op.Src, "", true, "")
		e.tryCleanupParent(op.Src)
		_ = e.Store.DeleteFileRow(op.ID)
		return res
	default:
		res.Error = "unknown op"
		return res
	}
}

// tryCleanupParent removes the directory containing src if it sits under
// ArchiveDir, is not ArchiveDir itself, and contains no remaining video files.
// Cascades up.
func (e *Engine) tryCleanupParent(src string) {
	dir := filepath.Dir(src)
	for {
		// Must be strictly under ArchiveDir.
		if !strings.HasPrefix(dir, e.ArchiveDir+string(filepath.Separator)) {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		hasVideo := false
		for _, ent := range entries {
			if ent.IsDir() {
				hasVideo = true
				break
			}
			if scan.IsVideo(ent.Name()) {
				hasVideo = true
				break
			}
		}
		if hasVideo {
			return
		}
		// Remove all non-video junk first, then the empty dir.
		for _, ent := range entries {
			full := filepath.Join(dir, ent.Name())
			if err := os.Remove(full); err != nil {
				_ = e.Store.LogAction("delete-junk", full, "", false, err.Error())
				return
			}
			_ = e.Store.LogAction("delete-junk", full, "", true, "")
		}
		if err := os.Remove(dir); err != nil {
			_ = e.Store.LogAction("rmdir", dir, "", false, err.Error())
			return
		}
		_ = e.Store.LogAction("rmdir", dir, "", true, "")
		dir = filepath.Dir(dir)
	}
}

func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// Cross-device fallback: copy + remove.
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

// PreviewCleanupNonVideo lists non-video files and empty dirs in archive,
// excluding any path in exclusions.
type CleanupItem struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // "file" | "dir"
	Size int64  `json:"size,omitempty"`
}

func PreviewCleanupNonVideo(archiveDir string, exclusions map[string]struct{}) ([]CleanupItem, error) {
	var items []CleanupItem

	// First pass: collect non-video files.
	err := filepath.Walk(archiveDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if path == archiveDir {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if _, ok := exclusions[path]; ok {
			return nil
		}
		if scan.IsVideo(path) {
			return nil
		}
		items = append(items, CleanupItem{Path: path, Kind: "file", Size: info.Size()})
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Second pass: identify dirs that would become empty after the above
	// files are removed. We approximate by checking for any video file under
	// each dir (recursively) — if none and no exclusions live under it, mark
	// the dir for removal.
	excludedDirs := map[string]struct{}{}
	for p := range exclusions {
		d := filepath.Dir(p)
		for d != archiveDir && d != "/" && d != "." {
			excludedDirs[d] = struct{}{}
			d = filepath.Dir(d)
		}
	}

	err = filepath.Walk(archiveDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if !info.IsDir() || path == archiveDir {
			return nil
		}
		if _, ok := excludedDirs[path]; ok {
			return nil
		}
		hasVideo, _ := containsVideo(path)
		if hasVideo {
			return nil
		}
		items = append(items, CleanupItem{Path: path, Kind: "dir"})
		return filepath.SkipDir
	})
	return items, err
}

func containsVideo(dir string) (bool, error) {
	found := false
	err := filepath.Walk(dir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		if scan.IsVideo(path) {
			found = true
			return errStop
		}
		return nil
	})
	if errors.Is(err, errStop) {
		return found, nil
	}
	return found, err
}

var errStop = errors.New("stop")

// ExecuteCleanup runs the cleanup plan: deletes files first, then dirs (deepest first).
func ExecuteCleanup(items []CleanupItem, s *store.Store) []Result {
	results := make([]Result, 0, len(items))

	// Files first.
	for _, it := range items {
		if it.Kind != "file" {
			continue
		}
		r := Result{Op: Op{Op: "delete", Src: it.Path, Size: it.Size}}
		if err := os.Remove(it.Path); err != nil {
			r.Error = err.Error()
			_ = s.LogAction("cleanup-file", it.Path, "", false, err.Error())
		} else {
			r.Success = true
			_ = s.LogAction("cleanup-file", it.Path, "", true, "")
		}
		results = append(results, r)
	}

	// Dirs: deepest first.
	dirs := []string{}
	for _, it := range items {
		if it.Kind == "dir" {
			dirs = append(dirs, it.Path)
		}
	}
	// sort by depth desc
	for i := 0; i < len(dirs); i++ {
		for j := i + 1; j < len(dirs); j++ {
			if depth(dirs[j]) > depth(dirs[i]) {
				dirs[i], dirs[j] = dirs[j], dirs[i]
			}
		}
	}
	for _, d := range dirs {
		r := Result{Op: Op{Op: "rmdir", Src: d}}
		if err := os.RemoveAll(d); err != nil {
			r.Error = err.Error()
			_ = s.LogAction("cleanup-dir", d, "", false, err.Error())
		} else {
			r.Success = true
			_ = s.LogAction("cleanup-dir", d, "", true, "")
		}
		results = append(results, r)
	}
	return results
}

func depth(p string) int { return strings.Count(p, string(filepath.Separator)) }
