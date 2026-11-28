module github.com/rgeissen/push-hack-pung/macos

go 1.25.0

require github.com/federico-pepe/ableton-push-hack/core v0.6.1-0.20261121224524-82318076d1db

// the device layer with its macOS port (macos/patches/core-darwin.patch, applied by macos/build.sh)
replace github.com/federico-pepe/ableton-push-hack/core => ../build/macos/core
