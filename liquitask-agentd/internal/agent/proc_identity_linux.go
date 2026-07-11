//go:build linux

package agent

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ProcessStartTimeMs returns the OS-reported start time of pid in Unix epoch
// milliseconds, or 0 when unavailable.
func ProcessStartTimeMs(pid int) int64 {
	if pid <= 0 {
		return 0
	}
	if t, err := processStartTimeLinux(pid); err == nil {
		return t.UnixMilli()
	}
	return 0
}

func processStartTimeLinux(pid int) (time.Time, error) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return time.Time{}, err
	}
	content := string(data)
	rparen := strings.LastIndex(content, ")")
	if rparen < 0 || rparen+2 >= len(content) {
		return time.Time{}, fmt.Errorf("malformed stat for pid %d", pid)
	}
	fields := strings.Fields(content[rparen+2:])
	if len(fields) < 20 {
		return time.Time{}, fmt.Errorf("short stat for pid %d", pid)
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return time.Time{}, err
	}
	clkTck := uint64(100)
	if v, err := syscall.Sysconf(syscall.SC_CLK_TCK); err == nil && v > 0 {
		clkTck = uint64(v)
	}
	boot, err := bootTimeLinux()
	if err != nil {
		return time.Time{}, err
	}
	secs := float64(ticks) / float64(clkTck)
	return boot.Add(time.Duration(secs * float64(time.Second))), nil
}

func bootTimeLinux() (time.Time, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return time.Time{}, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "btime ") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				secs, err := strconv.ParseInt(fields[1], 10, 64)
				if err != nil {
					return time.Time{}, err
				}
				return time.Unix(secs, 0), nil
			}
		}
	}
	return time.Time{}, fmt.Errorf("btime not found")
}
