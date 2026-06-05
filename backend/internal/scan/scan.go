package scan

import (
	"context"
	"encoding/json"
	"io/fs"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"xcleanup/internal/patterns"
	"xcleanup/internal/store"
)

var videoExts = map[string]struct{}{
	".mp4":  {},
	".mkv":  {},
	".avi":  {},
	".mov":  {},
	".wmv":  {},
	".webm": {},
	".m4v":  {},
	".ts":   {},
	".f4v":  {},
}

// IsVideo reports whether p has a recognized video extension.
func IsVideo(p string) bool {
	ext := strings.ToLower(filepath.Ext(p))
	_, ok := videoExts[ext]
	return ok
}

// RecentDays is the safety window: files whose mtime is within this many days
// of the scan start are protected from auto-delete (status=recent instead).
const RecentDays = 30

type Progress struct {
	Running  bool      `json:"running"`
	Started  time.Time `json:"started"`
	Finished time.Time `json:"finished,omitempty"`
	Walked   int64     `json:"walked"`
	Total    int64     `json:"total"`
	Move     int64     `json:"move"`
	Delete   int64     `json:"delete"`
	Fuzzy    int64     `json:"fuzzy"`
	Keep     int64     `json:"keep"`
	Recent   int64     `json:"recent"`
	Error    string    `json:"error,omitempty"`
}

type Scanner struct {
	ArchiveDir  string
	VLCPath     string
	Matcher     *patterns.Matcher
	Store       *store.Store

	progress atomic.Pointer[Progress]
}

func New(archiveDir, vlcPath string, m *patterns.Matcher, s *store.Store) *Scanner {
	sc := &Scanner{ArchiveDir: archiveDir, VLCPath: vlcPath, Matcher: m, Store: s}
	sc.progress.Store(&Progress{})
	return sc
}

func (s *Scanner) Progress() Progress {
	return *s.progress.Load()
}

// Run does a full scan. Should be invoked in a goroutine; only one at a time.
func (s *Scanner) Run(ctx context.Context) error {
	p := &Progress{Running: true, Started: time.Now()}
	s.progress.Store(p)

	exclusions, err := LoadVLCExclusions(s.VLCPath)
	if err != nil {
		p.Error = err.Error()
		p.Running = false
		p.Finished = time.Now()
		s.progress.Store(p)
		return err
	}

	if err := s.Store.ClearFiles(); err != nil {
		p.Error = err.Error()
		p.Running = false
		p.Finished = time.Now()
		s.progress.Store(p)
		return err
	}

	scanID, err := s.Store.StartScan(p.Started)
	if err != nil {
		p.Error = err.Error()
		p.Running = false
		p.Finished = time.Now()
		s.progress.Store(p)
		return err
	}

	now := time.Now().Unix()
	recentCutoff := p.Started.Add(-time.Duration(RecentDays) * 24 * time.Hour).Unix()

	err = filepath.WalkDir(s.ArchiveDir, func(path string, d fs.DirEntry, walkErr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		atomic.AddInt64(&p.Walked, 1)
		if !IsVideo(path) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}

		var status, dest string
		var matchedJSON []byte
		mtime := info.ModTime().Unix()
		if _, ok := exclusions[path]; ok {
			status = "keep"
		} else {
			matches := s.Matcher.Classify(path)
			status, dest = patterns.Decide(matches)
			if len(matches) > 0 {
				matchedJSON, _ = json.Marshal(matches)
			}
			// Safety net: don't auto-delete anything added in the last
			// RecentDays days — surface it in its own bucket for review.
			if status == "delete" && mtime >= recentCutoff {
				status = "recent"
			}
		}

		rec := store.FileRecord{
			Path:        path,
			Size:        info.Size(),
			Mtime:       mtime,
			Status:      status,
			Destination: dest,
			Matched:     string(matchedJSON),
			Extension:   strings.ToLower(filepath.Ext(path)),
			ScannedAt:   now,
		}
		if err := s.Store.InsertFile(&rec); err != nil {
			return nil
		}

		atomic.AddInt64(&p.Total, 1)
		switch status {
		case "move":
			atomic.AddInt64(&p.Move, 1)
		case "delete":
			atomic.AddInt64(&p.Delete, 1)
		case "fuzzy":
			atomic.AddInt64(&p.Fuzzy, 1)
		case "keep":
			atomic.AddInt64(&p.Keep, 1)
		case "recent":
			atomic.AddInt64(&p.Recent, 1)
		}
		s.progress.Store(p)
		return nil
	})

	p.Running = false
	p.Finished = time.Now()
	if err != nil {
		p.Error = err.Error()
	}
	s.progress.Store(p)
	_ = s.Store.FinishScan(scanID, p.Finished, p.Total, p.Move, p.Delete, p.Fuzzy, p.Keep, p.Error)
	return err
}
