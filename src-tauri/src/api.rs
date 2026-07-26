use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::Manager;

const API_BASE_URL: &str = "https://api-booth.boniolabs.com";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PaperPositionConfig {
    pub scale: f64,
    pub vertical: f64,
    pub horizontal: f64,
}

impl Default for PaperPositionConfig {
    fn default() -> Self {
        Self {
            scale: 100.0,
            vertical: 0.0,
            horizontal: 0.0,
        }
    }
}

pub struct AppState {
    pub machine_id: Mutex<String>,
    pub machine_port: Mutex<String>,
    pub machine_data: Mutex<Option<Value>>,
    pub theme_data: Mutex<Option<Value>>,
    pub camera_type: Mutex<String>, // "webcam" or "canon"
    pub selected_webcam_id: Mutex<String>,
    pub selected_camera_name: Mutex<String>,
    pub selected_printer: Mutex<String>,
    pub paper_config_portrait: Mutex<PaperPositionConfig>,
    pub paper_config_landscape: Mutex<PaperPositionConfig>,
    pub http_client: Client,
    // Session tracking
    pub session_id: Mutex<String>,
    pub session_started_at: Mutex<String>,
    pub clean_exit: Mutex<bool>, // true = clean exit, false = crash/unexpected
}

impl AppState {
    pub fn new() -> Self {
        Self {
            machine_id: Mutex::new(String::new()),
            machine_port: Mutex::new("44444".to_string()),
            machine_data: Mutex::new(None),
            theme_data: Mutex::new(None),
            camera_type: Mutex::new("webcam".to_string()),
            selected_webcam_id: Mutex::new(String::new()),
            selected_camera_name: Mutex::new(String::new()),
            selected_printer: Mutex::new(String::new()),
            paper_config_portrait: Mutex::new(PaperPositionConfig::default()),
            paper_config_landscape: Mutex::new(PaperPositionConfig::default()),
            http_client: Client::new(),
            session_id: Mutex::new(String::new()),
            session_started_at: Mutex::new(String::new()),
            clean_exit: Mutex::new(false),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiResponse {
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

// ============ Machine Verify & Init ============

#[tauri::command]
pub async fn verify_machine(
    state: tauri::State<'_, AppState>,
    machine_id: String,
) -> Result<ApiResponse, String> {
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/verify", API_BASE_URL);

    let res = client
        .get(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    if status.is_success() {
        // Save machine_id
        *state.machine_id.lock().unwrap() = machine_id;
        Ok(ApiResponse {
            success: true,
            data: Some(body),
            error: None,
        })
    } else {
        Ok(ApiResponse {
            success: false,
            data: Some(body),
            error: Some(format!("Status: {}", status)),
        })
    }
}

#[tauri::command]
pub async fn init_machine(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/init", API_BASE_URL);

    let res = client
        .get(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    // Log response data for debugging
    log::info!("[API] init_machine response: status={}", status);
    if let Some(is_shutdown_ready) = body.get("isShutdownReady") {
        log::info!("[API] init_machine - isShutdownReady: {:?}", is_shutdown_ready);
    }
    if let Some(is_closed_app_ready) = body.get("isClosedAppReady") {
        log::info!("[API] init_machine - isClosedAppReady: {:?}", is_closed_app_ready);
    }
    if let Some(machine) = body.get("machine") {
        if let Some(machine_id) = machine.get("_id") {
            log::info!("[API] init_machine - machine._id: {:?}", machine_id);
        }
    }
    // Log full response body (truncated if too large)
    let body_str = serde_json::to_string(&body).unwrap_or_default();
    if body_str.len() > 1000 {
        log::info!("[API] init_machine - response body (truncated): {}...", &body_str[..1000]);
    } else {
        log::info!("[API] init_machine - response body: {}", body_str);
    }

    if status.is_success() {
        // Cache machine data and theme (theme is at root level)
        if let Some(machine) = body.get("machine") {
            *state.machine_data.lock().unwrap() = Some(machine.clone());
        }
        if let Some(theme) = body.get("theme") {
            *state.theme_data.lock().unwrap() = Some(theme.clone());
        }
        Ok(ApiResponse {
            success: true,
            data: Some(body),
            error: None,
        })
    } else {
        Ok(ApiResponse {
            success: false,
            data: Some(body),
            error: Some(format!("Status: {}", status)),
        })
    }
}

#[tauri::command]
pub async fn get_machine_data(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let data = state.machine_data.lock().unwrap().clone();
    Ok(ApiResponse {
        success: data.is_some(),
        data,
        error: None,
    })
}

#[tauri::command]
pub async fn get_theme_data(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let data = state.theme_data.lock().unwrap().clone();
    Ok(ApiResponse {
        success: data.is_some(),
        data,
        error: None,
    })
}

// ============ Frames ============

#[tauri::command]
pub async fn get_frames(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/frames", API_BASE_URL);

    let res = client
        .get(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Payment ============

#[tauri::command]
pub async fn create_payment(
    state: tauri::State<'_, AppState>,
    amount: f64,
    number_photo: Option<i32>,
    coupon_code_id: Option<String>,
    is_reprint: Option<bool>,
    reprint_from_transaction_id: Option<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/payment/create", API_BASE_URL);

    let mut payload = serde_json::json!({ "amount": amount });
    if let Some(n) = number_photo {
        payload["numberPhoto"] = serde_json::json!(n);
    }
    if let Some(ref cid) = coupon_code_id {
        payload["couponCodeId"] = serde_json::json!(cid);
    }
    if is_reprint == Some(true) {
        payload["isReprint"] = serde_json::json!(true);
    }
    if let Some(ref rid) = reprint_from_transaction_id {
        payload["reprintFromTransactionId"] = serde_json::json!(rid);
    }

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn check_payment_status(
    state: tauri::State<'_, AppState>,
    mch_order_no: String,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/payment/status/{}", API_BASE_URL, mch_order_no);

    let res = client
        .get(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Coupon ============

#[tauri::command]
pub async fn check_coupon(
    state: tauri::State<'_, AppState>,
    code: String,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/coupon/check", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn use_coupon(
    state: tauri::State<'_, AppState>,
    code: String,
    transaction_id: Option<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/coupon/use", API_BASE_URL);

    let mut payload = serde_json::json!({ "code": code });
    if let Some(ref tid) = transaction_id {
        payload["transactionId"] = serde_json::json!(tid);
    }

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Photo Session & Upload ============

#[tauri::command]
pub async fn create_photo_session(
    state: tauri::State<'_, AppState>,
    transaction_id: String,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/photo-session/create", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({ "transactionId": transaction_id }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn create_presign_upload(
    state: tauri::State<'_, AppState>,
    transaction_id: String,
    files: Value,
    transaction_code: Option<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/photo-session/create-presign-upload", API_BASE_URL);

    let mut body = serde_json::json!({
        "transactionId": transaction_id,
        "files": files
    });
    if let Some(code) = &transaction_code {
        body["transactionCode"] = serde_json::json!(code);
    }

    let res = client
        .post(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn upload_to_presigned_url(
    state: tauri::State<'_, AppState>,
    url: String,
    file_path: String,
    content_type: String,
) -> Result<ApiResponse, String> {
    let client = &state.http_client;
    let file_data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("File read error: {}", e))?;

    let res = client
        .put(&url)
        .header("Content-Type", &content_type)
        .header("x-amz-acl", "public-read")
        .body(file_data)
        .send()
        .await
        .map_err(|e| format!("Upload error: {}", e))?;

    let status = res.status();

    Ok(ApiResponse {
        success: status.is_success(),
        data: None,
        error: if !status.is_success() { Some(format!("Upload status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn confirm_upload(
    state: tauri::State<'_, AppState>,
    session_id: String,
    uploaded_files: Value,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!(
        "{}/api/machines-public/photo-session/{}/confirm-upload",
        API_BASE_URL, session_id
    );

    let res = client
        .post(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({ "uploadedFiles": uploaded_files }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Heartbeat & Status ============

/// Notify backend that this machine is going offline (shutdown/exit)
/// This should be called BEFORE disconnecting SSE to ensure immediate Telegram notification.
#[tauri::command]
pub async fn notify_going_offline(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/notify-going-offline", API_BASE_URL);

    log::info!("[API] Notifying backend: going offline (machineId={})", machine_id);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    log::info!("[API] notify-going-offline response: status={}, body={}", status, body);

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

/// Internal helper (non-command) for calling notify-going-offline from Rust shutdown flow.
/// Has an 8-second timeout to avoid blocking shutdown if backend is unreachable.
pub async fn notify_going_offline_internal(machine_id: &str, machine_port: &str) {
    let client = Client::new();
    let url = format!("{}/api/machines-public/notify-going-offline", API_BASE_URL);

    log::info!("[API] notify_going_offline_internal: machineId={}", machine_id);

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        client
            .post(&url)
            .header("X-Machine-Port", machine_port)
            .query(&[("machineId", machine_id)])
            .header("Content-Length", "0")
            .send(),
    )
    .await;

    match result {
        Ok(Ok(res)) => {
            log::info!("[API] notify-going-offline response: {}", res.status());
        }
        Ok(Err(e)) => {
            log::error!("[API] notify-going-offline request failed: {}", e);
        }
        Err(_) => {
            log::warn!("[API] notify-going-offline timed out (8s)");
        }
    }
}

#[tauri::command]
pub async fn get_machine_status(
    state: tauri::State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/status", API_BASE_URL);

    let res = client
        .get(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Error Log ============

#[tauri::command]
pub async fn send_error_log(
    state: tauri::State<'_, AppState>,
    error_type: String,
    error_message: String,
    error_stack: Option<String>,
    severity: Option<String>,
) -> Result<(), String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();

    // ถ้ายังไม่ได้ตั้งค่า machine id ให้ข้ามไปเงียบๆ
    if machine_id.is_empty() {
        return Ok(());
    }

    let client = &state.http_client;
    let url = format!("{}/api/machines-public/error-log", API_BASE_URL);

    let mut payload = serde_json::json!({
        "errorType": error_type,
        "errorMessage": error_message,
        "severity": severity.unwrap_or_else(|| "error".to_string()),
    });

    if let Some(stack) = error_stack {
        payload["errorStack"] = serde_json::Value::String(stack);
    }

    let result = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(res) => {
            if !res.status().is_success() {
                log::warn!("[API] send_error_log: server returned {}", res.status());
            } else {
                log::info!("[API] send_error_log: {} recorded ({})", error_type, res.status());
            }
        }
        Err(e) => {
            // ไม่ crash แอพ แค่ log warning
            log::warn!("[API] send_error_log failed to send: {}", e);
        }
    }

    Ok(())
}

// ============ Device Alert ============

#[tauri::command]
pub async fn send_device_alert(
    state: tauri::State<'_, AppState>,
    device_type: String,
    device_name: String,
    available_devices: Vec<String>,
    device_status: Option<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/device-alert", API_BASE_URL);

    let mut body = serde_json::json!({
        "deviceType": device_type,
        "deviceName": device_name,
        "availableDevices": available_devices
    });
    if let Some(status) = device_status {
        body["deviceStatus"] = serde_json::Value::String(status);
    }

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Device Status Report ============

#[tauri::command]
pub async fn send_device_status_report(
    state: tauri::State<'_, AppState>,
    is_startup: bool,
    camera_configured: bool,
    camera_found: bool,
    camera_device_name: String,
    printer_configured: bool,
    printer_found: bool,
    printer_device_detail: String,
    printer_available_names: Vec<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/device-status-report", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({
            "isStartup": is_startup,
            "camera": {
                "configured": camera_configured,
                "found": camera_found,
                "deviceName": camera_device_name
            },
            "printer": {
                "configured": printer_configured,
                "found": printer_found,
                "deviceDetail": printer_device_detail,
                "availablePrinterNames": printer_available_names
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Device Reconnected ============

#[tauri::command]
pub async fn send_device_reconnected(
    state: tauri::State<'_, AppState>,
    device_type: String,
    device_name: String,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/device-reconnected", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({
            "deviceType": device_type,
            "deviceName": device_name
        }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Paper Level ============

#[tauri::command]
pub async fn update_paper_level(
    state: tauri::State<'_, AppState>,
    paper_level: i32,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/paper-level", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({ "paperLevel": paper_level }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

#[tauri::command]
pub async fn reduce_paper_level_api(
    state: tauri::State<'_, AppState>,
    reduce_by: i32,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/paper-level/reduce", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({ "reduceBy": reduce_by }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let (status, body) = parse_response_body(res).await;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Config ============

#[tauri::command]
pub async fn set_machine_config(
    state: tauri::State<'_, AppState>,
    machine_id: String,
    machine_port: String,
) -> Result<ApiResponse, String> {
    *state.machine_id.lock().unwrap() = machine_id;
    *state.machine_port.lock().unwrap() = machine_port;
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn set_camera_type(
    state: tauri::State<'_, AppState>,
    camera_type: String,
) -> Result<ApiResponse, String> {
    *state.camera_type.lock().unwrap() = camera_type;
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_camera_type(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.camera_type.lock().unwrap().clone())
}

// ============ App Session Log ============

/// เริ่ม session ใหม่ — เรียกจาก frontend ตอน app เปิด
#[tauri::command]
pub async fn init_app_session(
    state: tauri::State<'_, AppState>,
    session_id: String,
    started_at: String,
) -> Result<(), String> {
    *state.session_id.lock().unwrap() = session_id.clone();
    *state.session_started_at.lock().unwrap() = started_at.clone();
    *state.clean_exit.lock().unwrap() = false;
    log::info!("[Session] Initialized: {} at {}", session_id, started_at);
    Ok(())
}

/// ส่ง session log ไปยัง backend — เรียกก่อน exit (clean) หรือตอน crash recovery
pub async fn send_app_session_log_internal(
    machine_id: &str,
    machine_port: &str,
    payload: serde_json::Value,
) {
    let client = Client::new();
    let url = format!("{}/api/machines-public/app-session-log", API_BASE_URL);

    log::info!(
        "[Session] Sending session log to backend (machineId={})",
        machine_id
    );

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client
            .post(&url)
            .header("X-Machine-Port", machine_port)
            .query(&[("machineId", machine_id)])
            .json(&payload)
            .send(),
    )
    .await;

    match result {
        Ok(Ok(res)) => {
            if res.status().is_success() {
                log::info!("[Session] Session log saved successfully");
            } else {
                log::warn!("[Session] Server rejected session log: {}", res.status());
            }
        }
        Ok(Err(e)) => {
            log::error!("[Session] Failed to send session log: {}", e);
        }
        Err(_) => {
            log::warn!("[Session] Session log send timed out (10s)");
        }
    }
}

/// Tauri command version — เรียกจาก frontend ตอน clean exit
#[tauri::command]
pub async fn send_app_session_log(
    state: tauri::State<'_, AppState>,
    session_id: String,
    started_at: String,
    ended_at: String,
    duration_seconds: f64,
    close_reason: String,
    app_version: Option<String>,
    entries: serde_json::Value,
    summary: Option<String>,
) -> Result<(), String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();

    if machine_id.is_empty() {
        log::warn!("[Session] send_app_session_log skipped: machine_id not set");
        return Ok(());
    }

    // Mark as clean exit
    *state.clean_exit.lock().unwrap() = true;

    let payload = serde_json::json!({
        "sessionId": session_id,
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationSeconds": duration_seconds,
        "closeReason": close_reason,
        "appVersion": app_version,
        "entries": entries,
        "summary": summary,
    });

    send_app_session_log_internal(&machine_id, &machine_port, payload).await;
    Ok(())
}

/// ส่ง crash session log จาก Rust (ไม่มี entries — แค่บอกว่า crash)
pub async fn send_crash_session_log_internal(
    machine_id: &str,
    machine_port: &str,
    session_id: &str,
    started_at: &str,
    app_version: Option<&str>,
) {
    let now = chrono_now_iso();
    let payload = serde_json::json!({
        "sessionId": session_id,
        "startedAt": started_at,
        "endedAt": now,
        "closeReason": "crash",
        "appVersion": app_version,
        "entries": [],
        "summary": "App closed unexpectedly (crash or force-quit)",
    });
    send_app_session_log_internal(machine_id, machine_port, payload).await;
}

/// คืน ISO 8601 timestamp ปัจจุบัน (UTC)
fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as RFC 3339 approximation without chrono dependency
    let s = secs;
    let days_since_epoch = s / 86400;
    let time_of_day = s % 86400;
    let hh = time_of_day / 3600;
    let mm = (time_of_day % 3600) / 60;
    let ss = time_of_day % 60;
    // Convert days to date (approximate, good enough for crash log timestamp)
    let (year, month, day) = days_to_date(days_since_epoch);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, hh, mm, ss)
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    // Gregorian calendar calculation from days since 1970-01-01
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ============ Live Log (ขอ log จากเครื่องที่กำลังเปิดอยู่ ผ่าน SSE command) ============

/// คำนวณ date prefix ของวันนี้ เช่น "2026-06-05" (UTC)
fn today_date_prefix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86400;
    let (y, mo, d) = days_to_date(days);
    format!("{:04}-{:02}-{:02}", y, mo, d)
}

/// อ่านไฟล์ log ของวันนี้จาก log directory ของ Tauri
/// (Windows: %APPDATA%\com.boniolabs.booth\logs\bonio-booth_YYYY-MM-DD_HH-MM-SS.log)
/// เลือกไฟล์ที่มีชื่อประกอบด้วยวันที่วันนี้ และใหม่สุด
/// คืน content เป็น String (ตัดเฉพาะ 500KB สุดท้ายเพื่อไม่ให้ request ใหญ่เกินไป)
async fn read_disk_log_file(app: &tauri::AppHandle) -> String {
    let log_dir = match app.path().app_log_dir() {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[LiveLog] Cannot resolve app_log_dir: {}", e);
            return String::new();
        }
    };

    let today = today_date_prefix();
    log::info!("[LiveLog] Looking for today's log files (date={}): {:?}", today, log_dir);

    // หาไฟล์ .log ของวันนี้ใน directory (ชื่อไฟล์ต้องประกอบด้วยวันที่วันนี้)
    let entries = match std::fs::read_dir(&log_dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("[LiveLog] Cannot read log dir {:?}: {}", log_dir, e);
            return String::new();
        }
    };

    let mut log_files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .flatten()
        .filter(|e| {
            let path = e.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            // เลือกเฉพาะไฟล์ .log ที่มีวันที่วันนี้ในชื่อ
            // เช่น "bonio-booth_2026-06-05_22-14-23.log"
            name.ends_with(".log") && name.contains(&today)
        })
        .filter_map(|e| {
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((modified, e.path()))
        })
        .collect();

    log_files.sort_by(|a, b| b.0.cmp(&a.0)); // ล่าสุดก่อน

    if log_files.is_empty() {
        // fallback: ถ้าไม่มีไฟล์วันนี้ (อาจเป็น timezone offset) ให้ใช้ไฟล์ล่าสุดแทน
        log::warn!("[LiveLog] No today's log files found, falling back to latest file");
        let entries2 = match std::fs::read_dir(&log_dir) {
            Ok(e) => e,
            Err(_) => return String::new(),
        };
        let mut fallback: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries2
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "log").unwrap_or(false))
            .filter_map(|e| {
                let modified = e.metadata().ok()?.modified().ok()?;
                Some((modified, e.path()))
            })
            .collect();
        fallback.sort_by(|a, b| b.0.cmp(&a.0));
        if fallback.is_empty() {
            log::info!("[LiveLog] No .log files found at all in {:?}", log_dir);
            return String::new();
        }
        log_files = fallback;
    }

    let latest = &log_files[0].1;
    log::info!("[LiveLog] Reading log file: {:?}", latest);

    let content = match tokio::fs::read(latest).await {
        Ok(bytes) => bytes,
        Err(e) => {
            log::warn!("[LiveLog] Cannot read log file {:?}: {}", latest, e);
            return String::new();
        }
    };

    // ตัดเฉพาะ 500KB สุดท้าย
    const MAX_BYTES: usize = 500 * 1024;
    let slice = if content.len() > MAX_BYTES {
        &content[content.len() - MAX_BYTES..]
    } else {
        &content[..]
    };

    String::from_utf8_lossy(slice).to_string()
}

/// Tauri command — เรียกจาก frontend เมื่อรับ SSE event "request-live-log"
/// ส่ง in-memory log entries + disk log content ไปยัง backend
#[tauri::command]
pub async fn send_live_log(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entries: serde_json::Value,
    summary: Option<String>,
) -> Result<(), String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();

    if machine_id.is_empty() {
        log::warn!("[LiveLog] send_live_log skipped: machine_id not set");
        return Ok(());
    }

    log::info!("[LiveLog] Collecting disk log file...");
    let disk_log_content = read_disk_log_file(&app).await;

    let session_id = state.session_id.lock().unwrap().clone();
    let now = chrono_now_iso();

    let payload = serde_json::json!({
        "sessionId": session_id,
        "requestedAt": now,
        "summary": summary.unwrap_or_default(),
        "memoryEntries": entries,
        "diskLogContent": disk_log_content,
    });

    let client = Client::new();
    let url = format!("{}/api/machines-public/live-log", API_BASE_URL);

    log::info!("[LiveLog] Sending live log snapshot to backend (machineId={})", machine_id);

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client
            .post(&url)
            .header("X-Machine-Port", &machine_port)
            .query(&[("machineId", &machine_id)])
            .json(&payload)
            .send(),
    )
    .await;

    match result {
        Ok(Ok(res)) => {
            if res.status().is_success() {
                log::info!("[LiveLog] Live log snapshot sent successfully");
            } else {
                log::warn!("[LiveLog] Server rejected live log: {}", res.status());
            }
        }
        Ok(Err(e)) => {
            log::error!("[LiveLog] Failed to send live log: {}", e);
        }
        Err(_) => {
            log::warn!("[LiveLog] Live log send timed out (15s)");
        }
    }

    Ok(())
}

/// ส่ง transaction session note ไปยัง backend
#[tauri::command]
pub async fn update_transaction_session_note(
    state: tauri::State<'_, AppState>,
    transaction_code: String,
    session_note: String,
    close_reason: Option<String>,
) -> Result<(), String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();

    if machine_id.is_empty() {
        log::warn!("[Session] update_transaction_session_note skipped: machine_id not set");
        return Ok(());
    }

    let client = &state.http_client;
    let url = format!("{}/api/machines-public/transaction-session-note", API_BASE_URL);

    let mut payload = serde_json::json!({
        "transactionCode": transaction_code,
        "sessionNote": session_note,
    });
    if let Some(reason) = close_reason {
        payload["closeReason"] = serde_json::Value::String(reason);
    }

    let result = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&payload)
        .send()
        .await;

    match result {
        Ok(res) => {
            if res.status().is_success() {
                log::info!("[Session] Transaction {} session note updated", transaction_code);
            } else {
                log::warn!("[Session] update_transaction_session_note server error: {}", res.status());
            }
        }
        Err(e) => {
            log::warn!("[Session] update_transaction_session_note failed: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_selected_webcam(
    state: tauri::State<'_, AppState>,
    webcam_id: String,
) -> Result<ApiResponse, String> {
    *state.selected_webcam_id.lock().unwrap() = webcam_id;
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_selected_webcam(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.selected_webcam_id.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_selected_camera_name(
    state: tauri::State<'_, AppState>,
    camera_name: String,
) -> Result<ApiResponse, String> {
    *state.selected_camera_name.lock().unwrap() = camera_name;
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_selected_camera_name(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.selected_camera_name.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_selected_printer(
    state: tauri::State<'_, AppState>,
    printer_name: String,
) -> Result<ApiResponse, String> {
    *state.selected_printer.lock().unwrap() = printer_name;
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_selected_printer(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.selected_printer.lock().unwrap().clone())
}

#[tauri::command]
pub async fn set_paper_config(
    state: tauri::State<'_, AppState>,
    orientation: String,
    scale: f64,
    vertical: f64,
    horizontal: f64,
) -> Result<ApiResponse, String> {
    let config = PaperPositionConfig {
        scale,
        vertical,
        horizontal,
    };
    if orientation == "landscape" {
        *state.paper_config_landscape.lock().unwrap() = config;
    } else {
        *state.paper_config_portrait.lock().unwrap() = config;
    }
    Ok(ApiResponse {
        success: true,
        data: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_paper_config(
    state: tauri::State<'_, AppState>,
    orientation: String,
) -> Result<Value, String> {
    let config = if orientation == "landscape" {
        state.paper_config_landscape.lock().unwrap().clone()
    } else {
        state.paper_config_portrait.lock().unwrap().clone()
    };
    serde_json::to_value(&config).map_err(|e| e.to_string())
}

/// โหลดรูปจาก URL ทาง Rust (ไม่มี CORS) แล้วบันทึกเป็นไฟล์ชั่วคราว สำหรับปริ้นย้อนหลัง
#[tauri::command]
pub async fn download_image_from_url(
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<String, String> {
    let client = &state.http_client;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    let temp_dir = std::env::temp_dir();
    let path = temp_dir.join("request-image-print.jpg");
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to save image: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

async fn parse_response_body(res: reqwest::Response) -> (reqwest::StatusCode, Value) {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| {
        if text.is_empty() {
            serde_json::json!({ "message": "Empty response from server" })
        } else {
            serde_json::json!({ "message": text })
        }
    });
    (status, body)
}
