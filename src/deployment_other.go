//go:build !darwin

package main

import "github.com/federico-pepe/ableton-push-hack/core/livedevice"

// setDevicePage: no window on a Push (its screen is the device's interface, and
// Live there shows no plugin windows). See deployment_darwin.go.
func setDevicePage(cfg *livedevice.BundleConfig, port int) {}
