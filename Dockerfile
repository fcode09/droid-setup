# syntax=docker/dockerfile:1
# Versioned tool images keep the host free of Node/Rust build dependencies.
# Tags and Ubuntu apt repositories are not immutable snapshots; see docs/building.md.
FROM node:24.21.0-bookworm-slim AS node-toolchain
FROM rust:1.99.1-slim-bookworm AS rust-toolchain

FROM ubuntu:24.04 AS builder
ARG DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/cargo/bin:/usr/local/bin:${PATH}" \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    APPIMAGE_EXTRACT_AND_RUN=1 \
    CI=true
COPY --from=node-toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates build-essential curl wget file pkg-config \
       libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
       librsvg2-dev patchelf xdg-utils libfuse2t64 squashfs-tools \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run tools:prepare && npm test && npm run build
# Dedicated BuildKit caches survive failed checks and UI-only rebuilds.
RUN --mount=type=cache,id=droid-setup-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=droid-setup-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=droid-setup-rust-1.99-ubuntu24-target,target=/workspace/src-tauri/target,sharing=locked \
    cargo test --locked --manifest-path src-tauri/Cargo.toml \
    && npm run desktop:build -- --bundles appimage -- --locked \
    && mkdir /output \
    && cp src-tauri/target/release/bundle/appimage/*.AppImage /output/ \
    && cp src-tauri/resources/adb/NOTICE.txt /output/ADB-NOTICE.txt \
    && cp scripts/adb-manifest.json /output/adb-manifest.json \
    && cd /output \
    && sha256sum *.AppImage > SHA256SUMS

FROM scratch AS artifacts
COPY --from=builder /output/ /
