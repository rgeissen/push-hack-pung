# Pung for Push 3. Everything builds in one Ubuntu 22.04 amd64 container
# (docker/Dockerfile): glibc 2.35 is what AbletonOS runs, so the binary and
# every module built here load on the device.

IMAGE   := push-hack-pung-builder
HOST    ?= push.local
SCHWUNG ?= $(abspath $(CURDIR)/../schwung)
MODSRC  ?= $(CURDIR)/build/modsrc
VERSION := $(shell cat VERSION 2>/dev/null || echo dev)
SSH     := ssh -o BatchMode=yes -o HostKeyAlias=push.local
DOCKER  := docker run --rm --platform linux/amd64 \
	-v $(CURDIR):/w -v push-hack-pung-gomod:/root/go/pkg/mod -w /w

# AbletonOS keeps its dynamic linker at /lib, not /lib64.
LDFLAGS := -s -w -X main.buildVersion=$(VERSION) -linkmode external \
	-extldflags -Wl,--dynamic-linker=/lib/ld-linux-x86-64.so.2

.PHONY: all image build modules catalog-modules test test-visuals vet deploy clean

all: build

image:
	docker build -q --platform linux/amd64 -t $(IMAGE) docker/

# the service, and the Live plugin it installs (core/livedevice's prebuilt
# livedevice.so, from the core this build uses)
build:
	$(DOCKER) -w /w/src $(IMAGE) sh -c "CGO_ENABLED=1 go build -trimpath -ldflags '$(LDFLAGS)' -o ../pung . && \
	  cp \$$(go list -m -f '{{.Dir}}' github.com/federico-pepe/ableton-push-hack/core)/livedevice/vst3/livedevice.so ../livedevice.so && \
	  cp \$$(go list -m -f '{{.Dir}}' github.com/federico-pepe/ableton-push-hack/core)/livedevice/tools/restart-live.sh ../restart-live.sh"

test:
	$(DOCKER) -w /w/src $(IMAGE) sh -c "CGO_ENABLED=1 go test ./..."

# web/visuals.js against visuals_shapes.go, on every page of the fleet (needs node)
test-visuals:
	mkdir -p build
	$(DOCKER) -w /w/src $(IMAGE) sh -c "PUNG_FLEET_PAGES=/w/build CGO_ENABLED=1 go test -run FleetPictures ."
	node scripts/visuals-parity.js src/web/visuals.js build/fleet-pages.json

vet:
	$(DOCKER) -w /w/src $(IMAGE) sh -c "CGO_ENABLED=1 go vet ./..."

# Schwung's chain host and its built-in modules, from the Schwung checkout
modules:
	$(DOCKER) -v $(SCHWUNG):/schwung:ro -v $(CURDIR)/build/modules:/out $(IMAGE) bash /w/scripts/build-modules.sh

# catalog modules, compiled from their source (see scripts/build-catalog.sh)
catalog-modules:
	$(DOCKER) -v $(MODSRC):/modsrc:ro -v $(CURDIR)/build/modules:/out $(IMAGE) bash /w/scripts/build-catalog.sh

# files plus an init.d service, the way push-catalog installs a hack
deploy: build
	scripts/deploy.sh $(HOST)

clean:
	rm -f pung livedevice.so
