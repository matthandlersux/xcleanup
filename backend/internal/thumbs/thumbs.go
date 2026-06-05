package thumbs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// FrameCount is the number of thumbnails generated per video.
const FrameCount = 3

// minAcceptableSize is the smallest JPEG byte count we'll trust as a real
// frame. ffmpeg can return successfully with a black/garbage frame
// (typically <2 KB) when fast-seek lands on a corrupt NAL unit — when that
// happens we fall through to a slower, more robust decode path.
const minAcceptableSize int64 = 3000

type Manager struct {
	Dir string

	mu       sync.Mutex
	inFlight map[string]chan struct{}
}

func New(dir string) (*Manager, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Manager{Dir: dir, inFlight: map[string]chan struct{}{}}, nil
}

// Key derives a path-independent identifier from basename + size, so the cache
// survives the file moving from archive → grouped.
func Key(srcPath string, size int64) string {
	base := filepath.Base(srcPath)
	h := sha256.Sum256([]byte(base + ":" + strconv.FormatInt(size, 10)))
	return hex.EncodeToString(h[:])[:16]
}

func (m *Manager) thumbDir(srcPath string, size int64) string {
	return filepath.Join(m.Dir, Key(srcPath, size))
}

// ThumbPath returns the on-disk path for a single frame index (0..FrameCount-1).
func (m *Manager) ThumbPath(srcPath string, size int64, idx int) string {
	return filepath.Join(m.thumbDir(srcPath, size), fmt.Sprintf("%d.jpg", idx))
}

// EnsureThumb generates the requested frame if missing or if the cached file
// looks like a degenerate (tiny) ffmpeg output.
func (m *Manager) EnsureThumb(ctx context.Context, srcPath string, size int64, idx int) (string, error) {
	if idx < 0 || idx >= FrameCount {
		return "", fmt.Errorf("invalid frame index %d", idx)
	}
	out := m.ThumbPath(srcPath, size, idx)
	if info, err := os.Stat(out); err == nil && info.Size() >= minAcceptableSize {
		return out, nil
	}

	m.mu.Lock()
	if ch, ok := m.inFlight[out]; ok {
		m.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		if info, err := os.Stat(out); err == nil && info.Size() >= minAcceptableSize {
			return out, nil
		}
		return out, nil
	}
	ch := make(chan struct{})
	m.inFlight[out] = ch
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.inFlight, out)
		close(ch)
		m.mu.Unlock()
	}()

	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return "", err
	}

	ts, err := frameTimestamp(ctx, srcPath, idx)
	if err != nil {
		ts = float64(10 * idx)
	}
	return generate(ctx, srcPath, ts, out)
}

func frameTimestamp(ctx context.Context, src string, idx int) (float64, error) {
	if idx == 0 {
		return 10, nil
	}
	dur, err := probeDuration(ctx, src)
	if err != nil {
		return 0, err
	}
	if dur < 30 {
		return float64(idx), nil
	}
	switch idx {
	case 1:
		return dur / 3, nil
	case 2:
		return dur * 2 / 3, nil
	}
	return 0, fmt.Errorf("unsupported idx %d", idx)
}

type ffprobeOutput struct {
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

func probeDuration(ctx context.Context, src string) (float64, error) {
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		src,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe: %w: %s", err, stderr.String())
	}
	var out ffprobeOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return 0, err
	}
	d, err := strconv.ParseFloat(out.Format.Duration, 64)
	if err != nil {
		return 0, err
	}
	return d, nil
}

// generate writes a JPEG to `out`, trying progressively more robust ffmpeg
// invocations until the output is plausible.
func generate(ctx context.Context, src string, ts float64, out string) (string, error) {
	tmp := out + ".part.jpg"
	cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	run := func(args ...string) error {
		_ = os.Remove(tmp)
		cmd := exec.CommandContext(cctx, "ffmpeg", args...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("%w: %s", err, stderr.String())
		}
		info, err := os.Stat(tmp)
		if err != nil {
			return err
		}
		if info.Size() < minAcceptableSize {
			return fmt.Errorf("output too small (%d bytes), likely black frame", info.Size())
		}
		return nil
	}

	tsStr := strconv.FormatFloat(ts, 'f', 2, 64)
	common := []string{"-vframes", "1", "-vf", "scale=480:-2", "-q:v", "5", tmp}

	// Strategy 1: fast seek (cheap, works for most files).
	err1 := run(append([]string{"-y", "-loglevel", "error", "-ss", tsStr, "-i", src}, common...)...)
	if err1 == nil {
		return commit(tmp, out)
	}

	// Strategy 2: slow seek — ffmpeg decodes from the start. Slower but
	// resilient against corrupted NAL units and bad container indexes.
	err2 := run(append([]string{"-y", "-loglevel", "error", "-i", src, "-ss", tsStr}, common...)...)
	if err2 == nil {
		return commit(tmp, out)
	}

	// Strategy 3: try a much earlier offset (3s) with slow seek — some files
	// have garbage after the first keyframe but a usable frame near the start.
	err3 := run(append([]string{"-y", "-loglevel", "error", "-i", src, "-ss", "3"}, common...)...)
	if err3 == nil {
		return commit(tmp, out)
	}

	// Strategy 4: first decodable frame, no seek.
	err4 := run(append([]string{"-y", "-loglevel", "error", "-i", src}, common...)...)
	if err4 == nil {
		return commit(tmp, out)
	}

	_ = os.Remove(tmp)
	return "", fmt.Errorf("all ffmpeg strategies failed: fast=%v; slow=%v; early=%v; first-frame=%v", err1, err2, err3, err4)
}

func commit(tmp, out string) (string, error) {
	if err := os.Rename(tmp, out); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return out, nil
}
