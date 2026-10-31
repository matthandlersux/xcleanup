package patterns

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// loadRepoConfig reads the real config.json from the repo root so these tests
// guard the patterns that actually ship, not a copy that can drift.
func loadRepoConfig(t *testing.T) *Matcher {
	t.Helper()
	path := filepath.Join("..", "..", "..", "config.json")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("config.json not readable from %s: %v", path, err)
	}
	var cfg struct {
		Patterns struct {
			Destinations []RawDestination `json:"destinations"`
		} `json:"patterns"`
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		t.Fatalf("parse config.json: %v", err)
	}
	m, err := New(cfg.Patterns.Destinations)
	if err != nil {
		t.Fatalf("compile patterns: %v", err)
	}
	return m
}

func TestDecideAgainstRepoConfig(t *testing.T) {
	m := loadRepoConfig(t)

	cases := []struct {
		name     string
		wantStat string
		wantDest string
	}{
		// NetVideoGirls episode-number naming. These previously landed in
		// fuzzy (or, for the 3-digit id, auto-delete) and had to be moved by
		// hand.
		{"2625-alexis-hd.1080p.HEVC.mp4", "move", "organized/netvideogirls"},
		{"2628-bella-hd.1080p.HEVC.mp4", "move", "organized/netvideogirls"},
		{"906-paisley-rose-4k.mp4", "move", "organized/netvideogirls"},
		{"1273-aria-4k.mp4", "move", "organized/netvideogirls"},
		{"1321-lillian-4k.mp4", "move", "organized/netvideogirls"},

		// brcc followed by digits or an underscore — the old \bbrcc\b could
		// not match either, because a digit/underscore is a word character so
		// there was no boundary after "brcc".
		{"brcc1949-harlee-1080p.mp4", "move", "organized/backroomcastingcouch"},
		{"BRCC_1843_Thicc Chicc.mp4", "move", "organized/backroomcastingcouch"},
		{"brcc.2024.01.02.mp4", "move", "organized/backroomcastingcouch"},
		{"BackroomCastingCouch.com.mp4", "move", "organized/backroomcastingcouch"},

		// The brcc prefix must not swallow unrelated words.
		{"brccx-notarealsite.mp4", "delete", ""},
		{"random-vacation-video.mp4", "delete", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStat, gotDest := Decide(m.Classify(tc.name))
			if gotStat != tc.wantStat || gotDest != tc.wantDest {
				t.Errorf("Decide(%q) = (%q, %q), want (%q, %q)",
					tc.name, gotStat, gotDest, tc.wantStat, tc.wantDest)
			}
		})
	}
}

// TestEpisodeIDPatternIsGreedy documents a known false positive: a filename
// beginning with a 4-digit year in the same hyphenated shape as an NVG
// episode id is indistinguishable lexically, and now auto-moves rather than
// going to fuzzy. Auto-move is recoverable; the alternative (leaving the rule
// weak) sent real NVG files to the auto-delete bucket.
func TestEpisodeIDPatternIsGreedy(t *testing.T) {
	m := loadRepoConfig(t)
	status, dest := Decide(m.Classify("2024-holiday-4k.mp4"))
	if status != "move" || dest != "organized/netvideogirls" {
		t.Logf("year-prefixed collision no longer matches: got (%q, %q) — "+
			"if this was deliberate, delete this test", status, dest)
	}
}
