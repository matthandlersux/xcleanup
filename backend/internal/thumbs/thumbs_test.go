package thumbs

import (
	"os"
	"path/filepath"
	"testing"
)

// seed creates a fake cache directory for a source file, as EnsureThumb would.
func seed(t *testing.T, m *Manager, src string, size int64, frames int) string {
	t.Helper()
	dir := m.thumbDir(src, size)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < frames; i++ {
		f := filepath.Join(dir, "0.jpg")
		if err := os.WriteFile(f, make([]byte, 1024), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestRemoveDropsCachedStills(t *testing.T) {
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dir := seed(t, m, "/mnt/krumbus/archive/gone.mp4", 4242, 3)

	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("seed did not create cache dir: %v", err)
	}
	if err := m.Remove("/mnt/krumbus/archive/gone.mp4", 4242); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("cache dir still present after Remove, err=%v", err)
	}
}

// A move must not invalidate the cache: Key is basename+size precisely so the
// stills survive archive → grouped relocation.
func TestKeyIsStableAcrossDirectories(t *testing.T) {
	a := Key("/mnt/krumbus/archive/clip.mp4", 100)
	b := Key("/mnt/krumbus/grouped/organized/nvg/clip.mp4", 100)
	if a != b {
		t.Errorf("key changed across move: %s vs %s", a, b)
	}
	if c := Key("/mnt/krumbus/archive/clip.mp4", 101); c == a {
		t.Error("key ignored size, so a re-encode would reuse stale stills")
	}
}

// Remove deletes a whole directory, so the invariant that matters is that the
// target is always strictly *inside* the cache root — never the root itself.
// (Manager.Remove also carries an explicit guard, but it is unreachable so
// long as this holds.)
func TestRemoveTargetIsAlwaysBelowRoot(t *testing.T) {
	root := t.TempDir()
	m, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, src := range []string{
		"/mnt/krumbus/archive/a.mp4",
		"/a.mp4",
		"a.mp4",
		"",
		"..",
		"../../etc/passwd",
	} {
		dir := m.thumbDir(src, 0)
		if dir == m.Dir {
			t.Errorf("thumbDir(%q) resolved to the cache root", src)
		}
		if filepath.Dir(dir) != m.Dir {
			t.Errorf("thumbDir(%q) = %q, want a direct child of %q", src, dir, m.Dir)
		}
	}
}

func TestPurgeExceptKeepsLiveKeys(t *testing.T) {
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	liveDir := seed(t, m, "/mnt/krumbus/top/keep.mp4", 10, 1)
	deadDir := seed(t, m, "/mnt/krumbus/archive/dead.mp4", 20, 1)
	seed(t, m, "/mnt/krumbus/archive/dead2.mp4", 30, 1)

	keep := map[string]struct{}{Key("/mnt/krumbus/top/keep.mp4", 10): {}}

	count, bytes, err := m.CountExcept(keep)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("CountExcept = %d orphans, want 2", count)
	}
	if bytes <= 0 {
		t.Errorf("CountExcept reported %d bytes, want > 0", bytes)
	}

	removed, freed, err := m.PurgeExcept(keep)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 {
		t.Errorf("PurgeExcept removed %d, want 2", removed)
	}
	if freed != bytes {
		t.Errorf("freed %d bytes, but dry run predicted %d", freed, bytes)
	}
	if _, err := os.Stat(liveDir); err != nil {
		t.Errorf("live cache dir was purged: %v", err)
	}
	if _, err := os.Stat(deadDir); !os.IsNotExist(err) {
		t.Errorf("orphan cache dir survived purge, err=%v", err)
	}
}

func TestSpreadFractionIsStableAndInRange(t *testing.T) {
	// Index → position must never change as the frame count grows, otherwise
	// "fetch more screenshots" would reshuffle already-cached stills.
	want := []float64{0.5, 0.25, 0.75, 0.125, 0.625}
	for i, w := range want {
		if got := spreadFraction(i); got != w {
			t.Errorf("spreadFraction(%d) = %v, want %v", i, got, w)
		}
	}
	for i := 0; i < MaxSpreadFrames; i++ {
		f := spreadFraction(i)
		if f <= 0 || f >= 1 {
			t.Errorf("spreadFraction(%d) = %v, outside (0,1)", i, f)
		}
	}
}
