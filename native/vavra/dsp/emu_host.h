// emu_host.h: the plugin's side of an engine (emu_shm.h): the memory, the
// engine's process, its stop. Identical copies in native/nodalred/dsp,
// native/vavra/dsp and native/xenia/dsp (edit one, copy, cmp).
//
// The engine is started with posix_spawn (never fork: Pung's process has
// dozens of threads, and a forked child of it may meet a lock another thread
// held), the memory as its descriptor 3. It dies with its parent
// (PR_SET_PDEATHSIG in the engine); a stop asks it, then kills it after a
// second; nothing here waits for an engine that hangs.
#pragma once

#include <atomic>
#include <cerrno>
#include <cstring>
#include <mutex>
#include <new>
#include <string>

#include <signal.h>
#include <spawn.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>

#include "emu_shm.h"

extern char **environ;

namespace eshm {

// Rest: a sample this near zero is silence (2 of 32768: -84 dB).
const int REST_LSB = 2;

struct Host {
    Layout *L = nullptr;
    int memfd = -1;
    std::atomic<pid_t> pid{0};
    std::mutex qMu; // the queue to the engine has one writer at a time

    // Rest (docs/GOVERNOR.md). An emulator runs its DSP whether a voice
    // sounds or not: most of a core for nobody. Once the synth has been
    // silent for restAfterMs, with no key held and nothing sent to it,
    // render_block stops reading the ring (heard). The engine renders only
    // to keep the ring ahead, so it stops with it, the ring full, and waits
    // (rest_wait). Whatever is sent next (a note, a knob, a sound) ends the
    // rest before it goes (send): the engine takes it with the ring as far
    // ahead as it ever is, so a first note is as on time as any other
    // (measured on a Push, 2026-11-25: 15.0 ms to its sound against 14.4
    // awake, no underrun in 20 wakings). The emulated synth's time stands
    // still meanwhile. restAfterMs 0: it never rests.
    std::atomic<int> restAfterMs{0};
    std::atomic<int64_t> lastSend{0}; // us (mono_us): anything to the engine
    std::atomic<uint32_t> rests{0};   // times it went to rest
    uint32_t quietFrames = 0;         // render_block's: frames of silence in a row

    bool resting() const { return L && L->rest.load(std::memory_order_acquire); }

    // Awake: before anything goes to the engine, and when a rest must end
    // for another reason. (heard looks at lastSend again after it lets the
    // synth rest: one of the two always ends a rest begun at this moment.)
    void wake() {
        lastSend.store(mono_us(), std::memory_order_release);
        if (L) L->rest.store(0, std::memory_order_release);
    }

    // render_block's, after it read a block: loud is the block's loudest
    // sample (of 32768), whole whether the ring had all of it, held whether
    // a key is down. Lets the synth rest when it may.
    void heard(int loud, bool whole, int frames, bool held) {
        quietFrames = loud > REST_LSB || !whole || held ? 0 : quietFrames + uint32_t(frames);
        const int ms = restAfterMs.load(std::memory_order_relaxed);
        if (ms <= 0 || quietFrames / 44 < uint32_t(ms)) return;
        const int64_t sent = lastSend.load(std::memory_order_acquire);
        if (mono_us() - sent < int64_t(ms) * 1000 || L->wantDeep.load(std::memory_order_relaxed) || !empty(L->toEngine)) return;
        quietFrames = 0;
        L->rest.store(1, std::memory_order_release);
        if (lastSend.load(std::memory_order_acquire) != sent) // something went meanwhile
            L->rest.store(0, std::memory_order_release);
        else
            rests.fetch_add(1, std::memory_order_relaxed);
    }

    bool make(const char *name) {
        memfd = memfd_create(name, MFD_CLOEXEC);
        if (memfd < 0 || ftruncate(memfd, sizeof(Layout)) != 0) return false;
        void *m = mmap(nullptr, sizeof(Layout), PROT_READ | PROT_WRITE, MAP_SHARED, memfd, 0);
        if (m == MAP_FAILED) return false;
        L = new (m) Layout(); // (zeroed; the atomics constructed)
        L->magic = MAGIC;
        L->version = VERSION;
        sem_init(&L->wake, 1, 0);
        return true;
    }

    void free() {
        if (L) {
            sem_destroy(&L->wake);
            munmap(L, sizeof(Layout));
            L = nullptr;
        }
        if (memfd >= 0) close(memfd);
        memfd = -1;
    }

    // An entry to the engine. false: no memory, or the queue is full.
    bool send(uint8_t kind, const uint8_t *b, size_t n) {
        if (!L) return false;
        std::lock_guard<std::mutex> l(qMu);
        wake(); // (a rest ends before the entry is there)
        const bool ok = put(L->toEngine, kind, b, n);
        sem_post(&L->wake);
        return ok;
    }

    bool playing() const { return L && L->phase.load(std::memory_order_acquire) == RUNNING; }

    // The engine started afresh: the memory's state reset, then exe with the
    // memory as descriptor 3. 0, or the error (errno).
    int spawn(const std::string &exe, const std::string &romPath, int model, int gain) {
        {
            std::lock_guard<std::mutex> l(qMu);
            clear(L->toEngine);
        }
        clear(L->fromEngine);
        L->quit = 0;
        L->phase = STARTING;
        L->wr = 0;
        L->rd = 0;
        L->missAt = 0;
        wake(); // (and no rest before the synth has been heard for a while)
        L->wantDeep = 0;
        L->deepUntil = 0;
        L->blockMaxUs = 0;
        L->model = model;
        L->gain = gain;
        snprintf(L->romPath, sizeof(L->romPath), "%s", romPath.c_str());
        set_text(L, "Starting", "");
        posix_spawn_file_actions_t fa;
        posix_spawn_file_actions_init(&fa);
        posix_spawn_file_actions_adddup2(&fa, memfd, 3); // (dup2's copy stays open across exec)
        // the full path as its name: gearmulator looks for files beside the
        // program it runs in (a bare name made it try "nodalred-engine/")
        std::string a0 = exe, a1 = "--shm-fd=3";
        char *argv[] = {const_cast<char *>(a0.c_str()), const_cast<char *>(a1.c_str()), nullptr};
        pid_t p = 0;
        const int err = posix_spawn(&p, exe.c_str(), &fa, nullptr, argv, environ);
        posix_spawn_file_actions_destroy(&fa);
        if (err == 0) pid = p;
        return err;
    }

    // The engine ended: asked first, then killed. Never waits long.
    // false: there was none.
    bool end() {
        const pid_t p = pid.exchange(0);
        if (!p) return false;
        if (L) {
            L->quit = 1;
            sem_post(&L->wake);
        }
        for (int i = 0; i < 100; i++) { // up to 1 s
            if (waitpid(p, nullptr, WNOHANG) == p) return true;
            usleep(10000);
        }
        kill(p, SIGKILL);
        waitpid(p, nullptr, 0); // (a killed process is gone at once)
        return true;
    }

    // The engine ended by itself: true, and why ("signal 9", "exit 1").
    bool died(char *why, size_t n) {
        const pid_t p = pid.load();
        int st = 0;
        if (!p || waitpid(p, &st, WNOHANG) != p) return false;
        pid = 0;
        if (WIFSIGNALED(st)) snprintf(why, n, "signal %d", WTERMSIG(st));
        else snprintf(why, n, "exit %d", WEXITSTATUS(st));
        return true;
    }
};

} // namespace eshm
