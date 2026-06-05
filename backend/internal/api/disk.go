package api

import "syscall"

type DiskUsage struct {
	Path  string `json:"path"`
	Free  uint64 `json:"free"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
}

func diskUsage(path string) (DiskUsage, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return DiskUsage{Path: path}, err
	}
	bsize := uint64(stat.Bsize)
	free := stat.Bavail * bsize
	total := stat.Blocks * bsize
	used := total - (stat.Bfree * bsize)
	return DiskUsage{Path: path, Free: free, Total: total, Used: used}, nil
}
