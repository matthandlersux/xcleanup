package api

import (
	"context"
	"net/http"

	"xcleanup/internal/storage"
)

type storageResponse struct {
	*storage.Snapshot
	Refreshing bool `json:"refreshing"`
}

func (s *Server) storageGet(w http.ResponseWriter, _ *http.Request) {
	if s.Storage == nil {
		writeErr(w, 503, "storage manager not configured")
		return
	}
	snap, refreshing := s.Storage.Snapshot()
	resp := storageResponse{Snapshot: snap, Refreshing: refreshing}
	writeJSON(w, 200, resp)
}

func (s *Server) storageRefresh(w http.ResponseWriter, _ *http.Request) {
	if s.Storage == nil {
		writeErr(w, 503, "storage manager not configured")
		return
	}
	// Use a background context — the refresh outlives this HTTP request,
	// and using r.Context() would cancel any in-flight `du` once we reply.
	_, started := s.Storage.TriggerRefresh(context.Background())
	status := "already_running"
	if started {
		status = "started"
	}
	writeJSON(w, 202, map[string]string{"status": status})
}
