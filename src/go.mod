module github.com/rgeissen/push-hack-pung

go 1.25.0

require (
	github.com/dop251/goja v0.0.0-20250630131328-58d95d85e994
	github.com/federico-pepe/ableton-push-hack/core v0.6.0
	golang.org/x/image v0.41.0
)

require (
	github.com/dlclark/regexp2 v1.11.4 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	golang.org/x/text v0.37.0 // indirect
)

// core with livedevice.Looper (a device serving its own blocks, rtloop.go):
// rgeissen/ableton-push-hack, branch feat/livedevice-native-loop, until it
// is in a core release
replace github.com/federico-pepe/ableton-push-hack/core => github.com/rgeissen/ableton-push-hack/core v0.0.0-20261121223408-c3f0deed6ebc
