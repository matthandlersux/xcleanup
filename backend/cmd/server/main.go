package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"xcleanup/internal/api"
	"xcleanup/internal/apply"
	"xcleanup/internal/patterns"
	"xcleanup/internal/scan"
	"xcleanup/internal/store"
	"xcleanup/internal/thumbs"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	port := env("PORT", "8080")
	dbPath := env("DB_PATH", "/data/xcleanup.db")
	thumbDir := env("THUMB_DIR", "/data/thumbs")
	patternsPath := env("PATTERNS_PATH", "/app/patterns.json")
	archiveDir := env("ARCHIVE_DIR", "/mnt/krumbus/archive")
	groupedDir := env("GROUPED_DIR", "/mnt/krumbus/grouped")
	topDir := env("TOP_DIR", "/mnt/krumbus/top")
	vlcPath := env("VLC_ML_PATH", "/vlc/ml.xspf")

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatalf("mkdir data dir: %v", err)
	}

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	matcher, err := patterns.Load(patternsPath)
	if err != nil {
		log.Fatalf("load patterns: %v", err)
	}

	tm, err := thumbs.New(thumbDir)
	if err != nil {
		log.Fatalf("init thumbs: %v", err)
	}

	scanner := scan.New(archiveDir, vlcPath, matcher, st)
	ap := &apply.Engine{Store: st, GroupedDir: groupedDir, ArchiveDir: archiveDir, TopDir: topDir}

	srv := &api.Server{
		Store:      st,
		Matcher:    matcher,
		Scanner:    scanner,
		Thumbs:     tm,
		Apply:      ap,
		ArchiveDir: archiveDir,
		GroupedDir: groupedDir,
		TopDir:     topDir,
		VLCPath:    vlcPath,
	}

	log.Printf("xcleanup api listening on :%s", port)
	if err := http.ListenAndServe(":"+port, srv.Routes()); err != nil {
		log.Fatalf("http server: %v", err)
	}
}
