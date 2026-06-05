package vr

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
	"time"
)

// VideoMeta is the subset of ffprobe output we persist.
type VideoMeta struct {
	Duration float64
	Width    int
	Height   int
	Codec    string
	Size     int64
}

func ProbeVideo(ctx context.Context, path string) (VideoMeta, error) {
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return VideoMeta{}, fmt.Errorf("ffprobe: %w", err)
	}
	var raw struct {
		Format struct {
			Duration string `json:"duration"`
			Size     string `json:"size"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		return VideoMeta{}, err
	}
	var m VideoMeta
	m.Duration, _ = strconv.ParseFloat(raw.Format.Duration, 64)
	m.Size, _ = strconv.ParseInt(raw.Format.Size, 10, 64)
	for _, s := range raw.Streams {
		if s.CodecType == "video" {
			m.Width = s.Width
			m.Height = s.Height
			m.Codec = s.CodecName
			break
		}
	}
	return m, nil
}

// GenerateThumb writes a 1080px-high JPEG at the given timestamp.
// vrfm uses scale=-1:1080 (taller than xcleanup's 480-wide because VR files
// are huge and the UI shows them at lightbox size).
func GenerateThumb(ctx context.Context, src string, ts float64, out string) error {
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return err
	}
	tmp := out + ".part.jpg"
	cctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "ffmpeg",
		"-y", "-loglevel", "error",
		"-ss", strconv.FormatFloat(ts, 'f', 2, 64),
		"-i", src,
		"-vframes", "1",
		"-vf", "scale=-1:1080",
		out+".part.jpg",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}
	return os.Rename(tmp, out)
}

// ComputeThumbHash mirrors vrfm's thumbHash.ts: sha256(filename + ":" + size)
// truncated to 16 hex chars. This makes the cache survive file moves and
// matches existing on-disk layout for zero-rebuild migration.
func ComputeThumbHash(filename string, size int64) string {
	h := sha256.Sum256([]byte(filename + ":" + strconv.FormatInt(size, 10)))
	return hex.EncodeToString(h[:])[:16]
}

// ThumbPathOnDisk returns the absolute file path for a thumbnail under root.
func ThumbPathOnDisk(root, hash string, ts float64) string {
	return filepath.Join(root, hash, FormatTimestamp(ts)+".jpg")
}

// FormatTimestamp mirrors vrfm's `secs.toFixed(2)` for filename consistency.
func FormatTimestamp(ts float64) string {
	return strconv.FormatFloat(ts, 'f', 2, 64)
}
