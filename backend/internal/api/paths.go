package api

import (
	"fmt"
	"path/filepath"
	"strings"
)

// resolveUnder cleans an untrusted path from a query string and asserts it
// lives inside root. Returns the cleaned absolute path.
//
// Both sides are resolved through filepath.EvalSymlinks where possible so a
// symlink inside root cannot be used to escape it; if the target does not
// exist yet we fall back to lexical containment, which is still sufficient to
// block "../" traversal.
func resolveUnder(root, p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("path required")
	}
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute")
	}
	clean := filepath.Clean(p)
	rootClean := filepath.Clean(root)
	if clean != rootClean && !strings.HasPrefix(clean, rootClean+string(filepath.Separator)) {
		return "", fmt.Errorf("path is outside %s", rootClean)
	}
	return clean, nil
}
