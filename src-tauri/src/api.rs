use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

    Ok(ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() { Some(format!("Status: {}", status)) } else { None },
    })
}

// ============ Device Alert ============

#[tauri::command]
pub async fn send_device_alert(
    state: tauri::State<'_, AppState>,
    device_type: String,
    device_name: String,
    available_devices: Vec<String>,
) -> Result<ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!("{}/api/machines-public/device-alert", API_BASE_URL);

    let res = client
        .post(&url)
        .header("X-Machine-Port", &machine_port)
        .query(&[("machineId", &machine_id)])
        .json(&serde_json::json!({
            "deviceType": device_type,
            "deviceName": device_name,
            "availableDevices": available_devices
        }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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

    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

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
