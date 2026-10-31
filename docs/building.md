# Building Droid Setup

Droid Setup uses Angular for the interface and Tauri/Rust for desktop integration. ADB is included in each package; users do not need Node, Rust, Docker, or a separately installed ADB to run it.

## Linux with Docker

On an x64 Linux host with Docker and its BuildKit local exporter available, run from the repository root:

```sh
bash scripts/docker-build.sh
```

The build uses Ubuntu 24.04, Node 24.21.0, Rust 1.99.1, `package-lock.json`, and `Cargo.lock`. It downloads the official Android archive pinned by `scripts/adb-manifest.json`, verifies the archive and selected-file checksums, runs frontend and native tests, and produces an AppImage. An Internet connection is required for the first build.

Artifacts are exported into a fresh `artifacts/linux-<timestamp>-<pid>/` directory, together with checksums, ADB notices, and the tool manifest. The Docker build sends a filtered source context and uses normal build cache. It does not mount your home directory, USB devices, Docker socket, or host development toolchains. No privileged container or persistent service is started, and no image is pushed. Do not run global Docker cleanup to remove these artifacts; remove only a build output directory you no longer need.

Open the generated AppImage on your EndeavourOS desktop, outside Docker:

```sh
cd artifacts/linux-<timestamp>-<pid>
sha256sum -c SHA256SUMS
chmod +x ./*.AppImage
./Droid*.AppImage
```

If the host lacks FUSE support, AppImage supports extraction mode:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./Droid*.AppImage
```

The container performs compile and automated-test checks. It cannot establish that a real phone works on the host. Test the packaged UI, English/Spanish preferences, USB authorization, disconnect/reconnect, and multi-device selection on EndeavourOS. Linux USB permissions still depend on host udev configuration. Docker is not used to run the desktop UI or access the phone.

The Ubuntu baseline limits accidental dependencies on newer Arch libraries. Compatibility still needs validation on each claimed distribution. Image tags and apt repositories are versioned but not pinned to immutable digests/snapshots; this is a repeatable build recipe, not a bit-for-bit reproducibility guarantee. ADB checksums intentionally fail closed if an upstream archive changes. Update its version and checksums together after reviewing the upstream files.

## Native development

For interactive development, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), Node 24.21.0, and Rust 1.99.1 on the development machine, then run:

```sh
npm ci
npm run desktop
```

The frontend-only preview (`npm start`) cannot detect USB phones. The desktop command prepares bundled ADB before starting Tauri. It does not select an ADB from the host PATH.

## Windows

Build on Windows x64 with the Tauri Windows prerequisites, Node 24.21.0, and Rust 1.99.1:

```powershell
npm ci
npm run tools:prepare
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run desktop:build -- --config src-tauri/tauri.windows.conf.json -- --locked
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. Validate installation, launch, the WebView2 prerequisite, and real USB communication on Windows separately. Manufacturer USB drivers may be required. The initial build is unsigned; signing credentials and release publishing are outside this configuration.

## CI artifacts

`.github/workflows/build.yml` defines Linux Docker and native Windows builds. It runs on pull requests, pushes to `main`/`develop`, or manual dispatch and uploads downloadable workflow artifacts for 14 days. It has read-only repository permissions, does not create releases, and does not push commits or packages. Workflow files alone are not evidence that CI has run successfully.

References: [Tauri AppImage packaging](https://v2.tauri.app/distribute/appimage/), [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/), and [Docker local export](https://docs.docker.com/build/exporters/local-tar/).

## Linux rendering compatibility

On Wayland, Droid Setup defaults `WEBKIT_DISABLE_DMABUF_RENDERER=1` before starting WebKitGTK. The default rendering path produced duplicated and corrupted surfaces on the tested EndeavourOS desktop (WebKitGTK 2.52.6). This setting applies only to the app process, leaves Windows unchanged, and preserves an explicitly supplied environment value. To test the native renderer on a different graphics setup, launch with `WEBKIT_DISABLE_DMABUF_RENDERER=0`. This may be faster but can restore the artifacts on affected systems.

See [Tauri's Linux graphics guidance](https://v2.tauri.app/develop/debug/linux-graphics/). This is a compatibility workaround, not a graphics-driver repair or a claim that all Linux GPU combinations are verified.

## Production styles

Keep Angular critical CSS inlining disabled. Tauri assigns CSP nonces to static inline styles; those nonces make the existing `unsafe-inline` style source ineffective for Angular component styles inserted at runtime. External production CSS avoids that conflict while retaining Tauri CSP handling. `npm run build` checks the generated HTML for this packaging regression.
