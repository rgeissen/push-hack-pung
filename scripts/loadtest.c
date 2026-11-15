/* loadtest: dlopen each module binary the way Schwung's chain host does
 * (RTLD_NOW: every symbol resolved at load) and look for its entry point.
 * Prints one line per file: OK <entry> | NOENTRY | FAIL <dlerror>.
 *   loadtest <file.so> ... */
#include <dlfcn.h>
#include <stdio.h>
static const char *entries[] = {"move_plugin_init_v2", "move_plugin_init_v1", "move_audio_fx_init_v2",
                                "move_audio_fx_init_v1", "move_midi_fx_init", 0};
int main(int argc, char **argv) {
    int bad = 0;
    for (int i = 1; i < argc; i++) {
        void *h = dlopen(argv[i], RTLD_NOW | RTLD_LOCAL);
        if (!h) { printf("FAIL %s %s\n", argv[i], dlerror()); bad++; continue; }
        const char *found = 0;
        for (int k = 0; entries[k] && !found; k++) if (dlsym(h, entries[k])) found = entries[k];
        printf("%s %s %s\n", found ? "OK" : "NOENTRY", argv[i], found ? found : "");
        /* never dlclose: a module's destructors may expect the host */
    }
    return bad != 0;
}
