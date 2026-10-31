use serde::Serialize;
use std::{path::PathBuf, time::Duration};
use tokio::process::Command;

const SERVER: &str = "tcp:localhost:5038";

#[derive(Debug, Serialize)]
pub struct Failure {
    pub code: &'static str,
}
impl Failure {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub usb: bool,
    pub model: Option<String>,
    pub manufacturer: Option<String>,
    pub android_version: Option<String>,
    pub imei: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub devices: Vec<Device>,
    pub inspected_serial: Option<String>,
    pub adb_version: String,
}

pub struct Adb {
    pub path: PathBuf,
}
impl Adb {
    pub(crate) async fn run(&self, args: &[&str]) -> Result<String, Failure> {
        if !self.path.is_file() {
            return Err(Failure::new("missing-tools"));
        }
        let mut command = Command::new(&self.path);
        command
            .args(["-L", SERVER])
            .args(args)
            .env_remove("ADB_SERVER_SOCKET")
            .env_remove("ANDROID_ADB_SERVER_PORT")
            .env_remove("ADB_SERVER_PORT")
            .env_remove("ANDROID_SERIAL")
            .env_remove("ADB_TRACE")
            .env_remove("ADB_VENDOR_KEYS")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        let output = tokio::time::timeout(Duration::from_secs(5), command.output())
            .await
            .map_err(|_| Failure::new("timeout"))?
            .map_err(|_error| {
                #[cfg(test)]
                eprintln!("Unable to start test executable: {_error:?}");
                Failure::new("missing-tools")
            })?;
        if !output.status.success() {
            return Err(Failure::new("error"));
        }
        String::from_utf8(output.stdout).map_err(|_| Failure::new("error"))
    }

    pub async fn scan(&self, selected: Option<&str>) -> Result<Scan, Failure> {
        let version = self.run(&["version"]).await?;
        if !version.starts_with("Android Debug Bridge version") {
            return Err(Failure::new("missing-tools"));
        }
        let mut devices = parse_devices(&self.run(&["devices", "-l"]).await?)?;
        let chosen = selected
            .filter(|serial| devices.iter().any(|d| d.serial == *serial))
            .map(str::to_owned)
            .or_else(|| {
                if devices.len() == 1 {
                    Some(devices[0].serial.clone())
                } else {
                    None
                }
            });
        for device in &mut devices {
            if device.state != "device" || Some(&device.serial) != chosen.as_ref() {
                continue;
            }
            // Verify the actual USB transport, even if the inventory has a usb: hint.
            let devpath = self.run(&["-s", &device.serial, "get-devpath"]).await;
            if matches!(&devpath, Err(failure) if failure.code == "timeout") {
                return Err(Failure::new("timeout"));
            }
            device.usb = devpath.is_ok_and(|path| path.trim().starts_with("usb:"));
            if !device.usb {
                // Windows can omit a devpath. -d is safe only if it resolves to this serial.
                device.usb = self
                    .run(&["-d", "get-serialno"])
                    .await
                    .is_ok_and(|serial| serial.trim() == device.serial);
            }
            if !device.usb {
                continue;
            }
            device.model = clean_property(
                &self
                    .run(&["-s", &device.serial, "shell", "getprop", "ro.product.model"])
                    .await?,
            );
            device.manufacturer = clean_property(
                &self
                    .run(&[
                        "-s",
                        &device.serial,
                        "shell",
                        "getprop",
                        "ro.product.manufacturer",
                    ])
                    .await?,
            );
            device.android_version = clean_property(
                &self
                    .run(&[
                        "-s",
                        &device.serial,
                        "shell",
                        "getprop",
                        "ro.build.version.release",
                    ])
                    .await?,
            );
            // Optional vendor-exposed property only; absent/restricted values remain unavailable.
            // Never infer IMEI from the ADB serial, subscriber ID, or a masked value.
            if is_samsung(device) {
                device.imei = self
                    .run(&["-s", &device.serial, "shell", "getprop", "ril.gsm.imei"])
                    .await
                    .ok()
                    .and_then(|value| clean_imei(&value));
            }
            // Do not publish metadata after a mid-scan disconnect or authorization change.
            let fresh = parse_devices(&self.run(&["devices", "-l"]).await?)?;
            if !fresh
                .iter()
                .any(|d| d.serial == device.serial && d.state == "device")
            {
                return Err(Failure::new("error"));
            }
        }
        Ok(Scan {
            devices,
            inspected_serial: chosen,
            adb_version: version.lines().take(2).collect::<Vec<_>>().join(" · "),
        })
    }
}

pub(crate) fn is_samsung(device: &Device) -> bool {
    device
        .manufacturer
        .as_deref()
        .is_some_and(|name| name.trim().eq_ignore_ascii_case("samsung"))
}

pub(crate) fn clean_imei(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() != 15
        || !value.bytes().all(|b| b.is_ascii_digit())
        || value.bytes().all(|b| b == b'0')
    {
        return None;
    }
    let sum: u32 = value
        .bytes()
        .rev()
        .enumerate()
        .map(|(index, byte)| {
            let mut digit = (byte - b'0') as u32;
            if index % 2 == 1 {
                digit *= 2;
                if digit > 9 {
                    digit -= 9;
                }
            }
            digit
        })
        .sum();
    if sum % 10 == 0 {
        Some(value.to_owned())
    } else {
        None
    }
}

fn clean_property(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        None
    } else {
        Some(value.to_owned())
    }
}

pub fn parse_devices(output: &str) -> Result<Vec<Device>, Failure> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    if lines.next().map(str::trim) != Some("List of devices attached") {
        return Err(Failure::new("error"));
    }
    let mut devices: Vec<Device> = Vec::new();
    for line in lines {
        let parts: Vec<_> = line.split_whitespace().collect();
        if parts.len() < 2 {
            return Err(Failure::new("error"));
        }
        let serial = parts[0];
        if serial.starts_with("emulator-") || serial.contains(':') || serial.contains("._tcp") {
            continue;
        }
        let permission_placeholder = parts[1] == "no"
            && parts.get(2) == Some(&"permissions")
            && serial.bytes().all(|c| c == b'?');
        if (!permission_placeholder
            && !serial
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)))
            || serial.len() > 256
        {
            return Err(Failure::new("error"));
        }
        let state = match parts[1] {
            "device" => "device",
            "unauthorized" => "unauthorized",
            "offline" => "offline",
            "no" if parts.get(2) == Some(&"permissions") => "no-permissions",
            "recovery" | "sideload" | "bootloader" | "rescue" => "unsupported",
            _ => return Err(Failure::new("error")),
        };
        if devices.iter().any(|d| d.serial == serial) {
            if permission_placeholder {
                continue;
            }
            return Err(Failure::new("error"));
        }
        devices.push(Device {
            serial: serial.to_owned(),
            state: state.to_owned(),
            // Only scan() can establish a verified connection for an authorized device.
            usb: false,
            model: parts
                .iter()
                .find_map(|p| p.strip_prefix("model:"))
                .map(|m| m.replace('_', " ")),
            manufacturer: None,
            android_version: None,
            imei: None,
        });
    }
    Ok(devices)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_inventory_is_valid() {
        assert!(parse_devices("List of devices attached\n\n")
            .unwrap()
            .is_empty());
    }
    #[test]
    fn distinguishes_states_and_never_trusts_usb_hint() {
        let result = parse_devices("List of devices attached\nONE device usb:1-2 model:Galaxy_A06\nTWO unauthorized\nTHREE offline\nFOUR no permissions (udev rules)\nFIVE recovery\n").unwrap();
        assert_eq!(result.len(), 5);
        assert_eq!(result[0].model.as_deref(), Some("Galaxy A06"));
        assert!(!result[0].usb);
        assert_eq!(result[1].state, "unauthorized");
        assert_eq!(result[2].state, "offline");
        assert_eq!(result[3].state, "no-permissions");
        assert_eq!(result[4].state, "unsupported");
    }
    #[test]
    fn excludes_emulators_and_network_transports() {
        assert!(parse_devices("List of devices attached\nemulator-5554 device\n192.168.1.2:5555 device\nadb-phone._adb-tls-connect._tcp device\n").unwrap().is_empty());
    }
    #[test]
    fn rejects_malformed_and_duplicate_devices() {
        for output in [
            "unexpected output",
            "List of devices attached\nONE mystery",
            "List of devices attached\nONE device\nONE offline",
            "List of devices attached\n$(cmd) device",
        ] {
            assert!(parse_devices(output).is_err());
        }
    }
    #[test]
    fn rejects_multiline_properties() {
        assert!(clean_property("one\ntwo").is_none());
        assert!(clean_property("").is_none());
        assert_eq!(clean_property(" 16\n"), Some("16".to_owned()));
    }
    #[tokio::test]
    async fn missing_bundle_never_falls_back_to_path() {
        let adb = Adb {
            path: PathBuf::from("/nonexistent/droid-setup/adb"),
        };
        assert_eq!(adb.scan(None).await.err().unwrap().code, "missing-tools");
    }
    #[test]
    fn permission_placeholders_are_visible_but_not_targetable() {
        let devices =
            parse_devices("List of devices attached\n???????????? no permissions (udev rules)\n")
                .unwrap();
        assert_eq!(devices[0].state, "no-permissions");
        assert!(!devices[0].usb);
    }

    // Serialize executable-fixture creation/spawn. Docker overlayfs can return
    // ETXTBSY when parallel tests inherit another fixture's writable descriptor.
    #[cfg(unix)]
    static FAKE_PROCESS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[cfg(unix)]
    struct Fixture {
        directory: PathBuf,
    }
    #[cfg(unix)]
    impl Fixture {
        fn new(script: &str) -> Self {
            use std::os::unix::fs::PermissionsExt;
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "droid-setup-adb-test-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir(&directory).unwrap();
            let file = directory.join("adb");
            std::fs::write(&file, format!("#!/bin/sh\n[ \"$1\" = '-L' ] && [ \"$2\" = 'tcp:localhost:5038' ] || exit 91\nshift 2\n{script}\n")).unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self { directory }
        }
        fn client(&self) -> Adb {
            Adb {
                path: self.directory.join("adb"),
            }
        }
    }
    #[cfg(unix)]
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }

    #[cfg(unix)]
    const FAKE: &str = r#"
case "$*" in
  version) printf 'Android Debug Bridge version 1.0.41\nVersion test\n' ;;
  'devices -l') printf 'List of devices attached\nUSB01 device model:Galaxy_A06\n' ;;
  '-s USB01 get-devpath') printf 'usb:1-2\n' ;;
  '-d get-serialno') printf 'USB01\n' ;;
  '-s USB01 shell getprop ro.product.model') printf 'Galaxy A06\n' ;;
  '-s USB01 shell getprop ro.product.manufacturer') printf 'Samsung\n' ;;
  '-s USB01 shell getprop ro.build.version.release') printf '16\n' ;;
  *) exit 92 ;;
esac
"#;

    #[cfg(unix)]
    #[tokio::test]
    async fn verifies_usb_and_reads_only_selected_metadata() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        let fixture = Fixture::new(FAKE);
        let scan = fixture.client().scan(None).await.unwrap();
        assert!(scan.devices[0].usb);
        assert_eq!(scan.devices[0].android_version.as_deref(), Some("16"));
        assert_eq!(scan.inspected_serial.as_deref(), Some("USB01"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn supports_windows_fallback_for_unknown_and_failed_devpath() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        for replacement in ["printf 'unknown\\n'", "exit 1"] {
            let fixture = Fixture::new(&FAKE.replace("printf 'usb:1-2\\n'", replacement));
            assert!(fixture.client().scan(None).await.unwrap().devices[0].usb);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_unverified_transport_and_never_reads_its_properties() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        let script = FAKE
            .replace("printf 'usb:1-2\\n'", "printf 'unknown\\n'")
            .replace("printf 'USB01\\n'", "printf 'OTHER\\n'")
            .replace("printf 'Galaxy A06\\n'", "exit 92");
        let fixture = Fixture::new(&script);
        let scan = fixture.client().scan(None).await.unwrap();
        assert!(!scan.devices[0].usb);
        assert!(scan.devices[0].android_version.is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn times_out_a_hung_process() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        let fixture = Fixture::new("exec sleep 10");
        assert_eq!(
            fixture.client().scan(None).await.err().unwrap().code,
            "timeout"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_metadata_when_phone_disappears_mid_scan() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        let script = FAKE.replace("printf 'List of devices attached\\nUSB01 device model:Galaxy_A06\\n'", r#"
          marker="$(dirname "$0")/inventory-read"
          if [ -e "$marker" ]; then printf 'List of devices attached\n';
          else touch "$marker"; printf 'List of devices attached\nUSB01 device model:Galaxy_A06\n'; fi
        "#);
        let fixture = Fixture::new(&script);
        assert_eq!(
            fixture.client().scan(None).await.err().unwrap().code,
            "error"
        );
    }

    #[test]
    fn validates_optional_imei_without_guessing() {
        assert_eq!(
            clean_imei("490154203237518\n"),
            Some("490154203237518".into())
        );
        for value in [
            "000000000000000",
            "490154203237519",
            "masked",
            "490154203237518,490154203237518",
        ] {
            assert!(clean_imei(value).is_none());
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn blocks_identifier_reader_for_unsupported_brands_before_loading_or_uploading_helper() {
        let _guard = FAKE_PROCESS_LOCK.lock().await;
        let fixture = Fixture::new(&FAKE.replace("printf 'Samsung\\n'", "printf 'Motorola\\n'"));
        let client = fixture.client();
        let error = crate::identity::read(
            &client,
            "USB01",
            std::path::Path::new("/not-present/DroidUi.dex"),
        )
        .await
        .err()
        .unwrap();
        assert_eq!(error.code, "unsupported-device");
    }
}
