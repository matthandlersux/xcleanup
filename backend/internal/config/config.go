package config

import (
	"fmt"
	"path/filepath"

	"github.com/spf13/viper"

	"xcleanup/internal/patterns"
)

type Config struct {
	Patterns PatternsSection `mapstructure:"patterns"`
	Storage  StorageSection  `mapstructure:"storage"`
}

type PatternsSection struct {
	Destinations []patterns.RawDestination `mapstructure:"destinations"`
}

type StorageSection struct {
	RefreshIntervalSeconds int             `mapstructure:"refresh_interval_seconds"`
	Drives                 []DriveConfig   `mapstructure:"drives"`
	Breakdowns             []BreakdownPlan `mapstructure:"breakdowns"`
}

type DriveConfig struct {
	Label     string `mapstructure:"label"`
	Path      string `mapstructure:"path"`
	Highlight bool   `mapstructure:"highlight"`
}

type BreakdownPlan struct {
	Drive  string           `mapstructure:"drive"`
	Groups []BreakdownGroup `mapstructure:"groups"`
}

type BreakdownGroup struct {
	Label   string   `mapstructure:"label"`
	Path    string   `mapstructure:"path"`
	Exclude []string `mapstructure:"exclude"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(path)
	v.SetConfigType("json")
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	v.SetDefault("storage.refresh_interval_seconds", 3600)

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("decode config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (c *Config) validate() error {
	if len(c.Patterns.Destinations) == 0 {
		return fmt.Errorf("patterns.destinations is empty")
	}
	seenDest := map[string]bool{}
	for _, d := range c.Patterns.Destinations {
		if d.Name == "" {
			return fmt.Errorf("patterns.destinations: entry with empty name")
		}
		if seenDest[d.Name] {
			return fmt.Errorf("patterns.destinations: duplicate name %q", d.Name)
		}
		seenDest[d.Name] = true
	}

	if len(c.Storage.Drives) == 0 {
		return fmt.Errorf("storage.drives is empty")
	}
	seenLabel := map[string]bool{}
	highlightCount := 0
	for i, d := range c.Storage.Drives {
		if d.Label == "" {
			return fmt.Errorf("storage.drives[%d]: label required", i)
		}
		if seenLabel[d.Label] {
			return fmt.Errorf("storage.drives: duplicate label %q", d.Label)
		}
		seenLabel[d.Label] = true
		if !filepath.IsAbs(d.Path) {
			return fmt.Errorf("storage.drives[%s]: path must be absolute, got %q", d.Label, d.Path)
		}
		if d.Highlight {
			highlightCount++
		}
	}
	if highlightCount > 1 {
		return fmt.Errorf("storage.drives: at most one drive may have highlight=true")
	}

	for i, b := range c.Storage.Breakdowns {
		if !seenLabel[b.Drive] {
			return fmt.Errorf("storage.breakdowns[%d]: drive %q not found in storage.drives", i, b.Drive)
		}
		if len(b.Groups) == 0 {
			return fmt.Errorf("storage.breakdowns[%s]: groups is empty", b.Drive)
		}
		seenGroup := map[string]bool{}
		for j, g := range b.Groups {
			if g.Label == "" {
				return fmt.Errorf("storage.breakdowns[%s].groups[%d]: label required", b.Drive, j)
			}
			if seenGroup[g.Label] {
				return fmt.Errorf("storage.breakdowns[%s].groups: duplicate label %q", b.Drive, g.Label)
			}
			seenGroup[g.Label] = true
			if g.Path == "" {
				return fmt.Errorf("storage.breakdowns[%s].groups[%s]: path required", b.Drive, g.Label)
			}
			if filepath.IsAbs(g.Path) {
				return fmt.Errorf("storage.breakdowns[%s].groups[%s]: path must be relative to drive, got %q", b.Drive, g.Label, g.Path)
			}
		}
	}
	return nil
}

func (c *Config) DriveByLabel(label string) (DriveConfig, bool) {
	for _, d := range c.Storage.Drives {
		if d.Label == label {
			return d, true
		}
	}
	return DriveConfig{}, false
}
