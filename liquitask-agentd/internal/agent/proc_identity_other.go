//go:build !linux && !darwin && !windows

package agent

// ProcessStartTimeMs is unavailable on this platform; callers treat 0 as skip.
func ProcessStartTimeMs(pid int) int64 {
	return 0
}
