use crate::adb::{Adb, Failure};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identifiers {
    pub imei: Option<String>,
    pub phone_number: Option<String>,
    pub cleanup_pending: bool,
}

fn phone(value: &str) -> Option<String> {
    let clean: String = value
        .chars()
        .filter(|c| !matches!(c, ' ' | '(' | ')' | '-'))
        .collect();
    let digits = clean.strip_prefix('+').unwrap_or(&clean);
    if (6..=15).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit()) {
        Some(clean)
    } else {
        None
    }
}

pub fn parse_identifiers(xml: &str) -> Result<Identifiers, Failure> {
    if xml.len() > 750_000 {
        return Err(Failure::new("ui-unavailable"));
    }
    let doc = roxmltree::Document::parse(xml).map_err(|_| Failure::new("ui-unavailable"))?;
    if doc.root_element().tag_name().name() != "hierarchy" {
        return Err(Failure::new("ui-unavailable"));
    }

    let mut imeis = Vec::new();
    let mut phones = Vec::new();
    for node in doc.descendants().filter(|n| n.attribute("text").is_some()) {
        let text = node.attribute("text").unwrap_or("");
        let label = text.to_lowercase();
        // v0.1 intentionally targets SIM 1; never silently mix two subscriptions.
        if label.contains("sim 2")
            || label.contains("slot 2")
            || label.contains("imei2")
            || label.contains("imei 2")
        {
            continue;
        }
        let inline = text.split_once(':').map(|(_, value)| value.trim());
        // Pair a title with its adjacent sibling in the same row. Never flatten
        // the whole screen and accidentally consume a value from another row.
        let sibling = node
            .next_siblings()
            .skip(1)
            .find(|n| n.is_element())
            .and_then(|n| {
                n.descendants()
                    .filter_map(|child| child.attribute("text"))
                    .find(|value| !value.is_empty())
            });
        // Samsung places title and content in separate child containers of one row.
        // Accept only one explicitly named title and one summary/content in that row.
        let row_value = node
            .ancestors()
            .skip(1)
            .take(3)
            .filter(|row| row.has_tag_name("node"))
            .find_map(|row| {
                let titles = row
                    .descendants()
                    .filter(|n| {
                        n.attribute("id")
                            .is_some_and(|id| id.ends_with(":id/title"))
                    })
                    .count();
                if titles != 1 {
                    return None;
                }
                let values: Vec<_> = row
                    .descendants()
                    .filter(|n| {
                        n.attribute("id").is_some_and(|id| {
                            id.ends_with(":id/summary") || id.ends_with(":id/content")
                        })
                    })
                    .filter_map(|n| n.attribute("text"))
                    .filter(|s| !s.is_empty())
                    .collect();
                if values.len() == 1 {
                    Some(values[0])
                } else {
                    None
                }
            });
        let candidate = inline.or(row_value).or(sibling).unwrap_or("");
        if label.starts_with("imei") {
            if let Some(value) = crate::adb::clean_imei(candidate) {
                if !imeis.contains(&value) {
                    imeis.push(value);
                }
            }
        } else if label.starts_with("phone number")
            || label.starts_with("número de teléfono")
            || label.starts_with("teléfono (ranura de sim 1)")
        {
            if let Some(value) = phone(candidate) {
                if !phones.contains(&value) {
                    phones.push(value);
                }
            }
        }
    }
    Ok(Identifiers {
        imei: if imeis.len() == 1 { imeis.pop() } else { None },
        phone_number: if phones.len() == 1 {
            phones.pop()
        } else {
            None
        },
        cleanup_pending: false,
    })
}

async fn helper(
    client: &Adb,
    serial: &str,
    remote: &str,
    mode: &str,
    started: Instant,
) -> Result<String, Failure> {
    if started.elapsed().as_secs() > 55 {
        return Err(Failure::new("timeout"));
    }
    let output = client
        .run(&[
            "-s",
            serial,
            "shell",
            "env",
            &format!("CLASSPATH={remote}"),
            "app_process",
            "/system/bin",
            "DroidUi",
            mode,
        ])
        .await?;
    // Ignore runtime diagnostics, never accept non-Settings roots or reflection failures.
    let start = output
        .find('<')
        .ok_or_else(|| Failure::new("ui-unavailable"))?;
    let xml = output[start..].trim().to_owned();
    if xml.starts_with("<error") {
        return Err(Failure::new("ui-unavailable"));
    }
    Ok(xml)
}

fn merge(result: &mut Identifiers, next: Identifiers) {
    if result.imei.is_none() {
        result.imei = next.imei;
    }
    if result.phone_number.is_none() {
        result.phone_number = next.phone_number;
    }
}

async fn inspect(client: &Adb, serial: &str, remote: &str) -> Result<Identifiers, Failure> {
    let started = Instant::now();
    client
        .run(&[
            "-s",
            serial,
            "shell",
            "am",
            "start",
            "-a",
            "android.settings.DEVICE_INFO_SETTINGS",
        ])
        .await?;
    let mut result = parse_identifiers(&helper(client, serial, remote, "dump", started).await?)?;
    // The helper can click only fixed information labels in the Settings package.
    if result.phone_number.is_none() {
        let action = helper(client, serial, remote, "phone", started).await?;
        if action.contains("performed=\"true\"") {
            merge(
                &mut result,
                parse_identifiers(&helper(client, serial, remote, "dump", started).await?)?,
            );
            client
                .run(&[
                    "-s",
                    serial,
                    "shell",
                    "am",
                    "start",
                    "-a",
                    "android.settings.DEVICE_INFO_SETTINGS",
                ])
                .await?;
        }
    }
    for _ in 0..5 {
        merge(
            &mut result,
            parse_identifiers(&helper(client, serial, remote, "dump", started).await?)?,
        );
        if result.imei.is_some() && result.phone_number.is_some() {
            break;
        }
        if result.imei.is_none() {
            let action = helper(client, serial, remote, "imei", started).await?;
            if action.contains("performed=\"true\"") {
                merge(
                    &mut result,
                    parse_identifiers(&helper(client, serial, remote, "dump", started).await?)?,
                );
                break;
            }
        }
        let action = helper(client, serial, remote, "scroll", started).await?;
        if !action.contains("performed=\"true\"") {
            break;
        }
    }
    Ok(result)
}

pub async fn read(client: &Adb, serial: &str, dex: &Path) -> Result<Identifiers, Failure> {
    let scan = client.scan(Some(serial)).await?;
    if !scan
        .devices
        .iter()
        .any(|d| d.serial == serial && d.state == "device" && d.usb)
    {
        return Err(Failure::new("error"));
    }
    if !scan
        .devices
        .iter()
        .any(|device| device.serial == serial && crate::adb::is_samsung(device))
    {
        return Err(Failure::new("unsupported-device"));
    }
    let data = std::fs::read(dex).map_err(|_| Failure::new("missing-tools"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../android-helper/manifest.json"))
            .map_err(|_| Failure::new("missing-tools"))?;
    let expected = manifest["files"]["src-tauri/resources/helper/DroidUi.dex"]
        .as_str()
        .ok_or_else(|| Failure::new("missing-tools"))?;
    if format!("{:x}", Sha256::digest(&data)) != expected {
        return Err(Failure::new("missing-tools"));
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Failure::new("error"))?
        .as_nanos();
    let remote = format!(
        "/data/local/tmp/droid-setup-ui-{}-{nonce}.dex",
        std::process::id()
    );
    if let Err(error) = client
        .run(&[
            "-s",
            serial,
            "push",
            dex.to_str().ok_or_else(|| Failure::new("missing-tools"))?,
            &remote,
        ])
        .await
    {
        if client
            .run(&["-s", serial, "shell", "rm", "-f", &remote])
            .await
            .is_err()
        {
            return Err(Failure::new("cleanup-pending"));
        }
        return Err(error);
    }
    let result = inspect(client, serial, &remote).await;
    let cleanup = client
        .run(&["-s", serial, "shell", "rm", "-f", &remote])
        .await;
    match result {
        Ok(mut result) => {
            result.cleanup_pending = cleanup.is_err();
            Ok(result)
        }
        Err(error) => {
            if cleanup.is_err() {
                Err(Failure::new("cleanup-pending"))
            } else {
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_labelled_values_without_guessing_unknown_phone_numbers() {
        let xml = "<hierarchy><node text=\"IMEI (ranura de SIM 1)\"/><node text=\"490154203237518\"/><node text=\"Número de teléfono\"/><node text=\"Desconocido\"/></hierarchy>";
        let values = parse_identifiers(xml).unwrap();
        assert_eq!(values.imei.as_deref(), Some("490154203237518"));
        assert!(values.phone_number.is_none());
    }
    #[test]
    fn reads_phone_number_and_ignores_sim_two() {
        let xml = "<hierarchy><node text=\"Phone number\"/><node text=\"+51 999 123 456\"/><node text=\"IMEI (SIM 2)\"/><node text=\"490154203237518\"/></hierarchy>";
        let values = parse_identifiers(xml).unwrap();
        assert_eq!(values.phone_number.as_deref(), Some("+51999123456"));
        assert!(values.imei.is_none());
    }
    #[test]
    fn rejects_error_roots_and_conflicting_numbers() {
        assert!(parse_identifiers("<error code=\"not-settings\"/>").is_err());
        assert!(parse_identifiers("<hierarchy><node text=\"Phone number\"/><node text=\"123456789\"/><node text=\"Phone number\"/><node text=\"987654321\"/></hierarchy>").unwrap().phone_number.is_none());
    }
    #[test]
    fn does_not_mix_sim_two_or_cross_row_values() {
        for xml in [
            "<hierarchy><node text=\"Phone number (SIM slot 2)\"/><node text=\"123456789\"/></hierarchy>",
            "<hierarchy><node text=\"IMEI (SIM slot 2)\"/><node text=\"490154203237518\"/></hierarchy>",
            "<hierarchy><node><node text=\"IMEI\"/></node><node><node text=\"490154203237518\"/></node></hierarchy>",
        ] { let values=parse_identifiers(xml).unwrap(); assert!(values.imei.is_none()); assert!(values.phone_number.is_none()); }
    }

    #[test]
    fn reads_samsung_title_content_rows_without_crossing_rows() {
        let xml = "<hierarchy><node><node><node text=\"IMEI\" id=\"com.android.settings:id/title\"/></node><node text=\"490154203237518\" id=\"com.android.settings:id/content\"/></node><node><node><node text=\"Número de teléfono\" id=\"com.android.settings:id/title\"/></node><node text=\"+51999123456\" id=\"com.android.settings:id/content\"/></node></hierarchy>";
        let values = parse_identifiers(xml).unwrap();
        assert!(values.imei.is_some());
        assert!(values.phone_number.is_some());
    }
}
