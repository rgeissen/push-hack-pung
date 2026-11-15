# Shared by hand recipes: the module's data files (module dir minus sources)
# and its licences.   module_data <module dir in the repo>
module_data() {
    ( cd "$R/$1" && find . -path ./dsp -prune -o -type f -print \
        | grep -Ev '\.(c|cc|cpp|cxx|h|hpp|hh|hxx|inc|ipp|o|a|s|S|rs|dsp|cmake|mk|so|py|sh|toml|lock)$|/\.git/|/(build|dist|tests?|node_modules)/' \
        | while read -r f; do mkdir -p "$D/$(dirname "$f")"; cp "$f" "$D/$f"; done )
    for f in LICENSE LICENSE.md LICENSE.txt THIRD_PARTY_LICENSES THIRD_PARTY_LICENSES.md NOTICE; do
        [ -f "$R/$f" ] && cp "$R/$f" "$D/" || true
    done
    [ -d "$R/licenses" ] && cp -R "$R/licenses" "$D/" || true
}
