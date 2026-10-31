# Droid Setup

A desktop toolkit for preparing Android devices on Windows and Linux.

**Version 0.1** provides a guided USB connection screen, device information with copy buttons, an explicit Settings-reader action, and an English/Spanish interface. Factory reset, app management, and permission changes are planned for later releases and are not implemented here.

## Use the application

1. Open the Linux AppImage or install the Windows executable.
2. Follow the connection guide: unlock the phone, enable Developer options and USB debugging, and connect a data-capable USB cable.
3. Accept the USB debugging authorization on the phone.
4. Review the model, manufacturer, Android version and serial number. Select a phone if several are connected.
5. Use the top-bar language selector or **Settings** to switch between English and Spanish. English is the default; your choice persists locally.
6. Collapse or expand the sidebar using its toggle. Navigation and the footer stay visible while the view content scrolls. Custom selectors support arrows, Home/End, Enter/Space and Escape.

**ADB is included.** You do not need to install Android Studio, Java, Node, Rust or ADB, or configure a path to use a packaged release. Droid Setup never falls back to system ADB. Linux USB access rules or a Windows manufacturer USB driver may still be required.

The application does not erase data, reset phones, grant permissions, install APKs or bypass Android authorization. A phone at its initial welcome screen may require manual setup before USB debugging can be enabled.

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

Create a native package on the corresponding OS:

```bash
npm run desktop:build
```

Windows uses the checked-in NSIS configuration. Validate its installer and USB behavior on Windows separately.

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

Only ADB, its supporting libraries, source properties and the original `NOTICE.txt` are bundled. Other tools such as fastboot are excluded. The bundled notices are available under **Settings → Read licenses** and in the packaged resources.

Android Debug Bridge is an Android Open Source Project component; see its [Apache 2.0 notice](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/NOTICE) and Google's [SDK terms](https://developer.android.com/studio/terms), including the open-source component provision. Preserve all bundled notices when distributing builds. Build dependencies have their own licenses.

## Validation boundaries

Automated fake-device tests verify parsing, command restrictions, USB verification, timeouts, disconnects, selection and UI state. They do not establish real phone compatibility. Browser checks verify interface behavior and localization, not native USB access.

Before calling a release device-tested, open the packaged application and complete connect/authorize/disconnect/reconnect on a real phone in both the target Linux environment and Windows. Build success and artifact creation are separate from those checks.

## Samsung identifiers

IMEI and phone number are supported only for Samsung devices. **Read from phone** visibly opens Settings on the unlocked phone, reads explicitly labelled values and removes its temporary reader. It targets SIM 1 and never runs automatically at connection. The flow was exercised on a connected Galaxy A05; other Samsung layouts may differ.

The interface shows only values actually returned. Missing identifiers are omitted, and other brands show general device data only. There is no manual identifier form, dialer-code execution, operator query or operator configuration.

The reader checks its own checksum, limits its lifetime, and reports unsupported screens or cleanup problems. See [reader boundaries and rebuild instructions](android-helper/README.md). Screen-read identifiers are kept only for the current connection and are cleared on disconnect. They are not saved to disk.

Copy buttons write only the chosen visible value after a click. The application has clipboard write permission only; it does not read clipboard contents.
