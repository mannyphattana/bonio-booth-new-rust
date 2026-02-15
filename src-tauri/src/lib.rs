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
fn disconnect_sse(sse_client: tauri::State<'_, Mutex<SseClient>>) {
    let client = sse_client.lock().unwrap();
    client.disconnect();
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, sse_client: tauri::State<'_, Mutex<SseClient>>) {
    // Disconnect SSE - the backend will detect the drop and send Telegram notification
    {
        let client = sse_client.lock().unwrap();
        client.disconnect();
    }
    // Small delay to ensure TCP FIN is sent
    std::thread::sleep(std::time::Duration::from_millis(200));
    app.exit(0);
}

#[tauri::command]
fn get_app_dir(app: tauri::AppHandle) -> Result<String, String> {
    // Try to get the resource directory (where the exe is)
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let filters_dir = resource_dir.join("filters");
    if filters_dir.exists() {
        return Ok(filters_dir.to_string_lossy().to_string());
    }

    // Fallback: look relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let filters_dir = exe_dir.join("filters");
            if filters_dir.exists() {
                return Ok(filters_dir.to_string_lossy().to_string());
            }
            // Try parent directories (for dev mode)
            if let Some(parent) = exe_dir.parent() {
                if let Some(grandparent) = parent.parent() {
                    if let Some(ggparent) = grandparent.parent() {
                        let filters_dir = ggparent.join("filters");
                        if filters_dir.exists() {
                            return Ok(filters_dir.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    // Final fallback: current working directory
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::new())
        .manage(Mutex::new(SseClient::new()))
        .invoke_handler(tauri::generate_handler![
            // App utilities
            get_app_dir,
            resolve_lut_path,
            exit_app,
            connect_sse,
            disconnect_sse,
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
