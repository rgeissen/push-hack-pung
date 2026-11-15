#!/usr/bin/env bash
# Runs every module recipe, in the builder container (no network).
#   /recipes  generated recipes (build/recipes), /hand  hand-written ones (scripts/recipes)
#   /modsrc   the sources (read only), /out  the module tree, /logs  one log per module
# Hand-written recipes win. A recipe gets 30 minutes. Prints one status line per
# module and writes /logs/status.tsv: id, ok|FAILED, seconds.
#   build-all.sh [id ...]   (none: all)
set -uo pipefail
JOBS=${JOBS:-6}
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
    mapfile -t ids < <( (ls /recipes/*.sh /hand/*.sh 2>/dev/null) | xargs -n1 basename | sed 's/\.sh$//' | grep -v '^_' | sort -u)
fi
one() {
    local id=$1 r=/recipes/$1.sh t0 rc
    [ -f "/hand/$id.sh" ] && r=/hand/$id.sh
    t0=$(date +%s)
    timeout 1800 bash "$r" >"/logs/$id.log" 2>&1; rc=$?
    # executables: the Push's loader path (scripts/fix-interp.py)
    [ $rc -eq 0 ] && for d in /out/*/"$id"; do [ -d "$d" ] && python3 /s/fix-interp.py "$d" >>"/logs/$id.log"; done
    local s=ok; [ $rc -eq 0 ] || s=FAILED
    printf '%s\t%s\t%s\n' "$id" "$s" "$(( $(date +%s) - t0 ))" | tee -a /logs/status.tsv
}
export -f one
if [ $# -eq 0 ]; then
    : > /logs/status.tsv
else  # a partial run keeps the other modules' lines
    touch /logs/status.tsv
    for id in "${ids[@]}"; do sed -i "/^${id}\t/d" /logs/status.tsv; done
fi
printf '%s\n' "${ids[@]}" | xargs -P "$JOBS" -I{} bash -c 'one {}'
echo "== $(grep -c $'\tok\t' /logs/status.tsv) ok, $(grep -c FAILED /logs/status.tsv) failed (of all runs so far)"
