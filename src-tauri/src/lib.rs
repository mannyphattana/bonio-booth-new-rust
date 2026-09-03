mod api;
mod canon;
#[cfg(target_os = "windows")]
mod edsdk_sys;
mod image_processing;
mod lut;
mod printer;
mod shutdown;
mod sse;
mod video;

/// สร้างชื่อไฟล์ log พร้อม timestamp เวลา startup
/// เช่น "bonio-booth_2026-06-05_22-14-23"
/// tauri-plugin-log จะเติม ".log" ให้เองอัตโนมัติ
fn startup_log_filename() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Time of day components
    let h = (secs % 86400) / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;

    // Gregorian date from days since 1970-01-01
    let days = secs / 86400;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };

    format!("bonio-booth_{:04}-{:02}-{:02}_{:02}-{:02}-{:02}", y, mo, d, h, m, s)
}

use api::AppState;
use shutdown::ShutdownManager;
use sse::SseClient;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};

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
fn exit_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    sse_client: tauri::State<'_, Mutex<SseClient>>,
) {
    // Mark as clean exit (ป้องกัน crash handler ใน RunEvent ยิง session log ซ้ำ)
    *state.clean_exit.lock().unwrap() = true;

    // Step 1: Notify backend before exit (synchronous block_on for immediate notification)
    {
        let machine_id = state.machine_id.lock().unwrap().clone();
        let machine_port = state.machine_port.lock().unwrap().clone();
        if !machine_id.is_empty() {
            log::info!("[exit_app] Notifying backend: going offline...");
            // Use block_on since we're in a sync context
            let _ = std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    api::notify_going_offline_internal(&machine_id, &machine_port).await;
                });
            })
            .join();
        }
    }
    // Step 2: Destroy SSE connection
    {
        let client = sse_client.lock().unwrap();
        client.destroy();
    }
    // Step 3: Small delay to ensure TCP FIN is sent
    std::thread::sleep(std::time::Duration::from_millis(500));

    #[cfg(target_os = "windows")]
    {
        let _ = canon::canon_terminate();
    }

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

/// สถานะ UAC ของเครื่อง — อ่านอย่างเดียว ไม่ต้องยกสิทธิ์
/// ใช้โชว์ในเมนูแอดมินว่าเครื่องนี้พร้อมอัปเดตอัตโนมัติหรือยัง
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct UacStatus {
    /// 0 = ยกสิทธิ์เงียบ (ที่เราต้องการ), 5 = ถามแบบปกติ
    consent_prompt_behavior_admin: Option<u32>,
    /// 1 = UAC เปิดอยู่ — เราไม่แตะค่านี้เพราะ 0 ทำ WebView2 พัง
    enable_lua: Option<u32>,
    /// account ที่รันแอปอยู่เป็นสมาชิกกลุ่ม Administrators หรือไม่
    /// ถ้าไม่ใช่ การตั้ง consent_prompt_behavior_admin จะไม่ช่วยอะไรเลย
    is_admin_account: bool,
    /// สรุปว่าตอนนี้ยกสิทธิ์ได้เงียบจริงหรือยัง
    silent_elevation: bool,
}

/// อ่านสถานะ UAC โดยไม่ยกสิทธิ์ (ค่าพวกนี้ HKLM อ่านได้ด้วยสิทธิ์ปกติ)
#[cfg(target_os = "windows")]
#[tauri::command]
async fn get_uac_status() -> Result<UacStatus, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // whoami /groups ใช้ /nh + -Header เอง เพราะหัวตารางเปลี่ยนตามภาษา Windows
    // (บูธหลายเครื่องเป็น Windows ภาษาไทย หัวคอลัมน์จะไม่ใช่ "SID")
    // S-1-5-32-544 = BUILTIN\Administrators — token ยังมี SID นี้ติดมาแม้ยังไม่ยกสิทธิ์
    let script = r#"$ErrorActionPreference = 'SilentlyContinue'
$p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$consent = (Get-ItemProperty -Path $p -Name 'ConsentPromptBehaviorAdmin').ConsentPromptBehaviorAdmin
$lua = (Get-ItemProperty -Path $p -Name 'EnableLUA').EnableLUA
$isAdmin = $false
try {
  $g = @(whoami /groups /fo csv /nh | ConvertFrom-Csv -Header 'Name','Type','SID','Attributes')
  $isAdmin = [bool]($g | Where-Object { $_.SID -eq 'S-1-5-32-544' })
} catch { }
[pscustomobject]@{
  consentPromptBehaviorAdmin = $consent
  enableLua = $lua
  isAdminAccount = $isAdmin
} | ConvertTo-Json -Compress"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("read uac status failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json = stdout.trim().trim_start_matches('\u{feff}');
    let parsed: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("parse uac status failed: {} ({})", e, json))?;

    let consent = parsed["consentPromptBehaviorAdmin"].as_u64().map(|v| v as u32);
    let enable_lua = parsed["enableLua"].as_u64().map(|v| v as u32);
    let is_admin_account = parsed["isAdminAccount"].as_bool().unwrap_or(false);

    Ok(UacStatus {
        consent_prompt_behavior_admin: consent,
        enable_lua,
        is_admin_account,
        silent_elevation: is_admin_account && consent == Some(0),
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn get_uac_status() -> Result<UacStatus, String> {
    Ok(UacStatus::default())
}

/// เตรียมเครื่องให้อัปเดตอัตโนมัติได้โดยไม่ต้องมีคนกดอะไรเลย ทำ 2 อย่าง:
///
/// 1. เพิ่ม Windows Defender exclusion ให้ตัวอัปเดตดาวน์โหลด/ติดตั้ง/รีสตาร์ทได้
///    โดยไม่ถูกสแกนกั้นหรือ quarantine ไฟล์ installer
/// 2. ตั้ง `ConsentPromptBehaviorAdmin = 0` ให้ Windows ยกสิทธิ์ admin โดยไม่เด้ง UAC
///    เพราะ NSIS installer ของเราใช้ `RequestExecutionLevel highest` จึงขอสิทธิ์
///    ตั้งแต่ตอนรันไฟล์ setup.exe — ถ้าไม่ตั้งค่านี้ auto update จะค้างรอคนกด Yes
///
/// ต้องสิทธิ์ Administrator จึงยกสิทธิ์ด้วย PowerShell `Start-Process -Verb RunAs`
/// (เด้ง UAC ให้พนักงานกดยอมรับ **ครั้งสุดท้าย**) — ไม่มีการปิด real-time protection
/// และไม่แตะ `EnableLUA` เพราะ `EnableLUA=0` ทำให้ WebView2 (ตัวเรนเดอร์ UI) พัง
///
/// คืนข้อความสรุปว่ารายการไหนทำผ่าน/ไม่ผ่าน เพื่อให้เห็นผลจริงบนหน้าจอ
#[cfg(target_os = "windows")]
#[tauri::command]
async fn prepare_unattended_updates() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_path = std::env::current_exe().map_err(|e| format!("current_exe failed: {}", e))?;
    let exe_name = exe_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Bonio Booth.exe".to_string());
    let install_dir = exe_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "cannot resolve install dir".to_string())?;
    // โฟลเดอร์ผู้ผลิตที่ครอบ install dir (NSIS ติดตั้งเป็น ...\Bonio Booth\)
    let vendor_dir = exe_path
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string());
    // updater ของ Tauri โหลด installer ลง temp ก่อนรัน
    let temp_dir = std::env::temp_dir().to_string_lossy().to_string();

    let mut exclusion_paths = vec![install_dir.clone(), temp_dir.clone()];
    if let Some(vendor) = vendor_dir {
        if vendor != install_dir {
            exclusion_paths.push(vendor);
        }
    }

    let work_dir = std::env::temp_dir().join("bonio-booth");
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("create temp dir failed: {}", e))?;
    let script_path = work_dir.join("whitelist-updater.ps1");
    let result_path = work_dir.join("whitelist-updater-result.txt");
    let _ = std::fs::remove_file(&result_path);

    // PowerShell array literal — escape single quote ตามกฎ PS ('' คือ ' หนึ่งตัว)
    let ps_list = |items: &[String]| -> String {
        items
            .iter()
            .map(|i| format!("'{}'", i.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(",")
    };

    let script = format!(
        r#"$ErrorActionPreference = 'Continue'
$lines = @()
$paths = @({paths})
foreach ($p in $paths) {{
  try {{
    Add-MpPreference -ExclusionPath $p -ErrorAction Stop
    $lines += "OK   path    $p"
  }} catch {{
    $lines += "FAIL path    $p :: $($_.Exception.Message)"
  }}
}}
$procs = @({procs})
foreach ($proc in $procs) {{
  try {{
    Add-MpPreference -ExclusionProcess $proc -ErrorAction Stop
    $lines += "OK   process $proc"
  }} catch {{
    $lines += "FAIL process $proc :: $($_.Exception.Message)"
  }}
}}
# Silent elevation so the NSIS installer never shows a UAC prompt.
# EnableLUA is deliberately left alone: EnableLUA=0 breaks WebView2.
$uacPath ='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
try {{
  New-ItemProperty -Path $uacPath -Name 'ConsentPromptBehaviorAdmin' -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
  $after = (Get-ItemProperty -Path $uacPath -Name 'ConsentPromptBehaviorAdmin' -ErrorAction Stop).ConsentPromptBehaviorAdmin
  if ($after -eq 0) {{
    $lines += "OK   uac     ConsentPromptBehaviorAdmin = 0"
  }} else {{
    $lines += "FAIL uac     wrote 0 but reads back $after (Group Policy may override)"
  }}
}} catch {{
  $lines += "FAIL uac     $($_.Exception.Message)"
}}
$lines | Out-File -FilePath '{result}' -Encoding utf8
"#,
        paths = ps_list(&exclusion_paths),
        procs = ps_list(&[exe_name.clone()]),
        result = result_path.to_string_lossy().replace('\'', "''"),
    );

    std::fs::write(&script_path, script).map_err(|e| format!("write script failed: {}", e))?;

    // ยกสิทธิ์แล้วรอให้เสร็จ ถ้าพนักงานกด "No" ที่ UAC ตัว Start-Process จะ error
    let launcher = format!(
        "Start-Process -FilePath 'powershell' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{}'",
        script_path.to_string_lossy().replace('\'', "''")
    );

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &launcher,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("launch elevated powershell failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let hint = if stderr.contains("canceled") || stderr.contains("cancelled") {
            "ผู้ใช้กดยกเลิก UAC"
        } else {
            "ยกสิทธิ์ Administrator ไม่สำเร็จ"
        };
        log::warn!("[Whitelist] elevation failed: {}", stderr.trim());
        return Err(format!("{} — {}", hint, stderr.trim()));
    }

    let report = std::fs::read_to_string(&result_path)
        .map_err(|e| format!("อ่านผลลัพธ์ไม่ได้ (สคริปต์อาจไม่ได้รัน): {}", e))?;
    // Out-File -Encoding utf8 ของ PowerShell 5.1 ใส่ BOM มาด้วย ซึ่ง trim() ไม่ตัดให้
    // ถ้าไม่ตัดทิ้ง บรรทัดแรกจะขึ้นต้นด้วย \u{feff} ทำให้ starts_with("FAIL") พลาดไปหนึ่งบรรทัด
    let report = report.trim_start_matches('\u{feff}').trim().to_string();
    log::info!("[Whitelist] unattended-update prep result:\n{}", report);

    if report.is_empty() {
        return Err("สคริปต์รันแล้วแต่ไม่มีผลลัพธ์กลับมา".to_string());
    }
    if report.lines().all(|l| l.starts_with("FAIL")) {
        return Err(report);
    }

    Ok(report)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn prepare_unattended_updates() -> Result<String, String> {
    Err("รองรับเฉพาะ Windows".to_string())
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
    // สร้างชื่อไฟล์ log พร้อม timestamp ณ เวลา startup
    // เช่น bonio-booth_2026-06-05_22-14-23.log
    let log_file_name = startup_log_filename();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    // เขียนลงไฟล์ใน log directory ของ OS
                    // (Windows: %APPDATA%\com.boniolabs.booth\logs\bonio-booth_YYYY-MM-DD_HH-MM-SS.log)
                    // ใช้ชื่อไฟล์พร้อม timestamp เพื่อไม่ให้ถูกเขียนทับในแต่ละ session
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir { file_name: Some(log_file_name) },
                    ),
                    // แสดงใน stdout (dev mode / terminal)
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // ส่งไปยัง webview console (dev tools)
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .manage(Mutex::new(SseClient::new()))
        .manage(Arc::new(ShutdownManager::new()))
        .setup(|app| {
            // Open DevTools in debug builds
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Prevent Windows from putting the display to sleep.
            //
            // IMPORTANT: Do NOT use ES_SYSTEM_REQUIRED here.
            // ES_SYSTEM_REQUIRED wakes all USB devices out of selective suspend
            // (including USB-C Alt Mode displays like ViewSonic touchscreens),
            // causing a disconnect/reconnect when the flag is applied on startup
            // and again when the process exits and Windows reverts the state.
            //
            // ES_CONTINUOUS | ES_DISPLAY_REQUIRED is sufficient to keep the
            // display on without touching USB power management at all.
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::System::Power::SetThreadExecutionState;
                use windows::Win32::System::Power::{
                    ES_CONTINUOUS, ES_DISPLAY_REQUIRED,
                };
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
                }
                log::info!("[App] SetThreadExecutionState: display sleep prevented (no ES_SYSTEM_REQUIRED to avoid USB wake)");
            }

            // Borderless maximize: cover the full screen without using exclusive
            // fullscreen mode. Exclusive fullscreen causes the graphics driver to
            // switch display modes, which on Duplicate-mode setups (laptop + external
            // touchscreen) makes the external monitor disconnect/reconnect repeatedly.
            // Instead we just maximize the borderless window (decorations: false in
            // tauri.conf.json) which looks identical to fullscreen but does not
            // trigger a display mode switch.
            {
                let window = app.get_webview_window("main").unwrap();
                let _ = window.maximize();
                log::info!("[App] Window maximized (borderless)");
            }

            // Give shutdown manager an app handle
            if let Some(shutdown_mgr) = app.try_state::<Arc<ShutdownManager>>() {
                shutdown_mgr.set_app_handle(app.handle().clone());
            }

            #[cfg(target_os = "windows")]
            {
                let _ = canon::canon_initialize(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App utilities
            get_app_dir,
            resolve_lut_path,
            debug_paths,
            prepare_unattended_updates,
            get_uac_status,
            exit_app,
            connect_sse,
            destroy_sse,
            // Shutdown management
            shutdown::get_shutdown_state,
            shutdown::start_shutdown_countdown,
            shutdown::cancel_shutdown,
            shutdown::notify_user_activity,
            shutdown::start_transaction,
            shutdown::end_transaction,
            shutdown::execute_shutdown_now,
            shutdown::ensure_shutdown_countdown,
            shutdown::cancel_timer_shutdown,
            // Canon EDSDK
            canon::canon_initialize,
            canon::canon_terminate,
            canon::canon_is_initialized,
            canon::canon_get_camera_list,
            canon::canon_connect,
            canon::canon_open_session,
            canon::canon_close_session,
            canon::canon_is_connected,
            canon::canon_warm_up,
            canon::canon_do_evf_af,
            canon::canon_take_picture,
            canon::canon_send_shutter,
            canon::canon_get_capture_result,
            canon::canon_process_events,
            canon::canon_start_live_view,
            canon::canon_stop_live_view,
            canon::canon_get_live_view_frame,
            canon::canon_get_property,
            canon::canon_set_property,
            canon::canon_get_battery_level,
            canon::canon_get_available_shots,
            canon::canon_start_movie_record,
            canon::canon_stop_movie_record,
            canon::canon_stop_movie_record_fast,
            canon::canon_take_photo_during_recording,
            canon::canon_finalize_movie_download,
            canon::canon_is_movie_recording,
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
            api::notify_going_offline,
            api::get_machine_status,
            api::send_error_log,
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
            api::download_image_from_url,
            // Session log commands
            api::init_app_session,
            api::send_app_session_log,
            api::update_transaction_session_note,
            api::send_live_log,
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
            printer::get_printer_paper_sizes,
            // Video
            video::check_ffmpeg_available,
            video::ensure_ffmpeg,
            video::save_temp_video,
            video::trim_video_keep_last,
            video::create_looped_video,
            video::apply_lut_to_video,
            video::convert_video_to_mp4,
            video::process_frame_video,
            video::compose_frame_video,
            video::cleanup_temp,
            video::save_to_local_drive,
            video::copy_video_to_local_drive,
            video::check_file_exists,
            video::list_saved_transaction_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                RunEvent::WindowEvent {
                    event: WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    // Prevent default close — we'll handle cleanup first
                    api.prevent_close();

                    let app_handle = app.clone();
                    log::info!("[App] Window close requested, notifying backend before exit...");

                    // Run async cleanup in a separate thread
                    std::thread::spawn(move || {
                        let rt = tokio::runtime::Runtime::new().unwrap();
                        rt.block_on(async {
                            // Step 1: Notify backend (going offline) — 8s timeout
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                let machine_id = state.machine_id.lock().unwrap().clone();
                                let machine_port = state.machine_port.lock().unwrap().clone();
                                if !machine_id.is_empty() {
                                    api::notify_going_offline_internal(&machine_id, &machine_port)
                                        .await;

                                    // ถ้ายังไม่ได้ mark clean_exit → หมายความว่าปิดแบบไม่คาดคิด
                                    // ส่ง crash session log (ไม่มี entries)
                                    let is_clean = *state.clean_exit.lock().unwrap();
                                    if !is_clean {
                                        let session_id =
                                            state.session_id.lock().unwrap().clone();
                                        let started_at =
                                            state.session_started_at.lock().unwrap().clone();
                                        if !session_id.is_empty() {
                                            log::warn!(
                                                "[App] Unexpected close detected — sending crash session log for session {}",
                                                session_id
                                            );
                                            api::send_crash_session_log_internal(
                                                &machine_id,
                                                &machine_port,
                                                &session_id,
                                                &started_at,
                                                None,
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }

                            // Step 2: Destroy SSE connection
                            if let Some(sse_client) =
                                app_handle.try_state::<Mutex<SseClient>>()
                            {
                                sse_client.lock().unwrap().destroy();
                            }

                            // Step 3: Small delay for TCP FIN
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        });

                        #[cfg(target_os = "windows")]
                        {
                            let _ = canon::canon_terminate();
                        }

                        // Step 4: Exit
                        app_handle.exit(0);
                    });
                }
                _ => {}
            }
        });
}
