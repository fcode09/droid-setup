#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Apply before Tauri creates threads or WebKit processes. WebKitGTK's DMABUF
    // path produced duplicated/noisy surfaces on the tested EndeavourOS Wayland
    // desktop. Keep the compatibility setting local to this application and
    // preserve explicit overrides (set it to 0 to test the native renderer).
    #[cfg(target_os = "linux")]
    if (std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some())
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    droid_setup_lib::run();
}
