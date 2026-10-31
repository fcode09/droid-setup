# Temporary Settings reader

`DroidUi.java` is a small first-party helper for an explicitly requested Settings read. It runs as the already authorized ADB shell using `app_process`; it is not an APK, installed accessibility service, root tool, or device-management agent.

The stock `uiautomator dump` failed to reach an idle state on the tested Android 14 phone. The helper uses Android's `UiAutomation` connection without that global idle wait. It preserves existing accessibility services, checks the active Settings package, skips password and invisible nodes, caps traversal/output, and has a four-second process watchdog. Android may reject its hidden API calls on other versions or manufacturers; the desktop app reports failure rather than changing hidden-API policy or permissions.

Only fixed information actions are accepted: dump, phone, IMEI, status, details and scroll. No arbitrary selector, coordinates, package, text input or shell command is accepted. The desktop implementation targets SIM 1 and only extracts explicitly labelled, validated values. A number that Android does not provide stays unavailable.

Each read verifies the selected physical USB device, checks the bundled DEX checksum, pushes it to a unique `/data/local/tmp/droid-setup-ui-*.dex` path and attempts to remove that exact file afterward. A disconnect may prevent cleanup; the UI reports this. No screen dumps or identifier history are persisted. Temporary UiAutomation registration can snapshot and restore rotation as part of Android's own lifecycle.

## Rebuild

Ordinary desktop builds use the small checked-in DEX and verify its hash and source hash. Java and an Android SDK are needed only when changing this helper. The current artifact was generated with Java 21 targeting Java 8 and Android Build-Tools 36.0.0 (D8 8.10.9-dev).

```sh
mkdir -p /tmp/droid-ui-build/classes /tmp/droid-ui-build/dex
javac --release 8 -Xlint:-options -d /tmp/droid-ui-build/classes android-helper/DroidUi.java
java -cp "$ANDROID_HOME/build-tools/36.0.0/lib/d8.jar" com.android.tools.r8.D8 \
  --min-api 24 --output /tmp/droid-ui-build/dex /tmp/droid-ui-build/classes/DroidUi*.class
cp /tmp/droid-ui-build/dex/classes.dex src-tauri/resources/helper/DroidUi.dex
```

After reviewing changes, update the SHA-256 entries in `manifest.json` for both the source and DEX. `node scripts/verify-ui-helper.mjs` must pass before packaging. The desktop backend independently checks the bundled DEX before pushing it to a phone.

IMEI, phone number and Settings-reader controls are available only for devices whose verified manufacturer is Samsung. Missing values are omitted. Other brands show general device information only. Both the frontend and native command boundary enforce this restriction. There are no operator queries, dialer codes or manual identifier forms.
