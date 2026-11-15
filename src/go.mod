module github.com/rgeissen/push-hack-pung

go 1.25.0

require (
	github.com/federico-pepe/ableton-push-hack/core v0.5.6
	golang.org/x/image v0.41.0
)

require (
	github.com/dlclark/regexp2 v1.11.4 // indirect
	github.com/dop251/goja v0.0.0-20250630131328-58d95d85e994 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	golang.org/x/text v0.37.0 // indirect
)

// core/livedevice is new in push-hack (branch feat/live-devices) and not yet
// in a core/vX.Y.Z tag: build against the checkout beside this repo until it
// is, then drop this line and pin the tag.
replace github.com/federico-pepe/ableton-push-hack/core => ../../ableton-push-hack/core
