//go:build darwin

package main

import (
	"strconv"

	"github.com/federico-pepe/ableton-push-hack/core/livedevice"
)

// setDevicePage: the page a device's own window shows in its host. On a Mac
// the plugin has a window: Pung's interface for that device, served on this
// machine (the plugin adds which device). The setting is the macOS port's of
// the device layer (macos/patches), so it is named only in this file.
func setDevicePage(cfg *livedevice.BundleConfig, port int) {
	cfg.Page = "http://127.0.0.1:" + strconv.Itoa(port) + "/"
}
