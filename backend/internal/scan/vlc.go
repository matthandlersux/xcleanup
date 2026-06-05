package scan

import (
	"encoding/xml"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type xspfPlaylist struct {
	XMLName xml.Name `xml:"playlist"`
	Tracks  struct {
		Track []struct {
			Location string `xml:"location"`
		} `xml:"track"`
	} `xml:"trackList"`
}

// LoadVLCExclusions parses a VLC ml.xspf and returns the set of absolute
// file paths (those starting with file://). Returns an empty set if the
// file is missing.
func LoadVLCExclusions(path string) (map[string]struct{}, error) {
	out := make(map[string]struct{})
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, fmt.Errorf("read vlc xspf: %w", err)
	}
	var pl xspfPlaylist
	if err := xml.Unmarshal(b, &pl); err != nil {
		return nil, fmt.Errorf("parse vlc xspf: %w", err)
	}
	for _, t := range pl.Tracks.Track {
		loc := strings.TrimSpace(t.Location)
		if !strings.HasPrefix(loc, "file://") {
			continue
		}
		raw := strings.TrimPrefix(loc, "file://")
		p, err := url.PathUnescape(raw)
		if err != nil {
			continue
		}
		out[p] = struct{}{}
	}
	return out, nil
}
