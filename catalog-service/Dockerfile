# pung-catalog: the catalog service for the DiskStation (catalog-service/).
# Build from the repository's root:
#
#   docker build --platform linux/amd64 -t pung-catalog -f catalog-service/Dockerfile .
#
# It is the module builder (Ubuntu 22.04 = glibc 2.35 as on Push 3, the
# toolchains, Rust: docker/Dockerfile.modules) plus the service and Pung's
# build scripts, so the builds run in the container itself.
FROM push-hack-pung-modules
COPY catalog-service /src/catalog-service
RUN cd /src/catalog-service && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /app/pung-catalog . \
    && rm -rf /src /root/go /root/.cache
COPY scripts /app/scripts
COPY catalog-service/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 8780
VOLUME ["/data", "/site"]
ENTRYPOINT ["/app/entrypoint.sh"]
