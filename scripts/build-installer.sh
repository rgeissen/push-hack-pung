#!/bin/sh
# Builds the Pung Installer (installer/) for every computer it runs on, into
# build/installer/, ready for pung.live/download/:
#
#   Pung-Installer-macOS.zip     Pung Installer.app, Apple silicon and Intel in one
#   Pung-Installer-Windows.zip   pung-installer.exe
#   Pung-Installer-Linux-x86_64.tar.gz, Pung-Installer-Linux-arm64.tar.gz
#
# The programs are built in the Docker image (pure Go, no cgo); the macOS app
# is put together on a Mac (lipo, iconutil, codesign). Not yet signed with a
# developer identity: macOS and Windows warn once (the download page says how
# to open it). VERSION: installer/VERSION.
#
#   scripts/build-installer.sh
set -eu
cd "$(dirname "$0")/.."
V=$(cat installer/VERSION)
OUT=build/installer
DOCKER="docker run --rm --platform linux/amd64 -v $PWD:/w -v push-hack-pung-gomod:/root/go/pkg/mod -w /w/installer push-hack-pung-builder"
rm -rf "$OUT" && mkdir -p "$OUT/bin"
$DOCKER sh -c "
  for t in darwin/arm64 darwin/amd64 windows/amd64 linux/amd64 linux/arm64; do
    o=\${t%/*}; a=\${t#*/}; ext=; [ \$o = windows ] && ext=.exe
    CGO_ENABLED=0 GOOS=\$o GOARCH=\$a go build -trimpath -ldflags '-s -w -X main.version=$V' -o /w/$OUT/bin/pung-installer-\$o-\$a\$ext . || exit 1
  done"

# macOS: an app, both processors, Pung's icon, signed ad hoc (Apple silicon runs nothing unsigned)
APP="$OUT/mac/Pung Installer.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/pung-installer" "$OUT/bin/pung-installer-darwin-arm64" "$OUT/bin/pung-installer-darwin-amd64"
ICON="$OUT/icon.iconset"
mkdir -p "$ICON"
for s in 16 32 128 256 512; do
  sips -z $s $s installer/icon-512.png --out "$ICON/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d installer/icon-512.png --out "$ICON/icon_${s}x${s}@2x.png" >/dev/null
done
cp installer/icon-512.png "$ICON/icon_512x512@2x.png"
iconutil -c icns "$ICON" -o "$APP/Contents/Resources/Pung.icns"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Pung Installer</string>
  <key>CFBundleDisplayName</key><string>Pung Installer</string>
  <key>CFBundleIdentifier</key><string>live.pung.installer</string>
  <key>CFBundleVersion</key><string>$V</string>
  <key>CFBundleShortVersionString</key><string>$V</string>
  <key>CFBundleExecutable</key><string>pung-installer</string>
  <key>CFBundleIconFile</key><string>Pung</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSLocalNetworkUsageDescription</key><string>Pung Installer reaches your Push 3 on your home network to install Pung on it.</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
codesign --force --deep -s - "$APP"
(cd "$OUT/mac" && zip -qry "../Pung-Installer-macOS.zip" "Pung Installer.app")

# Windows and Linux: the program, the licences beside it
for f in LICENSE; do cp "$f" "$OUT/bin/"; done
cp installer/NOTICE "$OUT/bin/NOTICE.txt"
(cd "$OUT/bin" && cp pung-installer-windows-amd64.exe pung-installer.exe && zip -q "../Pung-Installer-Windows.zip" pung-installer.exe LICENSE NOTICE.txt && rm pung-installer.exe)
for a in amd64:x86_64 arm64:arm64; do
  (cd "$OUT/bin" && cp "pung-installer-linux-${a%%:*}" pung-installer && tar -czf "../Pung-Installer-Linux-${a##*:}.tar.gz" pung-installer LICENSE NOTICE.txt && rm pung-installer)
done
rm -rf "$ICON"
ls -la "$OUT"/*.zip "$OUT"/*.tar.gz
echo "Pung Installer $V"
