//go:build windows

package agent

import (
	"syscall"
)

const processQueryLimitedInformation = 0x1000

var (
	modkernel32         = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess     = modkernel32.NewProc("OpenProcess")
	procGetProcessTimes = modkernel32.NewProc("GetProcessTimes")
	procCloseHandle     = modkernel32.NewProc("CloseHandle")
)

type filetime struct {
	lowDateTime  uint32
	highDateTime uint32
}

func windowsOpenProcess(pid int) (syscall.Handle, error) {
	r, _, err := procOpenProcess.Call(
		uintptr(processQueryLimitedInformation),
		0,
		uintptr(pid),
	)
	if r == 0 {
		return 0, err
	}
	return syscall.Handle(r), nil
}

func closeProcessHandle(handle syscall.Handle) {
	_, _, _ = procCloseHandle.Call(uintptr(handle))
}

// IsProcessAlive reports whether pid refers to a live process via OpenProcess.
func IsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	handle, err := windowsOpenProcess(pid)
	if err != nil {
		return false
	}
	closeProcessHandle(handle)
	return true
}

func ProcessIdentityMatches(pid int, expectedStartMs int64) bool {
	if !IsProcessAlive(pid) {
		return false
	}
	if expectedStartMs <= 0 {
		return true
	}
	actual := ProcessStartTimeMs(pid)
	if actual <= 0 {
		return false
	}
	diff := actual - expectedStartMs
	if diff < 0 {
		diff = -diff
	}
	return diff <= 2000
}
