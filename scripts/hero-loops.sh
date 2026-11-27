#!/bin/sh
# The front page's loops (site/hero/<id>.mp4 and its still, <id>.png): each of
# Pung's own instruments' front panel while a chord plays, recorded from
# Pung's own renderer (src/heroframes_test.go), no Push needed. Needs ffmpeg.
#
#   scripts/hero-loops.sh [id...]
set -eu
cd "$(dirname "$0")/.."
ONLY=$(echo "$*" | tr ' ' ',')
rm -rf build/hero-frames
docker run --rm --platform linux/amd64 -v "$PWD":/w -v push-hack-pung-gomod:/root/go/pkg/mod -w /w/src push-hack-pung-builder \
  sh -c "PUNG_HERO_FRAMES=/w/build/hero-frames PUNG_HERO_ONLY='$ONLY' CGO_ENABLED=1 go test -count=1 -run 'TestHeroFrames\$' ."
mkdir -p site/hero
for d in build/hero-frames/*/; do
  id=$(basename "$d")
  # 20 frames a second as recorded; H.264 so every browser plays it, sharp enough for thin lines
  ffmpeg -y -loglevel error -framerate 20 -i "$d/f-%03d.png" -c:v libx264 -preset veryslow -crf 15 -pix_fmt yuv420p \
    -movflags +faststart -an "site/hero/$id.mp4"
  cp "$d/f-000.png" "site/hero/$id.png"
  echo "$id: $(wc -c < "site/hero/$id.mp4" | tr -d ' ') bytes"
done
