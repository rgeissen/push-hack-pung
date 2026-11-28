#!/bin/sh
# The skills for people (and their AI assistants) who make modules and
# interfaces for Pung (skills/): each as a folder and a zip in build/skills/,
# with its references copied in from the documents they point to (links in
# the repository, so a skill never says something the documents do not).
#
#   scripts/build-skills.sh
set -eu
cd "$(dirname "$0")/.."
OUT=build/skills
rm -rf "$OUT" && mkdir -p "$OUT"
for d in skills/*/; do
  name=$(basename "$d")
  [ -f "$d/SKILL.md" ] || continue
  # the format's own rules: a name that is the folder's, a description that says when to use it
  python3 - "$d/SKILL.md" "$name" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.match(r"---\n(.*?)\n---\n", s, re.S)
assert m, "no frontmatter"
f = dict(l.split(": ", 1) for l in m.group(1).split("\n"))
assert f.get("name") == sys.argv[2], "name is not the folder's"
assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", f["name"]) and len(f["name"]) <= 64, "name"
assert 0 < len(f.get("description", "")) <= 1024, "description: %d characters" % len(f.get("description", ""))
assert "<" not in m.group(1) and ">" not in m.group(1), "angle brackets in the frontmatter"
for ref in re.findall(r"`((?:references|examples)/[^`]+)`", s):
    import os
    assert os.path.exists(os.path.join(os.path.dirname(sys.argv[1]), ref)), "missing " + ref
PY
  cp -RL "$d" "$OUT/$name"            # -L: the linked documents themselves
  cp LICENSE "$OUT/$name/LICENSE.txt"
  (cd "$OUT" && rm -f "$name.zip" && zip -qrX "$name.zip" "$name" -x '*.DS_Store')
  echo "$name: $(find "$OUT/$name" -type f | wc -l | tr -d ' ') files, $(wc -c < "$OUT/$name.zip" | tr -d ' ') bytes"
done
