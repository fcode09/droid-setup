mod adb;
mod identity;
mod reset;
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use tauri::Manager;

#[derive(Default)]
struct ScanLock(tokio::sync::Mutex<()>);

fn tools_directory(app: &tauri::AppHandle) -> Result<PathBuf, adb::Failure> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/adb"))
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .map(|p| p.join("adb"))
            .map_err(|_| adb::Failure::new("missing-tools"))
    }
}

#[tauri::command]
async fn scan_devices(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScanLock>,
    selected_serial: Option<String>,
) -> Result<adb::Scan, adb::Failure> {
    let _guard = state.0.try_lock().map_err(|_| adb::Failure::new("busy"))?;
    let executable = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    let client = adb::Adb {
        path: tools_directory(&app)?.join(executable),
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client.scan(selected_serial.as_deref()),
    )
    .await
    .map_err(|_| adb::Failure::new("timeout"))?
}

#[tauri::command]
fn read_notices(app: tauri::AppHandle) -> Result<String, adb::Failure> {
    std::fs::read_to_string(tools_directory(&app)?.join("NOTICE.txt"))
        .map_err(|_| adb::Failure::new("missing-tools"))
}

#[tauri::command]
async fn read_identifiers(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScanLock>,
    serial: String,
) -> Result<identity::Identifiers, adb::Failure> {
    let _guard = state.0.try_lock().map_err(|_| adb::Failure::new("busy"))?;
    let tools = tools_directory(&app)?;
    let executable = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    let client = adb::Adb {
        path: tools.join(executable),
    };
    let dex = tools
        .parent()
        .ok_or_else(|| adb::Failure::new("missing-tools"))?
        .join("helper/DroidUi.dex");
    identity::read(&client, &serial, &dex).await
}

fn adb_client(app: &tauri::AppHandle) -> Result<adb::Adb, adb::Failure> {
    let executable = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    Ok(adb::Adb {
        path: tools_directory(app)?.join(executable),
    })
}
#[tauri::command]
async fn inspect_reset_device(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ScanLock>,
    state: tauri::State<'_, reset::ResetState>,
    serial: String,
) -> Result<reset::Review, adb::Failure> {
    let _guard = lock.0.try_lock().map_err(|_| adb::Failure::new("busy"))?;
    state.invalidate();
    let client = adb_client(&app)?;
    let inspection = tokio::time::timeout(
        std::time::Duration::from_secs(45),
        reset::inspect(&client, &serial),
    )
    .await
    .map_err(|_| adb::Failure::new("timeout"))??;
    state.remember(inspection)
}
#[tauri::command]
async fn open_reset_accounts(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ScanLock>,
    state: tauri::State<'_, reset::ResetState>,
    serial: String,
) -> Result<reset::SettingsPage, adb::Failure> {
    let _guard = lock.0.try_lock().map_err(|_| adb::Failure::new("busy"))?;
    reset::open_accounts(&adb_client(&app)?, &serial, &state).await
}
#[tauri::command]
async fn open_factory_reset_settings(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ScanLock>,
    state: tauri::State<'_, reset::ResetState>,
    serial: String,
    review_id: String,
    acknowledgments: reset::Acknowledgments,
) -> Result<reset::SettingsPage, adb::Failure> {
    let _guard = lock.0.try_lock().map_err(|_| adb::Failure::new("busy"))?;
    let client = adb_client(&app)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(55),
        reset::open_reset(&client, &serial, &review_id, &acknowledgments, &state),
    )
    .await
    .map_err(|_| adb::Failure::new("timeout"))?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(ScanLock::default())
        .manage(reset::ResetState::default())
        .invoke_handler(tauri::generate_handler![
            scan_devices,
            read_notices,
            read_identifiers,
            inspect_reset_device,
            open_reset_accounts,
            open_factory_reset_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Droid Setup");
}
