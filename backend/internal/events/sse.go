package events

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
)

type listener struct {
	id int64
	ch chan message
}

type message struct {
	Event string
	Data  any
}

// Bus is a tiny pub/sub fan-out used by the VR scan/probe/thumb pipelines.
// SSE clients subscribe; producers call Emit.
type Bus struct {
	mu        sync.Mutex
	listeners map[int64]*listener
	nextID    atomic.Int64
}

func NewBus() *Bus {
	return &Bus{listeners: map[int64]*listener{}}
}

func (b *Bus) Emit(event string, data any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, l := range b.listeners {
		select {
		case l.ch <- message{Event: event, Data: data}:
		default:
			// listener is backed up — drop the event rather than block the
			// producer. SSE clients can re-fetch state if they care.
		}
	}
}

func (b *Bus) subscribe() *listener {
	id := b.nextID.Add(1)
	l := &listener{id: id, ch: make(chan message, 64)}
	b.mu.Lock()
	b.listeners[id] = l
	b.mu.Unlock()
	return l
}

func (b *Bus) unsubscribe(l *listener) {
	b.mu.Lock()
	delete(b.listeners, l.id)
	b.mu.Unlock()
	close(l.ch)
}

// Handler returns an http.HandlerFunc that streams Bus events as SSE.
func (b *Bus) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(200)
		flusher.Flush()

		l := b.subscribe()
		defer b.unsubscribe(l)

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-l.ch:
				if !ok {
					return
				}
				data, _ := json.Marshal(msg.Data)
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Event, data)
				flusher.Flush()
			}
		}
	}
}
