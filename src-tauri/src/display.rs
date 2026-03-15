use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

/// Information about a connected display monitor.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f64,
}

/// List all available monitors with their position and resolution.
#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let primary = window.primary_monitor().ok().flatten();
    let primary_pos = primary
        .as_ref()
        .map(|m| (m.position().x, m.position().y));

    let result = monitors
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary_pos
                .map(|(px, py)| px == pos.x && py == pos.y)
                .unwrap_or(false);
            MonitorInfo {
                name: m.name().map_or("Unknown", |v| v).to_string(),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                is_primary,
                scale_factor: m.scale_factor(),
            }
        })
        .collect();

    Ok(result)
}

/// Open (or reposition) the secondary display window on the target monitor.
/// The window is created borderless and maximized to fill the chosen monitor.
#[tauri::command]
pub async fn open_display_window(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    // If the camera window already exists, reposition and refocus it
    if let Some(window) = app.get_webview_window("camera") {
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.maximize();
        let _ = window.set_focus();
        log::info!("[Display] Camera window repositioned to ({}, {})", x, y);
        return Ok(());
    }

    let url = WebviewUrl::App("/".into());
    let window = WebviewWindowBuilder::new(&app, "camera", url)
        .title("Bonio Booth - Display")
        .inner_size(width as f64, height as f64)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Position on the correct monitor, then maximize to fill it
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.maximize();

    log::info!(
        "[Display] Camera window opened at ({}, {}), {}x{}",
        x,
        y,
        width,
        height
    );
    Ok(())
}

/// Close the secondary display window if it exists.
#[tauri::command]
pub fn close_display_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("camera") {
        window.close().map_err(|e| e.to_string())?;
        log::info!("[Display] Camera window closed");
    }
    Ok(())
}

/// Move the main (interactive) window to a target monitor position and maximize it.
/// Called when the user re-assigns which monitor is the interactive one.
#[tauri::command]
pub fn move_main_window(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.maximize();
    log::info!("[Display] Main window moved to ({}, {})", x, y);
    Ok(())
}
