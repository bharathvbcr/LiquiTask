//go:build darwin

package agent

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ProcessStartTimeMs returns the OS-reported start time of pid in Unix epoch
// milliseconds, or 0 when unavailable.
func ProcessStartTimeMs(pid int) int64 {
	if pid <= 0 {
		return 0
	}
	if t, err := processStartTimeDarwin(pid); err == nil {
		return t.UnixMilli()
	}
	return 0
}

func processStartTimeDarwin(pid int) (time.Time, error) {
	out, err := exec.Command("ps", "-o", "lstart=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return time.Time{}, err
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return time.Time{}, fmt.Errorf("empty ps output for pid %d", pid)
	}
	// ps lstart format: "Day Mon DD HH:MM:SS YYYY" (weekday prefix, day may be space-padded).
	t, err := time.ParseInLocation("Mon Jan _2 15:04:05 2006", line, time.Local)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}
