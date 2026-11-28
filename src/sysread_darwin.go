//go:build darwin

package main

// sysread_darwin.go: what the governor and the system page read, on a Mac.
// On a Push these come from /proc and /sys (governor.go, system.go, procs.go);
// macOS has neither, and answers the same questions through its own calls.

/*
#include <libproc.h>
#include <mach/mach.h>
#include <mach/mach_host.h>
#include <mach/mach_time.h>
#include <mach/processor_info.h>
#include <mach/thread_info.h>
#include <stdint.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <unistd.h>

// the processor time a process has used, in nanoseconds; UINT64_MAX: not to be read (gone, or another user's)
static uint64_t pung_proc_cpu_ns(int pid) {
	struct rusage_info_v2 ri;
	if (proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)&ri) != 0) return UINT64_MAX;
	mach_timebase_info_data_t tb;
	mach_timebase_info(&tb);
	return (ri.ri_user_time + ri.ri_system_time) * tb.numer / tb.denom;
}

// the machine's processor time since it started, all cores together, in ticks of 1/hz seconds
static int pung_host_cpu(uint64_t *busy, uint64_t *nice, uint64_t *total, long *hz) {
	natural_t n = 0;
	processor_info_array_t info;
	mach_msg_type_number_t cnt = 0;
	if (host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &n, &info, &cnt) != KERN_SUCCESS) return 0;
	*busy = *nice = *total = 0;
	for (natural_t i = 0; i < n; i++) {
		integer_t *c = info + i * CPU_STATE_MAX;
		*busy += (uint64_t)c[CPU_STATE_USER] + (uint64_t)c[CPU_STATE_SYSTEM];
		*nice += (uint64_t)c[CPU_STATE_NICE];
		*total += (uint64_t)c[CPU_STATE_USER] + (uint64_t)c[CPU_STATE_SYSTEM] + (uint64_t)c[CPU_STATE_NICE] + (uint64_t)c[CPU_STATE_IDLE];
	}
	vm_deallocate(mach_task_self(), (vm_address_t)info, cnt * sizeof(integer_t));
	*hz = sysconf(_SC_CLK_TCK);
	return 1;
}

// this process's threads: their ids, names and processor time (microseconds); returns how many
static int pung_threads(uint64_t *ids, uint64_t *us, char names[][64], int max) {
	thread_act_array_t list;
	mach_msg_type_number_t n = 0;
	if (task_threads(mach_task_self(), &list, &n) != KERN_SUCCESS) return 0;
	int out = 0;
	for (mach_msg_type_number_t i = 0; i < n; i++) {
		if (out < max) {
			thread_basic_info_data_t bi;
			mach_msg_type_number_t c = THREAD_BASIC_INFO_COUNT;
			thread_identifier_info_data_t ii;
			mach_msg_type_number_t ic = THREAD_IDENTIFIER_INFO_COUNT;
			thread_extended_info_data_t ei;
			mach_msg_type_number_t ec = THREAD_EXTENDED_INFO_COUNT;
			if (thread_info(list[i], THREAD_BASIC_INFO, (thread_info_t)&bi, &c) == KERN_SUCCESS &&
			    thread_info(list[i], THREAD_IDENTIFIER_INFO, (thread_info_t)&ii, &ic) == KERN_SUCCESS) {
				ids[out] = ii.thread_id;
				us[out] = ((uint64_t)bi.user_time.seconds + bi.system_time.seconds) * 1000000ULL + bi.user_time.microseconds + bi.system_time.microseconds;
				names[out][0] = 0;
				if (thread_info(list[i], THREAD_EXTENDED_INFO, (thread_info_t)&ei, &ec) == KERN_SUCCESS) {
					strncpy(names[out], ei.pth_name, 63);
					names[out][63] = 0;
				}
				out++;
			}
		}
		mach_port_deallocate(mach_task_self(), list[i]);
	}
	vm_deallocate(mach_task_self(), (vm_address_t)list, n * sizeof(thread_act_t));
	return out;
}

// one process: its parent, its group, its name and its executable; 0: not to be read
static int pung_proc(int pid, int *ppid, int *pgid, char *comm, char *exe, int exelen) {
	struct proc_bsdinfo b;
	if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &b, sizeof b) != (int)sizeof b) return 0;
	*ppid = (int)b.pbi_ppid;
	*pgid = (int)b.pbi_pgid;
	strncpy(comm, b.pbi_comm, MAXCOMLEN);
	comm[MAXCOMLEN] = 0;
	exe[0] = 0;
	proc_pidpath(pid, exe, (uint32_t)exelen);
	return 1;
}

// memory: all of it, and what is free or given back at once (free, inactive, purgeable, speculative)
static int pung_mem(uint64_t *total, uint64_t *avail) {
	size_t len = sizeof *total;
	if (sysctlbyname("hw.memsize", total, &len, NULL, 0) != 0) return 0;
	vm_statistics64_data_t vm;
	mach_msg_type_number_t c = HOST_VM_INFO64_COUNT;
	if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &c) != KERN_SUCCESS) return 0;
	*avail = ((uint64_t)vm.free_count + vm.inactive_count + vm.purgeable_count + vm.speculative_count) * (uint64_t)vm_kernel_page_size;
	return 1;
}

static int pung_os_version(char *out, size_t len) { return sysctlbyname("kern.osproductversion", out, &len, NULL, 0) == 0; }
*/
import "C"

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unsafe"
)

func macProcCPU(pid int) (time.Duration, bool) {
	ns := uint64(C.pung_proc_cpu_ns(C.int(pid)))
	if ns == ^uint64(0) {
		return 0, false
	}
	return time.Duration(ns), true
}

func macSystemCPU() (busy, background, total time.Duration, ok bool) {
	var b, n, t C.uint64_t
	var hz C.long
	if C.pung_host_cpu(&b, &n, &t, &hz) == 0 || hz <= 0 {
		return 0, 0, 0, false
	}
	tick := time.Second / time.Duration(hz)
	return time.Duration(b) * tick, time.Duration(n) * tick, time.Duration(t) * tick, true
}

func macThreadCPUs() map[int]govThread {
	const max = 512
	var ids, us [max]C.uint64_t
	var names [max][64]C.char
	n := int(C.pung_threads(&ids[0], &us[0], &names[0], max))
	// A thread nobody named is Go's own here (on Linux such a thread carries
	// the process's name, and the governor counts those as Go's): it is given
	// that name, so that only a module's named threads count as a module's.
	self := filepath.Base(os.Args[0])
	if len(self) > 15 {
		self = self[:15]
	}
	out := map[int]govThread{}
	for i := 0; i < n; i++ {
		name := C.GoString(&names[i][0])
		if name == "" {
			name = self
		}
		out[int(ids[i])] = govThread{name, time.Duration(us[i]) * time.Microsecond}
	}
	return out
}

func macListProcs() []procInfo {
	n := int(C.proc_listallpids(nil, 0))
	if n <= 0 {
		return nil
	}
	pids := make([]C.int, n+64)
	n = int(C.proc_listallpids(unsafe.Pointer(&pids[0]), C.int(len(pids))*C.int(unsafe.Sizeof(pids[0]))))
	var out []procInfo
	var comm [C.MAXCOMLEN + 1]C.char
	var exe [C.PROC_PIDPATHINFO_MAXSIZE]C.char
	for i := 0; i < n && i < len(pids); i++ {
		var ppid, pgid C.int
		if pids[i] <= 0 || C.pung_proc(pids[i], &ppid, &pgid, &comm[0], &exe[0], C.int(len(exe))) == 0 {
			continue // gone, or another user's
		}
		out = append(out, procInfo{pid: int(pids[i]), ppid: int(ppid), pgid: int(pgid), comm: C.GoString(&comm[0]), exe: C.GoString(&exe[0])})
	}
	return out
}

func macMeminfo() (total, avail int64) {
	var t, a C.uint64_t
	if C.pung_mem(&t, &a) == 0 {
		return 0, 0
	}
	return int64(t), int64(a)
}

var macBattRe = regexp.MustCompile(`(\d+)%;\s*([^;]+);`)

// macBattery: the Mac's battery, as `pmset -g batt` says it (nil: a Mac without one)
func macBattery() map[string]any {
	out, err := exec.Command("/usr/bin/pmset", "-g", "batt").Output()
	if err != nil {
		return nil
	}
	m := macBattRe.FindStringSubmatch(string(out))
	if m == nil {
		return nil
	}
	pct, _ := strconv.Atoi(m[1])
	st := strings.TrimSpace(m[2])
	// "charging", "charged", "finishing charge", "AC attached"; "discharging" on the battery alone
	return map[string]any{"percent": pct, "status": strings.ToUpper(st[:1]) + st[1:], "charging": !strings.HasPrefix(st, "discharging")}
}

func macOSRelease() (name, version string) {
	var buf [64]C.char
	if C.pung_os_version(&buf[0], C.size_t(len(buf))) == 0 {
		return "macOS", ""
	}
	return "macOS", C.GoString(&buf[0])
}
