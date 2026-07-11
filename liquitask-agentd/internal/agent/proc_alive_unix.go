//go:build !windows

package agent

import "syscall"

// IsProcessAlive reports whether pid refers to a live process (signal 0 probe).
func IsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// ProcessIdentityMatches verifies pid still refers to the process that started
// at expectedStartMs. When expectedStartMs <= 0 or the OS start time is
// unavailable, only liveness is checked.
func ProcessIdentityMatches(pid int, expectedStartMs int64) bool {
	if !IsProcessAlive(pid) {
		return false
	}
	if expectedStartMs <= 0 {
		return true
	}
	actual := ProcessStartTimeMs(pid)
	if actual <= 0 {
		return true
	}
	diff := actual - expectedStartMs
	if diff < 0 {
		diff = -diff
	}
	return diff <= 2000
}
