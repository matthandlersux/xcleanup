package patterns

import (
	"fmt"
	"path/filepath"
	"regexp"
)

type RawDestination struct {
	Name   string   `json:"name" mapstructure:"name"`
	Strong []string `json:"strong" mapstructure:"strong"`
	Weak   []string `json:"weak" mapstructure:"weak"`
}

type Destination struct {
	Name   string
	Strong []*regexp.Regexp
	Weak   []*regexp.Regexp
}

type Match struct {
	Destination string `json:"destination"`
	Kind        string `json:"kind"`
	Pattern     string `json:"pattern"`
}

type Matcher struct {
	Destinations []Destination
}

func New(raw []RawDestination) (*Matcher, error) {
	m := &Matcher{}
	for _, rd := range raw {
		d := Destination{Name: rd.Name}
		for _, s := range rd.Strong {
			re, err := regexp.Compile(s)
			if err != nil {
				return nil, fmt.Errorf("compile strong pattern %q for %s: %w", s, rd.Name, err)
			}
			d.Strong = append(d.Strong, re)
		}
		for _, w := range rd.Weak {
			re, err := regexp.Compile(w)
			if err != nil {
				return nil, fmt.Errorf("compile weak pattern %q for %s: %w", w, rd.Name, err)
			}
			d.Weak = append(d.Weak, re)
		}
		m.Destinations = append(m.Destinations, d)
	}
	return m, nil
}

// Classify runs all patterns against the basename (with extension) and
// returns matches sorted by destination order in config.
func (m *Matcher) Classify(filename string) []Match {
	base := filepath.Base(filename)
	var out []Match
	for _, d := range m.Destinations {
		for _, re := range d.Strong {
			if re.MatchString(base) {
				out = append(out, Match{Destination: d.Name, Kind: "strong", Pattern: re.String()})
				break
			}
		}
		for _, re := range d.Weak {
			if re.MatchString(base) {
				out = append(out, Match{Destination: d.Name, Kind: "weak", Pattern: re.String()})
				break
			}
		}
	}
	return out
}

// Decide reduces matches into one of: ("move", dest), ("fuzzy", ""), ("delete", "").
func Decide(matches []Match) (status string, destination string) {
	var strongDests, weakDests []string
	seen := map[string]string{}
	for _, m := range matches {
		if prev, ok := seen[m.Destination]; ok {
			if prev == "weak" && m.Kind == "strong" {
				seen[m.Destination] = "strong"
			}
			continue
		}
		seen[m.Destination] = m.Kind
	}
	for d, k := range seen {
		if k == "strong" {
			strongDests = append(strongDests, d)
		} else {
			weakDests = append(weakDests, d)
		}
	}
	switch {
	case len(strongDests) == 1 && len(weakDests) == 0:
		return "move", strongDests[0]
	case len(strongDests) == 0 && len(weakDests) == 0:
		return "delete", ""
	default:
		return "fuzzy", ""
	}
}
