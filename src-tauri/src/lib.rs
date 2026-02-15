mod api;
mod image_processing;
mod printer;
mod sse;
mod video;

use api::AppState;
use sse::SseClient;
use std::sync::Mutex;
use tauri::Manager;

/// Connect SSE from the Rust backend. The backend maintains the persistent
/// HTTP connection. When disconnected (app close/crash), the server detects it
/// and sends a Telegram notification automatically.
#[tauri::command]
fn connect_sse(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    sse_client: tauri::State<'_, Mutex<SseClient>>,
) {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    if machine_id.is_empty() {
        return;
    }
    let client = sse_client.lock().unwrap();
    client.connect(app, machine_id, machine_port);
}

#[tauri::command]
fn destroy_sse(sse_client: tauri::State<'_, Mutex<SseClient>>) {
    let client = sse_client.lock().unwrap();
    client.destroy();
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, sse_client: tauri::State<'_, Mutex<SseClient>>) {
    // Destroy SSE - the backend will detect the drop and send Telegram notification
    {
        let client = sse_client.lock().unwrap();
        client.destroy();
    }
    // Small delay to ensure TCP FIN is sent
    std::thread::sleep(std::time::Duration::from_millis(200));
    app.exit(0);
}

#[tauri::command]
fn get_app_dir(app: tauri::AppHandle) -> Result<String, String> {
    // 1. Try resource_dir (Tauri 2 NSIS: {install_dir}\_up_\)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let filters_dir = resource_dir.join("filters");
        if filters_dir.exists() {
            return Ok(filters_dir.to_string_lossy().to_string());
        }
    }

    // 2. Try relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // 2a. Same dir as exe (portable)
            let filters_dir = exe_dir.join("filters");
            if filters_dir.exists() {
                return Ok(filters_dir.to_string_lossy().to_string());
            }
            // 2b. _up_/filters (NSIS installed)
            let filters_dir = exe_dir.join("_up_").join("filters");
            if filters_dir.exists() {
                return Ok(filters_dir.to_string_lossy().to_string());
            }
            // 2c. Dev mode: exe is at src-tauri/target/debug/bonio-booth.exe
            //     filters is at project_root/filters (4 levels up)
            let mut dir = exe_dir.to_path_buf();
            for _ in 0..5 {
                let filters_dir = dir.join("filters");
                if filters_dir.exists() {
                    return Ok(filters_dir.to_string_lossy().to_string());
                }
                if let Some(parent) = dir.parent() {
                    dir = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }

    // 3. Current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let filters_dir = cwd.join("filters");
        if filters_dir.exists() {
            return Ok(filters_dir.to_string_lossy().to_string());
        }
    }

    Err("Filters directory not found".to_string())
}

/// Resolve LUT file path: takes a .cube filename and returns its absolute path
#[tauri::command]
fn resolve_lut_path(app: tauri::AppHandle, lut_file: String) -> Result<String, String> {
    if lut_file.is_empty() {
        return Ok(String::new());
    }
    let filters_dir = get_app_dir(app)?;
    let lut_path = std::path::Path::new(&filters_dir).join(&lut_file);
    if lut_path.exists() {
        Ok(lut_path.to_string_lossy().to_string())
    } else {
        Err(format!("LUT file not found: {}", lut_path.display()))
    }
}

/// Debug command to diagnose path issues in production
#[tauri::command]
fn debug_paths(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let exe_path = std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    
    let filters_resource = resource_dir.join("filters");
    let filters_exists = filters_resource.exists();
    
    // List filters dir contents
    let mut filter_files = Vec::new();
    if filters_exists {
        if let Ok(entries) = std::fs::read_dir(&filters_resource) {
            for entry in entries.flatten() {
                filter_files.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    
    // Check ffmpeg
    let ffmpeg_path = crate::video::get_ffmpeg_path_public();
    
    Ok(serde_json::json!({
        "resource_dir": resource_dir.to_string_lossy().to_string(),
        "exe_path": exe_path,
        "cwd": cwd,
        "filters_dir": filters_resource.to_string_lossy().to_string(),
        "filters_exists": filters_exists,
        "filter_files": filter_files,
        "ffmpeg_path": ffmpeg_path,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Open DevTools in debug/release for troubleshooting
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .manage(AppState::new())
        .manage(Mutex::new(SseClient::new()))
        .invoke_handler(tauri::generate_handler![
            // App utilities
            get_app_dir,
            resolve_lut_path,
            debug_paths,
            exit_app,
            connect_sse,
            destroy_sse,
            // API commands
            api::verify_machine,
            api::init_machine,
            api::get_machine_data,
            api::get_theme_data,
            api::get_frames,
            api::create_payment,
            api::check_payment_status,
            api::check_coupon,
            api::use_coupon,
            api::create_photo_session,
            api::create_presign_upload,
            api::upload_to_presigned_url,
            api::confirm_upload,
            api::update_heartbeat,
            api::get_machine_status,
            api::send_device_alert,
            api::send_device_status_report,
            api::send_device_reconnected,
            api::update_paper_level,
            api::reduce_paper_level_api,
            api::set_machine_config,
            api::set_camera_type,
            api::get_camera_type,
            api::set_selected_webcam,
            api::get_selected_webcam,
            api::set_selected_camera_name,
            api::get_selected_camera_name,
            api::set_selected_printer,
            api::get_selected_printer,
            api::set_paper_config,
            api::get_paper_config,
            // Image processing
            image_processing::get_available_filters,
            image_processing::apply_lut_filter,
            image_processing::apply_lut_filter_preview,
            image_processing::compose_frame,
            image_processing::save_temp_image,
            // Printer
            printer::get_printers,
            printer::check_printer_status,
            printer::print_photo,
            printer::print_test_photo,
            printer::list_dslr_cameras,
            printer::reduce_paper_level,
            // Video
            video::check_ffmpeg_available,
            video::ensure_ffmpeg,
            video::save_temp_video,
            video::create_looped_video,
            video::apply_lut_to_video,
            video::convert_video_to_mp4,
            video::process_frame_video,
            video::compose_frame_video,
            video::cleanup_temp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
