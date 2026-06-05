package vr

import (
	"context"
	"sort"
	"sync"

	"xcleanup/internal/events"
)

// ThumbCount is the default number of thumbnails generated per video on the
// first pass (matches vrfm).
const ThumbCount = 5

type Thumbnailer struct {
	Store       *Store
	Bus         *events.Bus
	ThumbDir    string
	Concurrency int

	runMu sync.Mutex
	run   bool
}

func (t *Thumbnailer) running() bool {
	t.runMu.Lock()
	defer t.runMu.Unlock()
	return t.run
}

func (t *Thumbnailer) start() bool {
	t.runMu.Lock()
	defer t.runMu.Unlock()
	if t.run {
		return false
	}
	t.run = true
	return true
}

func (t *Thumbnailer) stop() {
	t.runMu.Lock()
	t.run = false
	t.runMu.Unlock()
}

// Run iterates over videos that need thumbnails and generates them. Honors
// vrfm's pattern: ThumbCount frames at evenly-spaced timestamps. Concurrent
// workers; bounded.
func (t *Thumbnailer) Run(ctx context.Context) {
	if !t.start() {
		return
	}
	defer t.stop()

	videos, err := t.Store.VideosNeedingThumbs(ThumbCount)
	if err != nil || len(videos) == 0 {
		t.Bus.Emit("thumb:status", map[string]any{"total": 0, "done": 0, "running": false})
		return
	}

	total := len(videos)
	t.Bus.Emit("thumb:status", map[string]any{"total": total, "done": 0, "running": true})

	conc := t.Concurrency
	if conc < 1 {
		conc = 2
	}
	jobs := make(chan struct {
		ID       int64
		Path     string
		Filename string
		Duration float64
		Hash     string
	}, len(videos))
	for _, v := range videos {
		jobs <- v
	}
	close(jobs)

	var done int
	var doneMu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < conc; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				if ctx.Err() != nil {
					return
				}
				t.Bus.Emit("thumb:video-start", map[string]any{
					"videoId": j.ID, "filename": j.Filename, "done": done, "total": total,
				})
				t.processVideo(ctx, j.ID, j.Path, j.Filename, j.Duration, j.Hash)
				doneMu.Lock()
				done++
				t.Bus.Emit("thumb:status", map[string]any{"total": total, "done": done, "running": true})
				doneMu.Unlock()
			}
		}()
	}
	wg.Wait()
	t.Bus.Emit("thumb:status", map[string]any{"total": total, "done": done, "running": false})
}

func (t *Thumbnailer) processVideo(ctx context.Context, videoID int64, srcPath, _ string, duration float64, hash string) {
	if hash == "" {
		return
	}
	existing, _ := t.Store.ExistingThumbs(videoID)
	existingTS := map[string]bool{}
	maxIdx := -1
	for _, e := range existing {
		existingTS[FormatTimestamp(e.TimestampSecs)] = true
		if e.IndexNum > maxIdx {
			maxIdx = e.IndexNum
		}
	}
	nextIdx := maxIdx + 1
	for i := 0; i < ThumbCount; i++ {
		ts := duration * float64(i+1) / float64(ThumbCount+1)
		key := FormatTimestamp(ts)
		if existingTS[key] {
			continue
		}
		out := ThumbPathOnDisk(t.ThumbDir, hash, ts)
		if err := GenerateThumb(ctx, srcPath, ts, out); err != nil {
			continue
		}
		_ = t.Store.InsertThumb(videoID, nextIdx, ts, out)
		t.Bus.Emit("thumb:generated", map[string]any{"videoId": videoID, "index": nextIdx})
		nextIdx++
	}
}

// GenerateMore picks the largest gaps in already-generated thumb timestamps
// and produces additional frames there. Matches vrfm's generateAdditionalThumbnails.
func (t *Thumbnailer) GenerateMore(ctx context.Context, videoID int64, count int) error {
	v, err := t.Store.GetVideo(videoID)
	if err != nil || v == nil || v.DurationSecs == nil || v.ThumbHash == nil {
		return nil
	}
	duration := *v.DurationSecs
	hash := *v.ThumbHash

	existing, err := t.Store.ExistingThumbs(videoID)
	if err != nil {
		return err
	}
	maxIdx, _ := t.Store.MaxThumbIndex(videoID)

	// Boundaries: 0, ts_1, ts_2, ..., ts_n, duration. Find gaps and rank by size.
	boundaries := []float64{0}
	for _, e := range existing {
		boundaries = append(boundaries, e.TimestampSecs)
	}
	boundaries = append(boundaries, duration)
	sort.Float64s(boundaries)

	type gap struct {
		mid  float64
		size float64
	}
	var gaps []gap
	for i := 0; i < len(boundaries)-1; i++ {
		size := boundaries[i+1] - boundaries[i]
		if size > 0.5 {
			gaps = append(gaps, gap{mid: (boundaries[i] + boundaries[i+1]) / 2, size: size})
		}
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i].size > gaps[j].size })
	if count > len(gaps) {
		count = len(gaps)
	}

	nextIdx := maxIdx + 1
	for i := 0; i < count; i++ {
		ts := gaps[i].mid
		out := ThumbPathOnDisk(t.ThumbDir, hash, ts)
		if err := GenerateThumb(ctx, v.Path, ts, out); err != nil {
			continue
		}
		_ = t.Store.InsertThumb(videoID, nextIdx, ts, out)
		t.Bus.Emit("thumb:generated", map[string]any{"videoId": videoID, "index": nextIdx})
		nextIdx++
	}
	return nil
}
