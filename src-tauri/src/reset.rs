//! Factory-reset preparation and a Settings handoff. This module never issues a wipe.
use crate::adb::{Adb, Device, Failure};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Evidence {
    NoneReported,
    Detected,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUser {
    pub id: u32,
    pub managed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountGroup {
    pub user_id: u32,
    pub provider: &'static str,
    pub account_type: String,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCheck {
    pub state: Evidence,
    pub complete: bool,
    pub groups: Vec<AccountGroup>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub serial: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub current_user: Option<u32>,
    pub users: Option<Vec<AndroidUser>>,
    pub user_unlocked: Option<bool>,
    pub accounts: AccountCheck,
    pub management: Evidence,
    pub restriction: Evidence,
    pub blockers: Vec<&'static str>,
    pub incomplete_checks: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: String,
    pub inspection: Inspection,
}
struct SavedReview {
    id: String,
    inspection: Inspection,
    created: Instant,
}
#[derive(Default)]
pub struct ResetState(Mutex<Option<SavedReview>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acknowledgments {
    pub serial_confirmation: String,
    pub authorized: bool,
    pub backup_reviewed: bool,
    pub accounts_checked_on_phone: bool,
    pub cloud_sign_out_checked: bool,
    pub data_loss_understood: bool,
    pub manual_review_accepted: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SettingsPage {
    Accounts,
    Reset,
    General,
}

fn user_id(line: &str) -> Option<(u32, u32)> {
    let inside = line.split_once("UserInfo{")?.1.split_once('}')?.0;
    let id = inside.split_once(':')?.0.parse().ok()?;
    let flags = u32::from_str_radix(inside.rsplit_once(':')?.1, 16).ok()?;
    Some((id, flags))
}

pub fn parse_users(output: &str) -> Option<Vec<AndroidUser>> {
    if output.len() > 65_536 {
        return None;
    }
    let mut lines = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    if lines.next() != Some("Users:") {
        return None;
    }
    let mut users = BTreeMap::new();
    for line in lines {
        if !line.starts_with("UserInfo{") {
            return None;
        }
        let (id, flags) = user_id(line)?;
        if users
            .insert(
                id,
                AndroidUser {
                    id,
                    managed: flags & 0x20 != 0,
                },
            )
            .is_some()
        {
            return None;
        }
    }
    if users.is_empty() || users.len() > 64 {
        None
    } else {
        Some(users.into_values().collect())
    }
}

fn provider(account_type: &str) -> &'static str {
    match account_type {
        "com.google" => "google",
        "com.osp.app.signin" | "com.samsung.android.account" => "samsung",
        "com.xiaomi" | "com.xiaomi.account" => "xiaomi",
        _ => "other",
    }
}

pub fn parse_accounts(output: &str, users: Option<&[AndroidUser]>) -> AccountCheck {
    let mut groups = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut current = None;
    let mut valid = output.len() <= 1_048_576;
    if valid {
        for line in output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            if line.starts_with("User UserInfo{") && line.ends_with(':') {
                if let Some((id, _)) = user_id(line) {
                    if !seen.insert(id) {
                        valid = false;
                        break;
                    }
                    current = Some(id);
                    continue;
                }
            }
            let Some((kind, count)) = line.rsplit_once(',') else {
                valid = false;
                break;
            };
            let Some(user) = current else {
                valid = false;
                break;
            };
            let Ok(count) = count.parse::<u32>() else {
                valid = false;
                break;
            };
            if count == 0
                || kind.is_empty()
                || kind.len() > 200
                || kind.chars().any(char::is_control)
            {
                valid = false;
                break;
            }
            let key = (user, kind.to_owned());
            if groups
                .insert(
                    key,
                    AccountGroup {
                        user_id: user,
                        provider: provider(kind),
                        account_type: kind.into(),
                        count,
                    },
                )
                .is_some()
            {
                valid = false;
                break;
            }
            if groups.len() > 256 {
                valid = false;
                break;
            }
        }
    }
    let expected: Option<BTreeSet<_>> = users.map(|list| list.iter().map(|user| user.id).collect());
    let complete = valid && !seen.is_empty() && expected.as_ref() == Some(&seen);
    let groups: Vec<_> = groups.into_values().collect();
    let state = if !groups.is_empty() {
        Evidence::Detected
    } else if complete {
        Evidence::NoneReported
    } else {
        Evidence::Unknown
    };
    AccountCheck {
        state,
        complete,
        groups,
    }
}

pub fn parse_owners(output: &str) -> Evidence {
    if output.trim() == "no owners" {
        return Evidence::NoneReported;
    }
    // Positive owner evidence remains a blocker even if other rows were truncated.
    if output.lines().map(str::trim).any(|row| {
        row.starts_with("User ")
            && row.contains("admin=")
            && (row.contains(",DeviceOwner") || row.contains(",ProfileOwner"))
    }) {
        Evidence::Detected
    } else {
        Evidence::Unknown
    }
}

pub fn parse_restrictions(output: &str, current_user: Option<u32>) -> Evidence {
    if output.len() > 1_048_576 {
        return Evidence::Unknown;
    }
    let Some(target) = current_user else {
        return Evidence::Unknown;
    };
    let mut selected = false;
    let mut user_indent = 0;
    let mut section: Option<(usize, bool)> = None;
    let mut effective_values = Vec::new();
    let mut effective_sections = 0;
    for line in output.lines() {
        let text = line.trim();
        if text.is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if text.starts_with("UserInfo{") {
            selected = user_id(text).is_some_and(|(id, _)| id == target);
            user_indent = indent;
            section = None;
            continue;
        }
        if selected && indent <= user_indent {
            selected = false;
        }
        if section.is_some_and(|(level, _)| indent <= level) {
            section = None;
        }
        let global = text == "Device policy global restrictions:";
        let applicable = global
            || (selected
                && matches!(
                    text,
                    "Restrictions:"
                        | "Device policy restrictions:"
                        | "Device policy local restrictions:"
                        | "Effective restrictions:"
                ));
        if applicable {
            let effective = selected && text == "Effective restrictions:";
            if effective {
                effective_sections += 1;
            }
            section = Some((indent, effective));
            continue;
        }
        if let Some((_, effective)) = section {
            if text
                .split_whitespace()
                .any(|key| key == "no_factory_reset" || key == "no_factory_reset=true")
            {
                return Evidence::Detected;
            }
            if effective {
                effective_values.push(text.to_owned());
            }
        }
    }
    if effective_sections != 1 || effective_values.is_empty() {
        return Evidence::Unknown;
    }
    if effective_values == ["none"] {
        return Evidence::NoneReported;
    }
    if effective_values
        .iter()
        .flat_map(|value| value.split_whitespace())
        .all(|key| {
            key.starts_with("no_") && key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        })
    {
        Evidence::NoneReported
    } else {
        Evidence::Unknown
    }
}

fn complete_inspection(
    device: Device,
    current_user: Option<u32>,
    users: Option<Vec<AndroidUser>>,
    unlocked: Option<bool>,
    accounts: AccountCheck,
    management: Evidence,
    restriction: Evidence,
) -> Inspection {
    let mut blockers = Vec::new();
    let mut incomplete = Vec::new();
    if accounts.state == Evidence::Detected {
        blockers.push("accounts");
    }
    if !accounts.complete {
        incomplete.push("accounts");
    }
    if users
        .as_ref()
        .is_some_and(|list| list.len() != 1 || list.iter().any(|u| u.managed || u.id != 0))
    {
        blockers.push("profiles");
    }
    if users.is_none() {
        incomplete.push("users");
    }
    if current_user.is_some_and(|id| id != 0) {
        blockers.push("owner-user");
    }
    if current_user.is_none() {
        incomplete.push("current-user");
    }
    if unlocked == Some(false) {
        blockers.push("locked-user");
    }
    if unlocked.is_none() {
        incomplete.push("unlocked-user");
    }
    if management == Evidence::Detected {
        blockers.push("management");
    }
    if management == Evidence::Unknown {
        incomplete.push("management");
    }
    if restriction == Evidence::Detected {
        blockers.push("restriction");
    }
    if restriction == Evidence::Unknown {
        incomplete.push("restriction");
    }
    Inspection {
        serial: device.serial,
        manufacturer: device.manufacturer,
        model: device.model,
        current_user,
        users,
        user_unlocked: unlocked,
        accounts,
        management,
        restriction,
        blockers,
        incomplete_checks: incomplete,
    }
}

async fn selected_device(client: &Adb, serial: &str) -> Result<Device, Failure> {
    let scan = client.scan(Some(serial)).await?;
    scan.devices
        .into_iter()
        .find(|d| d.serial == serial && d.state == "device" && d.usb)
        .ok_or_else(|| Failure::new("reset-device-unavailable"))
}
async fn current_user(client: &Adb, serial: &str) -> Option<u32> {
    client
        .run(&["-s", serial, "shell", "am", "get-current-user"])
        .await
        .ok()?
        .trim()
        .parse()
        .ok()
}

pub async fn inspect(client: &Adb, serial: &str) -> Result<Inspection, Failure> {
    let device = selected_device(client, serial).await?;
    let current = current_user(client, serial).await;
    let users = client
        .run(&["-s", serial, "shell", "pm", "list", "users"])
        .await
        .ok()
        .and_then(|s| parse_users(&s));
    // Check-in output contains only account types/counts, never names or tokens.
    let accounts = client
        .run(&["-s", serial, "shell", "dumpsys", "account", "--checkin"])
        .await
        .ok()
        .map(|text| parse_accounts(&text, users.as_deref()))
        .unwrap_or(AccountCheck {
            state: Evidence::Unknown,
            complete: false,
            groups: vec![],
        });
    let management = client
        .run(&["-s", serial, "shell", "dpm", "list-owners"])
        .await
        .ok()
        .map(|s| parse_owners(&s))
        .unwrap_or(Evidence::Unknown);
    let restriction = client
        .run(&["-s", serial, "shell", "dumpsys", "user"])
        .await
        .ok()
        .map(|s| parse_restrictions(&s, current))
        .unwrap_or(Evidence::Unknown);
    let unlocked = if let Some(user) = current {
        client
            .run(&[
                "-s",
                serial,
                "shell",
                "am",
                "get-started-user-state",
                &user.to_string(),
            ])
            .await
            .ok()
            .and_then(|s| match s.trim() {
                "RUNNING_UNLOCKED" => Some(true),
                "RUNNING_LOCKED" | "RUNNING_UNLOCKING" | "BOOTING" | "STOPPING" | "SHUTDOWN" => {
                    Some(false)
                }
                _ => None,
            })
    } else {
        None
    };
    // Inspect a stable physical device/user; never accept a different auto-selected phone.
    selected_device(client, serial).await?;
    if current_user(client, serial).await != current {
        return Err(Failure::new("reset-device-changed"));
    }
    Ok(complete_inspection(
        device,
        current,
        users,
        unlocked,
        accounts,
        management,
        restriction,
    ))
}

impl ResetState {
    pub fn invalidate(&self) {
        if let Ok(mut review) = self.0.lock() {
            *review = None;
        }
    }
    pub fn remember(&self, inspection: Inspection) -> Result<Review, Failure> {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Failure::new("error"))?
            .as_nanos()
            .to_string();
        *self.0.lock().map_err(|_| Failure::new("error"))? = Some(SavedReview {
            id: id.clone(),
            inspection: inspection.clone(),
            created: Instant::now(),
        });
        Ok(Review { id, inspection })
    }
    fn consume(&self, id: &str, serial: &str) -> Result<Inspection, Failure> {
        self.consume_at(id, serial, Instant::now())
    }

    fn consume_at(&self, id: &str, serial: &str, now: Instant) -> Result<Inspection, Failure> {
        let review = self
            .0
            .lock()
            .map_err(|_| Failure::new("error"))?
            .take()
            .ok_or_else(|| Failure::new("reset-review-expired"))?;
        if review.id != id
            || review.inspection.serial != serial
            || now.saturating_duration_since(review.created) > Duration::from_secs(300)
        {
            return Err(Failure::new("reset-review-expired"));
        }
        Ok(review.inspection)
    }
}

fn allowed_component(output: &str) -> bool {
    let lines: Vec<_> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    lines.len() == 1
        && lines[0].starts_with("com.android.settings/")
        && lines[0].split_once('/').is_some_and(|(_, class)| {
            !class.is_empty()
                && class
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._$".contains(&c))
        })
}

async fn open_settings(client: &Adb, serial: &str, action: &str) -> Result<bool, Failure> {
    let resolved = client
        .run(&[
            "-s",
            serial,
            "shell",
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "--components",
            "-a",
            action,
            "-p",
            "com.android.settings",
        ])
        .await;
    if !resolved.as_ref().is_ok_and(|s| allowed_component(s)) {
        return Ok(false);
    }
    let output = client
        .run(&[
            "-s",
            serial,
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            action,
            "-p",
            "com.android.settings",
        ])
        .await;
    let output = match output {
        Ok(output) => output,
        Err(error) if error.code == "timeout" => return Err(error),
        Err(_) => return Ok(false),
    };
    Ok(!output.to_ascii_lowercase().contains("error")
        && output.lines().any(|line| line.trim() == "Status: ok"))
}

pub async fn open_accounts(
    client: &Adb,
    serial: &str,
    state: &ResetState,
) -> Result<SettingsPage, Failure> {
    state.invalidate();
    selected_device(client, serial).await?;
    if open_settings(client, serial, "android.settings.SYNC_SETTINGS").await? {
        return Ok(SettingsPage::Accounts);
    }
    if open_settings(client, serial, "android.settings.SETTINGS").await? {
        return Ok(SettingsPage::General);
    }
    Err(Failure::new("reset-settings-unavailable"))
}

fn validate_acknowledgments(inspection: &Inspection, ack: &Acknowledgments) -> Result<(), Failure> {
    if ack.serial_confirmation != inspection.serial
        || !ack.authorized
        || !ack.backup_reviewed
        || !ack.accounts_checked_on_phone
        || !ack.cloud_sign_out_checked
        || !ack.data_loss_understood
    {
        return Err(Failure::new("reset-confirmation-required"));
    }
    if !inspection.blockers.is_empty() {
        return Err(Failure::new("reset-blocked"));
    }
    if !inspection.incomplete_checks.is_empty() && !ack.manual_review_accepted {
        return Err(Failure::new("reset-manual-review-required"));
    }
    Ok(())
}

pub async fn open_reset(
    client: &Adb,
    serial: &str,
    review_id: &str,
    ack: &Acknowledgments,
    state: &ResetState,
) -> Result<SettingsPage, Failure> {
    let reviewed = state.consume(review_id, serial)?;
    validate_acknowledgments(&reviewed, ack)?;
    let fresh = inspect(client, serial).await?;
    validate_acknowledgments(&fresh, ack)?;
    if fresh != reviewed {
        return Err(Failure::new("reset-device-changed"));
    }
    // This is the exported Settings entry screen, never its confirmation activity.
    if open_settings(client, serial, "com.android.settings.action.FACTORY_RESET").await? {
        return Ok(SettingsPage::Reset);
    }
    if open_settings(client, serial, "android.settings.SETTINGS").await? {
        return Ok(SettingsPage::General);
    }
    Err(Failure::new("reset-settings-unavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn users() -> Vec<AndroidUser> {
        vec![AndroidUser {
            id: 0,
            managed: false,
        }]
    }
    fn device() -> Device {
        Device {
            serial: "USB01".into(),
            state: "device".into(),
            usb: true,
            model: Some("Example".into()),
            manufacturer: Some("ZTE".into()),
            android_version: Some("14".into()),
            imei: None,
        }
    }
    fn clear() -> Inspection {
        complete_inspection(
            device(),
            Some(0),
            Some(users()),
            Some(true),
            parse_accounts("User UserInfo{0:Owner:13}:\n", Some(&users())),
            Evidence::NoneReported,
            Evidence::NoneReported,
        )
    }
    fn ack() -> Acknowledgments {
        Acknowledgments {
            serial_confirmation: "USB01".into(),
            authorized: true,
            backup_reviewed: true,
            accounts_checked_on_phone: true,
            cloud_sign_out_checked: true,
            data_loss_understood: true,
            manual_review_accepted: false,
        }
    }
    #[test]
    fn detects_all_account_types_without_account_names() {
        let result=parse_accounts("User UserInfo{0:Owner:4c13}:\n  com.google,3\n  com.osp.app.signin,1\n  com.xiaomi,1\n  com.example.cloud,1\n",Some(&users()));
        assert_eq!(result.state, Evidence::Detected);
        assert!(result.complete);
        assert_eq!(result.groups.len(), 4);
        assert!(result.groups.iter().any(|group| group.provider == "other"));
    }
    #[test]
    fn requires_complete_user_coverage_and_recognized_rows() {
        for output in [
            "",
            "Permission Denial",
            "User UserInfo{0:Owner:13}:\nunknown output",
            "User UserInfo{0:Owner:13}:\ncom.google,0",
            "User UserInfo{1:Other:13}:\n",
            "User UserInfo{0:Owner:13}:\nUser UserInfo{0:Owner:13}:",
        ] {
            assert_eq!(
                parse_accounts(output, Some(&users())).state,
                Evidence::Unknown
            );
        }
        let multiple = vec![
            AndroidUser {
                id: 0,
                managed: false,
            },
            AndroidUser {
                id: 10,
                managed: true,
            },
        ];
        let partial = parse_accounts("User UserInfo{0:Owner:13}:\ncom.google,1", Some(&multiple));
        assert!(!partial.complete);
        assert_eq!(partial.state, Evidence::Detected);
        assert_eq!(
            parse_accounts("User UserInfo{0:Owner:13}:\n", Some(&users())).state,
            Evidence::NoneReported
        );
        assert_eq!(
            parse_accounts("User UserInfo{0:Owner:13}:\n", None).state,
            Evidence::Unknown
        );
    }
    #[test]
    fn preserves_other_user_accounts_and_managed_profiles() {
        let multiple =
            parse_users("Users:\n UserInfo{0:Owner:13} running\n UserInfo{10:Work:1030} running\n")
                .unwrap();
        assert!(multiple[1].managed);
        let result = parse_accounts(
            "User UserInfo{0:Owner:13}:\nUser UserInfo{10:Work:1030}:\ncom.google,1",
            Some(&multiple),
        );
        assert_eq!(result.groups[0].user_id, 10);
        assert_eq!(result.state, Evidence::Detected);
        assert!(parse_users("Users:\nunknown").is_none());
    }
    #[test]
    fn recognizes_owners_without_treating_unsupported_commands_as_clear() {
        assert_eq!(parse_owners("no owners\n"), Evidence::NoneReported);
        assert_eq!(
            parse_owners("1 owner:\nUser 0: admin=com.example/.Admin,DeviceOwner"),
            Evidence::Detected
        );
        for output in ["", "Unknown command", "Device Owner Type: -1"] {
            assert_eq!(parse_owners(output), Evidence::Unknown);
        }
    }
    #[test]
    fn scopes_effective_restrictions_to_the_selected_user() {
        let text="Users:\n  UserInfo{0:Owner:13}:\n    Effective restrictions:\n      none\n  UserInfo{10:Work:1030}:\n    Effective restrictions:\n      no_factory_reset\n  Guest restrictions:\n    no_factory_reset";
        assert_eq!(parse_restrictions(text, Some(0)), Evidence::NoneReported);
        assert_eq!(parse_restrictions(text, Some(10)), Evidence::Detected);
        assert_eq!(parse_restrictions(text, Some(11)), Evidence::Unknown);
        assert_eq!(
            parse_restrictions(
                "UserInfo{0:Owner:13}:\n  Effective restrictions:\n    null",
                Some(0)
            ),
            Evidence::Unknown
        );
    }
    #[test]
    fn acknowledgments_never_override_known_accounts_or_restrictions() {
        let mut inspection = clear();
        assert!(validate_acknowledgments(&inspection, &ack()).is_ok());
        inspection.blockers.push("accounts");
        let mut acknowledgments = ack();
        acknowledgments.manual_review_accepted = true;
        assert_eq!(
            validate_acknowledgments(&inspection, &acknowledgments)
                .unwrap_err()
                .code,
            "reset-blocked"
        );
        inspection.blockers.clear();
        inspection.incomplete_checks.push("accounts");
        assert_eq!(
            validate_acknowledgments(&inspection, &ack())
                .unwrap_err()
                .code,
            "reset-manual-review-required"
        );
        assert!(validate_acknowledgments(&inspection, &acknowledgments).is_ok());
        acknowledgments.serial_confirmation = "OTHER".into();
        assert_eq!(
            validate_acknowledgments(&inspection, &acknowledgments)
                .unwrap_err()
                .code,
            "reset-confirmation-required"
        );
    }
    #[test]
    fn reviews_are_single_use_and_bound_to_the_selected_serial() {
        let state = ResetState::default();
        let review = state.remember(clear()).unwrap();
        assert!(state.consume(&review.id, "OTHER").is_err());
        assert!(state.consume(&review.id, "USB01").is_err());
        let review = state.remember(clear()).unwrap();
        state.invalidate();
        assert!(state.consume(&review.id, "USB01").is_err());
    }
    #[test]
    fn settings_resolution_rejects_unrelated_or_ambiguous_handlers() {
        assert!(allowed_component(
            "com.android.settings/.Settings$MainClearActivity\n"
        ));
        for output in [
            "No activity found",
            "com.other/.FactoryReset",
            "com.android.settings/",
            "com.android.settings/.One\ncom.android.settings/.Two",
        ] {
            assert!(!allowed_component(output));
        }
    }
    #[test]
    fn positive_owner_and_restriction_evidence_cannot_be_overridden_as_unknown() {
        assert_eq!(
            parse_owners("2 owners:\nUser 0: admin=com.example/.Admin,DeviceOwner"),
            Evidence::Detected
        );
        for heading in [
            "Restrictions:",
            "Device policy local restrictions:",
            "Device policy global restrictions:",
        ] {
            let dump=format!("Users:\n  UserInfo{{0:Owner:13}}:\n    {heading}\n      no_factory_reset\n    Effective restrictions:\n      null");
            assert_eq!(parse_restrictions(&dump, Some(0)), Evidence::Detected);
        }
        let report = complete_inspection(
            device(),
            Some(0),
            Some(vec![AndroidUser {
                id: 10,
                managed: false,
            }]),
            Some(true),
            AccountCheck {
                state: Evidence::NoneReported,
                complete: true,
                groups: vec![],
            },
            Evidence::NoneReported,
            Evidence::NoneReported,
        );
        assert!(report.blockers.contains(&"profiles"));
    }

    #[cfg(unix)]
    fn fixture() -> crate::adb::tests::Fixture {
        let extra = r#"
  '-s USB01 shell am get-current-user') printf '0\n' ;;
  '-s USB01 shell pm list users') printf 'Users:\n UserInfo{0:Owner:13} running\n' ;;
  '-s USB01 shell dumpsys account --checkin') printf 'User UserInfo{0:Owner:13}:\n'; cat "$(dirname "$0")/accounts" ;;
  '-s USB01 shell dpm list-owners') printf 'no owners\n' ;;
  '-s USB01 shell dumpsys user') printf 'Users:\n  UserInfo{0:Owner:13}:\n    Effective restrictions:\n      none\n' ;;
  '-s USB01 shell am get-started-user-state 0') printf 'RUNNING_UNLOCKED\n' ;;
  '-s USB01 shell cmd package resolve-activity --brief --components -a com.android.settings.action.FACTORY_RESET -p com.android.settings') printf 'com.android.settings/.Settings$MainClearActivity\n' ;;
  '-s USB01 shell cmd package resolve-activity --brief --components -a android.settings.SYNC_SETTINGS -p com.android.settings') printf 'com.android.settings/.Settings$AccountDashboardActivity\n' ;;
  '-s USB01 shell cmd package resolve-activity --brief --components -a android.settings.SETTINGS -p com.android.settings') printf 'com.android.settings/.Settings\n' ;;
  '-s USB01 shell am start -W -a com.android.settings.action.FACTORY_RESET -p com.android.settings') if [ -f "$(dirname "$0")/deny-reset-entry" ]; then exit 1; fi; printf 'Status: ok\n' ;;
  '-s USB01 shell am start -W -a android.settings.SYNC_SETTINGS -p com.android.settings') printf 'Status: ok\n' ;;
  '-s USB01 shell am start -W -a android.settings.SETTINGS -p com.android.settings') printf 'Status: ok\n' ;;
  *) exit 92 ;;
"#;
        let script = crate::adb::tests::FAKE
            .replace("  *) exit 92 ;;", extra)
            .replace(
                "case \"$*\" in",
                "printf '%s\\n' \"$*\" >> \"$(dirname \"$0\")/calls\"\ncase \"$*\" in",
            );
        let fixture = crate::adb::tests::Fixture::new(&script);
        std::fs::write(fixture.directory.join("accounts"), "").unwrap();
        fixture
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn known_accounts_and_fresh_changes_prevent_settings_handoff() {
        let _guard = crate::adb::tests::FAKE_PROCESS_LOCK.lock().await;
        let fixture = fixture();
        let client = fixture.client();
        let state = ResetState::default();
        let review = state
            .remember(inspect(&client, "USB01").await.unwrap())
            .unwrap();
        std::fs::write(fixture.directory.join("accounts"), "com.google,1\n").unwrap();
        assert_eq!(
            open_reset(&client, "USB01", &review.id, &ack(), &state)
                .await
                .unwrap_err()
                .code,
            "reset-blocked"
        );
        let calls = std::fs::read_to_string(fixture.directory.join("calls")).unwrap();
        assert!(!calls.contains("am start"));
        assert!(!calls.contains("broadcast"));
        assert!(!calls.contains("recovery"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn handoff_opens_only_settings_and_falls_back_when_oem_denies_reset_entry() {
        let _guard = crate::adb::tests::FAKE_PROCESS_LOCK.lock().await;
        let fixture = fixture();
        let client = fixture.client();
        let state = ResetState::default();
        let review = state
            .remember(inspect(&client, "USB01").await.unwrap())
            .unwrap();
        assert_eq!(
            open_reset(&client, "USB01", &review.id, &ack(), &state)
                .await
                .unwrap(),
            SettingsPage::Reset
        );
        std::fs::write(fixture.directory.join("deny-reset-entry"), "").unwrap();
        let review = state
            .remember(inspect(&client, "USB01").await.unwrap())
            .unwrap();
        assert_eq!(
            open_reset(&client, "USB01", &review.id, &ack(), &state)
                .await
                .unwrap(),
            SettingsPage::General
        );
        let calls = std::fs::read_to_string(fixture.directory.join("calls")).unwrap();
        assert!(!calls.contains("MASTER_CLEAR"));
        assert!(!calls.contains("broadcast"));
        assert!(!calls.contains("wipe"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opening_accounts_invalidates_prior_review_and_wrong_target_is_rejected() {
        let _guard = crate::adb::tests::FAKE_PROCESS_LOCK.lock().await;
        let fixture = fixture();
        let client = fixture.client();
        let state = ResetState::default();
        let review = state
            .remember(inspect(&client, "USB01").await.unwrap())
            .unwrap();
        assert_eq!(
            open_accounts(&client, "USB01", &state).await.unwrap(),
            SettingsPage::Accounts
        );
        assert_eq!(
            open_reset(&client, "USB01", &review.id, &ack(), &state)
                .await
                .unwrap_err()
                .code,
            "reset-review-expired"
        );
        assert_eq!(
            inspect(&client, "MISSING").await.unwrap_err().code,
            "reset-device-unavailable"
        );
    }
    #[test]
    fn custom_account_types_remain_blockers_and_old_reviews_expire() {
        let accounts = parse_accounts(
            "User UserInfo{0:Owner:13}:\nVendor Cloud Account,1",
            Some(&users()),
        );
        assert_eq!(accounts.state, Evidence::Detected);
        assert_eq!(accounts.groups[0].provider, "other");
        let state = ResetState::default();
        let review = state.remember(clear()).unwrap();
        let future = Instant::now() + Duration::from_secs(301);
        assert_eq!(
            state
                .consume_at(&review.id, "USB01", future)
                .unwrap_err()
                .code,
            "reset-review-expired"
        );
    }
}
