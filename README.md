# Droid Setup

A desktop toolkit for preparing Android devices on Windows and Linux.

**Version 0.2** includes USB device information, English/Spanish controls, Samsung identifier reading and a cross-manufacturer factory-reset preparation wizard. The wizard checks accounts and restrictions, guides account removal by the owner, then opens Android Settings for the final on-phone confirmation. App management and permission changes remain future work.

## Use the application

1. Open the Linux AppImage or install the Windows executable.
2. Follow the connection guide: unlock the phone, enable Developer options and USB debugging, and connect a data-capable USB cable.
3. Accept the USB debugging authorization on the phone.
4. Review the model, manufacturer, Android version and serial number. Select a phone if several are connected.
5. Use the top-bar language selector or **Settings** to switch between English and Spanish. English is the default; your choice persists locally.
6. Collapse or expand the sidebar using its toggle. Navigation and the footer stay visible while the view content scrolls. Custom selectors support arrows, Home/End, Enter/Space and Escape.

**ADB is included.** You do not need to install Android Studio, Java, Node, Rust or ADB, or configure a path to use a packaged release. Droid Setup never falls back to system ADB. Linux USB access rules or a Windows manufacturer USB driver may still be required.

The application never sends a wipe command, silently removes accounts, grants permissions, installs APKs or bypasses Android authorization. The owner performs the final factory-reset confirmation in Android Settings. A phone at its initial welcome screen may require manual setup before USB debugging can be enabled.

## Prepare a factory reset

1. Connect and authorize the intended phone, then open **Factory reset**. This module uses a common Android flow; it is not limited to Samsung.
2. Click **Check device**. The application reads account types/counts across reported Android users, the active user, device/profile ownership and factory-reset restrictions. It does not collect account names, passwords or recovery codes.
3. Review the findings. Detected accounts, extra users/profiles, a non-owner/locked user, an administrator or an explicit reset restriction block the reset handoff. **None reported** is limited to Android's output; it is not proof that Google FRP or a manufacturer cloud activation lock has been removed.
4. Use **Open account settings** and ask the owner to remove accounts on the phone. Samsung/Xiaomi cloud sign-out may require the owner's password and Find device confirmation. For an account not listed in Android Settings, sign out in its corresponding application, then check again. No account databases or authenticator apps are cleared automatically.
5. After a fresh check, confirm backup and account/cloud sign-out with the owner. Incomplete checks remain explicitly unverified and require a separate manual review acknowledgment; this never overrides a known blocker.
6. Confirm ownership authorization, data loss and the exact serial number. **Open reset settings** consumes the review, rechecks the same physical device/user and opens the exported Settings entry if available. When an OEM does not provide or permit that entry, the app opens general Settings and shows the manufacturer's manual path.
7. Review and confirm the actual erase **on the phone**. A USB disconnect is reported as an unknown reset state, never success.

Review IDs are single-use and expire after five minutes. Device/user changes, opening account settings, failed checks or an account-list change require a new review. Background discovery pauses during device actions. Only one device is inspected at a time.

Account removal and cloud unlinking must be completed through the owner's normal Android/OEM flows. Do not use this module as evidence that FRP, enterprise enrollment or vendor activation protections are cleared. Use the administrator/provider's supported process when necessary. See [Samsung's reset preparation](https://www.samsung.com/uk/support/mobile-devices/how-do-i-perform-factory-reset-on-my-mobile-device/) and [Xiaomi's transfer guidance](https://account.xiaomi.com/helpcenter/faq/en_US/03.account-safety/08.lost-stolen-replaced/faq-3).

The preflight was exercised read-only on Xiaomi Android 14 and a ZTE Blade A54. No real accounts were removed and no real factory reset was performed during implementation validation. Automated tests cover malformed/partial account data, other-user accounts, restrictions, stale reviews and Settings navigation with simulated devices.

## Build on Linux with Docker

Docker is the recommended build path on Arch/EndeavourOS. It provides an Ubuntu 24.04 environment containing Node, Rust and Tauri's native dependencies.

```bash
bash scripts/docker-build.sh
```

The build runs frontend and Rust tests, creates the AppImage and exports it with SHA-256 checksums and ADB notices into a new `artifacts/linux-<timestamp>-<pid>/` directory. No USB device, Docker socket or host project directory is mounted into a running container. Network access is needed to prepare build dependencies; USB detection in the finished application works offline.

Run the resulting AppImage **on the host**, not inside Docker:

```bash
chmod +x artifacts/linux-<timestamp>-<pid>/*.AppImage
./artifacts/linux-<timestamp>-<pid>/Droid*.AppImage
```

See [build and packaging details](docs/building.md) for native development, Windows builds and compatibility limits.

## Native development

Requirements: Node 24.21.0, npm, Rust 1.99.1, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS. Use the Angular CLI installed in this project; no global Angular CLI is necessary.

```bash
npm ci
npm run desktop
```

`desktop` verifies/prepares the bundled ADB, starts Angular on loopback port 1420 and opens the Tauri window. `npm start` alone is a browser preview: it explicitly does not claim USB connectivity.

```bash
npm test
npm run build
npm run tools:prepare
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

The frontend uses Angular standalone components, strict TypeScript, signals and SCSS. Rust owns the native command boundary. All UI text lives in typed English/Spanish dictionaries. Language and sidebar expansion preferences are persisted; device inventories and identifiers are not written to disk.

## USB detection

- ADB queries are serialized, with a five-second command timeout and a fifteen-second scan timeout. Polling waits three seconds after completion.
- The included executable uses a dedicated local ADB server on `localhost:5038`, separate from the usual `5037` server. No server address or command can be supplied by the interface. The private server can remain available after closing the window.
- Physical USB transport is verified before properties are queried. Emulators and known network transports are excluded. Unverifiable devices are never marked connected.
- Unauthorized, offline, unavailable USB permissions, unsupported phone modes, missing tools and timeouts receive distinct guidance.
- Metadata is cleared after failed scans. A final inventory check prevents publishing details after a disconnect during inspection.
- Several phones may be listed, but properties are read only for the selected phone. Changing the selection during polling queues a fresh scan.

On Arch/EndeavourOS, review the `android-udev` package and its documented group requirements if USB access is denied. Reconnect after configuring access. Do not run Droid Setup as root. On Windows, use the official USB driver for the device manufacturer if needed.

## Bundled tools and licenses

Build preparation downloads **Android Platform-Tools 37.0.1** from versioned Google URLs. `scripts/adb-manifest.json` pins archive and individual-file SHA-256 hashes. A changed download fails verification; upgrades require an intentional manifest update.

Only ADB, its supporting libraries, source properties and the original `NOTICE.txt` are bundled. Other tools such as fastboot are excluded. The bundled notices are available under **Settings → Read licenses** and beside exported packages.

Android Debug Bridge is an Android Open Source Project component; see its [Apache 2.0 notice](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/NOTICE) and Google's [SDK terms](https://developer.android.com/studio/terms), including the open-source component provision. Preserve all bundled notices when distributing builds. Build dependencies have their own licenses.

## Validation boundaries

Automated fake-device tests verify parsing, command restrictions, USB verification, timeouts, disconnects, selection and UI state. They do not establish real phone compatibility. Browser checks verify interface behavior and localization, not native USB access.

Before calling a release device-tested, open the packaged application and complete connect/authorize/disconnect/reconnect on a real phone in both the target Linux environment and Windows. Build success and artifact creation are separate from those checks. CI uploads artifacts only; it does not publish a GitHub release or sign installers.

## Samsung identifiers

IMEI and phone number are supported only for Samsung devices. **Read from phone** visibly opens Settings on the unlocked phone, reads explicitly labelled values and removes its temporary reader. It targets SIM 1 and never runs automatically at connection. The flow was exercised on a connected Galaxy A05; other Samsung layouts may differ.

The interface shows only values actually returned. Missing identifiers are omitted, and other brands show general device data only. There is no manual identifier form, dialer-code execution, operator query or operator configuration.

The reader checks its own checksum, limits its lifetime, and reports unsupported screens or cleanup problems. See [reader boundaries and rebuild instructions](android-helper/README.md). Screen-read identifiers are kept only for the current connection and are cleared on disconnect. They are not saved to disk.

Copy buttons write only the chosen visible value after a click. The application has clipboard write permission only; it does not read clipboard contents.
