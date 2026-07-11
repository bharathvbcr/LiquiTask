package runner

import (
	"sync"
)

const defaultPtyRingCap = 256 * 1024 // 256 KiB rolling terminal history

// ptyRingBuffer stores the most recent PTY output for late attach / replay.
type ptyRingBuffer struct {
	mu   sync.RWMutex
	buf  []byte
	cap  int
}

func newPtyRingBuffer(capacity int) *ptyRingBuffer {
	if capacity <= 0 {
		capacity = defaultPtyRingCap
	}
	return &ptyRingBuffer{cap: capacity}
}

func (b *ptyRingBuffer) Write(p []byte) {
	if len(p) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf = append(b.buf, p...)
	if len(b.buf) > b.cap {
		b.buf = append([]byte(nil), b.buf[len(b.buf)-b.cap:]...)
	}
}

func (b *ptyRingBuffer) Snapshot() []byte {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if len(b.buf) == 0 {
		return nil
	}
	out := make([]byte, len(b.buf))
	copy(out, b.buf)
	return out
}
