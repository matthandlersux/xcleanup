package storage

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"xcleanup/internal/config"
)

type Drive struct {
	Label     string `json:"label"`
	Path      string `json:"path"`
	Highlight bool   `json:"highlight"`
	Free      uint64 `json:"free"`
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Error     string `json:"error,omitempty"`
}

type BreakdownItem struct {
	Label string `json:"label"`
	Path  string `json:"path"`
	Size  uint64 `json:"size"`
	Error string `json:"error,omitempty"`
}

type DriveBreakdown struct {
	Drive string          `json:"drive"`
	Items []BreakdownItem `json:"items"`
}

type Snapshot struct {
	Drives      []Drive          `json:"drives"`
	Breakdowns  []DriveBreakdown `json:"breakdowns"`
	ComputedAt  time.Time        `json:"computed_at"`
	DurationMs  int64            `json:"duration_ms"`
}

type Manager struct {
	cfg      *config.Config
	interval time.Duration

	mu          sync.RWMutex
	snapshot    *Snapshot
	refreshing  bool
	refreshDone chan struct{}
}

func NewManager(cfg *config.Config) *Manager {
	interval := time.Duration(cfg.Storage.RefreshIntervalSeconds) * time.Second
	if interval <= 0 {
		interval = time.Hour
	}
	return &Manager{cfg: cfg, interval: interval}
}

// Start kicks off an initial refresh and a periodic ticker.
func (m *Manager) Start(ctx context.Context) {
	go m.refresh(ctx)
	go func() {
		t := time.NewTicker(m.interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				m.refresh(ctx)
			}
		}
	}()
}

// Snapshot returns the latest cached snapshot (may be nil if no refresh has
// completed yet) plus whether a refresh is currently in flight.
func (m *Manager) Snapshot() (*Snapshot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.snapshot, m.refreshing
}

// TriggerRefresh asynchronously runs a refresh if none is in progress.
// Returns the channel that closes when the in-flight (or newly-started) refresh
// completes, plus whether the caller started a new refresh.
func (m *Manager) TriggerRefresh(ctx context.Context) (<-chan struct{}, bool) {
	m.mu.Lock()
	if m.refreshing {
		ch := m.refreshDone
		m.mu.Unlock()
		return ch, false
	}
	m.mu.Unlock()
	go m.refresh(ctx)
	m.mu.RLock()
	ch := m.refreshDone
	m.mu.RUnlock()
	return ch, true
}

func (m *Manager) refresh(ctx context.Context) {
	m.mu.Lock()
	if m.refreshing {
		m.mu.Unlock()
		return
	}
	m.refreshing = true
	m.refreshDone = make(chan struct{})
	done := m.refreshDone
	m.mu.Unlock()

	start := time.Now()
	snap := m.compute(ctx)
	snap.ComputedAt = time.Now()
	snap.DurationMs = time.Since(start).Milliseconds()

	m.mu.Lock()
	m.snapshot = snap
	m.refreshing = false
	close(done)
	m.mu.Unlock()
	log.Printf("storage: refresh complete in %dms", snap.DurationMs)
}

func (m *Manager) compute(ctx context.Context) *Snapshot {
	snap := &Snapshot{}
	for _, d := range m.cfg.Storage.Drives {
		drive := Drive{Label: d.Label, Path: d.Path, Highlight: d.Highlight}
		du, err := statfs(d.Path)
		if err != nil {
			drive.Error = err.Error()
		} else {
			drive.Free = du.Free
			drive.Total = du.Total
			drive.Used = du.Used
		}
		snap.Drives = append(snap.Drives, drive)
	}

	for _, plan := range m.cfg.Storage.Breakdowns {
		drive, ok := m.cfg.DriveByLabel(plan.Drive)
		if !ok {
			continue
		}
		bd := DriveBreakdown{Drive: plan.Drive}
		for _, g := range plan.Groups {
			abs := filepath.Join(drive.Path, g.Path)
			item := BreakdownItem{Label: g.Label, Path: abs}
			size, err := groupSize(ctx, abs, g.Exclude)
			if err != nil {
				item.Error = err.Error()
			} else {
				item.Size = size
			}
			bd.Items = append(bd.Items, item)
		}
		snap.Breakdowns = append(snap.Breakdowns, bd)
	}
	return snap
}

type diskFigures struct {
	Free, Total, Used uint64
}

func statfs(path string) (diskFigures, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return diskFigures{}, fmt.Errorf("statfs %s: %w", path, err)
	}
	bsize := uint64(stat.Bsize)
	free := stat.Bavail * bsize
	total := stat.Blocks * bsize
	used := total - (stat.Bfree * bsize)
	return diskFigures{Free: free, Total: total, Used: used}, nil
}

// groupSize returns the total apparent size in bytes of `path`. If `exclude`
// is non-empty, top-level children of `path` whose basename is in the
// exclude list are skipped; this is implemented by summing du across the
// non-excluded children rather than du-ing `path` directly.
func groupSize(ctx context.Context, path string, exclude []string) (uint64, error) {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	if len(exclude) == 0 {
		return duBytes(ctx, path)
	}
	excludeSet := map[string]bool{}
	for _, e := range exclude {
		excludeSet[e] = true
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0, fmt.Errorf("read dir %s: %w", path, err)
	}
	var total uint64
	for _, entry := range entries {
		if excludeSet[entry.Name()] {
			continue
		}
		child := filepath.Join(path, entry.Name())
		size, err := duBytes(ctx, child)
		if err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}

// duBytes invokes `du -sb --apparent-size` on path and parses the byte count.
func duBytes(ctx context.Context, path string) (uint64, error) {
	cmd := exec.CommandContext(ctx, "du", "-sb", "--apparent-size", path)
	out, err := cmd.Output()
	if err != nil {
		// `du` exits non-zero on permission-denied or vanished entries but
		// still prints a usable total on stdout. Treat partial output as
		// success if we can parse it.
		if exitErr, ok := err.(*exec.ExitError); ok && len(out) > 0 {
			if n, perr := parseDu(out); perr == nil {
				return n, nil
			}
			_ = exitErr
		}
		return 0, fmt.Errorf("du %s: %w", path, err)
	}
	return parseDu(out)
}

func parseDu(out []byte) (uint64, error) {
	// du prints "<bytes>\t<path>\n" — possibly multiple lines on errors;
	// the last non-empty line is the cumulative total for the requested path.
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		n, err := strconv.ParseUint(fields[0], 10, 64)
		if err == nil {
			return n, nil
		}
	}
	return 0, fmt.Errorf("parse du output: %q", string(out))
}
