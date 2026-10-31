package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"xcleanup/internal/api"
	"xcleanup/internal/apply"
	"xcleanup/internal/config"
	"xcleanup/internal/events"
	"xcleanup/internal/patterns"
	"xcleanup/internal/scan"
	"xcleanup/internal/storage"
	"xcleanup/internal/store"
	"xcleanup/internal/thumbs"
	"xcleanup/internal/vr"
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
	configPath := env("CONFIG_PATH", "/app/config.json")
	archiveDir := env("ARCHIVE_DIR", "/mnt/krumbus/archive")
	groupedDir := env("GROUPED_DIR", "/mnt/krumbus/grouped")
	topDir := env("TOP_DIR", "/mnt/krumbus/top")
	vlcPath := env("VLC_ML_PATH", "/vlc/ml.xspf")

	vrThumbDir := env("VR_THUMB_DIR", "/data/vr-thumbs")
	vrSourceDB := env("VR_SOURCE_DB", "/vr-source/server/data/app.db")
	vrSourceThumbs := env("VR_SOURCE_THUMBS", "/vr-source/thumbnails")

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatalf("mkdir data dir: %v", err)
	}
	if err := os.MkdirAll(vrThumbDir, 0o755); err != nil {
		log.Fatalf("mkdir vr thumb dir: %v", err)
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	matcher, err := patterns.New(cfg.Patterns.Destinations)
	if err != nil {
		log.Fatalf("compile patterns: %v", err)
	}

	tm, err := thumbs.New(thumbDir)
	if err != nil {
		log.Fatalf("init thumbs: %v", err)
	}

	scanner := scan.New(archiveDir, vlcPath, matcher, st)
	ap := &apply.Engine{Store: st, Thumbs: tm, GroupedDir: groupedDir, ArchiveDir: archiveDir, TopDir: topDir}

	storageMgr := storage.NewManager(cfg)
	storageMgr.Start(context.Background())

	// VR section.
	vrStore := vr.NewStore(st.DB())
	vrBus := events.NewBus()
	vrIndexer := &vr.Indexer{Store: vrStore, Bus: vrBus, ThumbDir: vrThumbDir}
	vrThumber := &vr.Thumbnailer{Store: vrStore, Bus: vrBus, ThumbDir: vrThumbDir, Concurrency: 2}
	vrSrv := &vr.Server{Store: vrStore, Indexer: vrIndexer, Thumbnailer: vrThumber, Bus: vrBus, ThumbDir: vrThumbDir}

	// One-time migration from vr-file-manager, idempotent.
	if err := vr.MigrateFromVRFM(st.DB(), vrSourceDB, vrSourceThumbs, vrThumbDir); err != nil {
		log.Printf("vr migration error (non-fatal): %v", err)
	}

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
		VR:         vrSrv,
		Storage:    storageMgr,
	}

	log.Printf("xcleanup api listening on :%s", port)
	if err := http.ListenAndServe(":"+port, srv.Routes()); err != nil {
		log.Fatalf("http server: %v", err)
	}
}
