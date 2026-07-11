//go:build windows

package agent

import (
	"unsafe"
)

const windowsEpochDiff = 116444736000000000 // 100-ns intervals between 1601 and 1970

// ProcessStartTimeMs returns the OS-reported start time of pid in Unix epoch
// milliseconds, or 0 when unavailable.
func ProcessStartTimeMs(pid int) int64 {
	if pid <= 0 {
		return 0
	}
	handle, err := windowsOpenProcess(pid)
	if err != nil {
		return 0
	}
	defer closeProcessHandle(handle)

	var created, exited, kernel, user filetime
	r, _, err := procGetProcessTimes.Call(
		uintptr(handle),
		uintptr(unsafe.Pointer(&created)),
		uintptr(unsafe.Pointer(&exited)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if r == 0 {
		return 0
	}

	ticks := (uint64(created.highDateTime) << 32) | uint64(created.lowDateTime)
	if ticks == 0 || ticks < windowsEpochDiff {
		return 0
	}
	return int64((ticks - windowsEpochDiff) / 10000)
}
