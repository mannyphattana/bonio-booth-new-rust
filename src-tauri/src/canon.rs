//! Canon EDSDK Camera Module for Tauri
//!
//! Provides Tauri commands for Canon DSLR/mirrorless camera control:
//! - SDK init/terminate
//! - Camera discovery & connection
//! - Session management
//! - Photo capture (blocking & non-blocking)
//! - Live View (EVF)
//! - Camera properties (ISO, aperture, shutter speed, etc.)
//! - Event polling

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::os::raw::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(target_os = "windows")]
use crate::edsdk_sys::dynamic::*;
#[cfg(target_os = "windows")]
use crate::edsdk_sys::*;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CameraInfo {
    pub name: String,
    pub port_name: String,
    pub device_sub_type: u32,
    pub body_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaptureResult {
    pub success: bool,
    pub error: Option<String>,
    /// Base64-encoded JPEG image data
    pub image_data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveViewFrame {
    /// Base64-encoded JPEG data
    pub data: String,
}

// =============================================================================
// Global State
// =============================================================================

static SDK_INITIALIZED: AtomicBool = AtomicBool::new(false);
static CAMERA_MANAGER: OnceLock<Arc<Mutex<CameraManager>>> = OnceLock::new();
static CAPTURE_DATA: OnceLock<Arc<Mutex<CaptureData>>> = OnceLock::new();

struct CaptureData {
    image_data: Option<Vec<u8>>,
    capture_complete: bool,
    capture_error: Option<String>,
}

impl Default for CaptureData {
    fn default() -> Self {
        Self {
            image_data: None,
            capture_complete: false,
            capture_error: None,
        }
    }
}

struct CameraManager {
    #[cfg(target_os = "windows")]
    camera_ref: Option<EdsCameraRef>,
    #[cfg(not(target_os = "windows"))]
    camera_ref: Option<*mut c_void>,
    session_open: bool,
    event_handler_registered: bool,
    state_event_handler_registered: bool,
}

impl Default for CameraManager {
    fn default() -> Self {
        Self {
            camera_ref: None,
            session_open: false,
            event_handler_registered: false,
            state_event_handler_registered: false,
        }
    }
}

unsafe impl Send for CameraManager {}
unsafe impl Sync for CameraManager {}

// =============================================================================
// Helper
// =============================================================================

#[cfg(target_os = "windows")]
fn check_error(error: EdsError) -> Result<(), String> {
    if error == EDS_ERR_OK {
        Ok(())
    } else {
        Err(format!(
            "EDSDK error: {} (0x{:08X})",
            error_to_string(error),
            error
        ))
    }
}

/// Resolve EDSDK.dll path — tries multiple locations
fn resolve_dll_path(app: &tauri::AppHandle) -> String {
    // 1. Resource dir (installed via NSIS)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let dll = resource_dir.join("EDSDK").join("Dll").join("EDSDK.dll");
        if dll.exists() {
            return dll.to_string_lossy().to_string();
        }
    }

    // 2. Relative to exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Same dir
            let dll = exe_dir.join("EDSDK").join("Dll").join("EDSDK.dll");
            if dll.exists() {
                return dll.to_string_lossy().to_string();
            }
            // _up_ (NSIS)
            let dll = exe_dir
                .join("_up_")
                .join("EDSDK")
                .join("Dll")
                .join("EDSDK.dll");
            if dll.exists() {
                return dll.to_string_lossy().to_string();
            }
            // Dev mode: walk up
            let mut dir = exe_dir.to_path_buf();
            for _ in 0..5 {
                let dll = dir.join("EDSDK").join("Dll").join("EDSDK.dll");
                if dll.exists() {
                    return dll.to_string_lossy().to_string();
                }
                if let Some(parent) = dir.parent() {
                    dir = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }

    // 3. CWD
    if let Ok(cwd) = std::env::current_dir() {
        let dll = cwd.join("EDSDK").join("Dll").join("EDSDK.dll");
        if dll.exists() {
            return dll.to_string_lossy().to_string();
        }
    }

    // Fallback
    "EDSDK/Dll/EDSDK.dll".to_string()
}

use tauri::Manager;

// =============================================================================
// Event Handlers (Windows only)
// =============================================================================

#[cfg(target_os = "windows")]
unsafe extern "system" fn object_event_handler(
    event: EdsObjectEventID,
    object: EdsBaseRef,
    _context: *mut c_void,
) -> EdsError {
    if event != kEdsObjectEvent_DirItemRequestTransfer {
        return EDS_ERR_OK;
    }

    let dir_item = object as EdsDirectoryItemRef;

    let capture_data = match CAPTURE_DATA.get() {
        Some(cd) => cd,
        None => {
            EdsDownloadCancel(dir_item);
            return EDS_ERR_OK;
        }
    };

    // Get file size
    let mut dir_info: EdsDirectoryItemInfo = std::mem::zeroed();
    let error = EdsGetDirectoryItemInfo(dir_item, &mut dir_info);
    if error != EDS_ERR_OK {
        if let Ok(mut cd) = capture_data.lock() {
            cd.capture_error = Some(format!("Get dir info failed: {}", error_to_string(error)));
            cd.capture_complete = true;
        }
        EdsDownloadCancel(dir_item);
        return EDS_ERR_OK;
    }

    let file_size = dir_info.size;

    // Create memory stream
    let mut stream: EdsStreamRef = ptr::null_mut();
    let error = EdsCreateMemoryStream(file_size, &mut stream);
    if error != EDS_ERR_OK {
        if let Ok(mut cd) = capture_data.lock() {
            cd.capture_error = Some(format!("Create stream failed: {}", error_to_string(error)));
            cd.capture_complete = true;
        }
        EdsDownloadCancel(dir_item);
        return EDS_ERR_OK;
    }

    // Download
    let error = EdsDownload(dir_item, file_size, stream);
    if error != EDS_ERR_OK {
        if let Ok(mut cd) = capture_data.lock() {
            cd.capture_error = Some(format!("Download failed: {}", error_to_string(error)));
            cd.capture_complete = true;
        }
        EdsRelease(stream);
        EdsDownloadCancel(dir_item);
        return EDS_ERR_OK;
    }

    let _ = EdsDownloadComplete(dir_item);

    // Get data pointer
    let mut data_ptr: *mut c_void = ptr::null_mut();
    let error = EdsGetPointer(stream, &mut data_ptr);
    if error != EDS_ERR_OK || data_ptr.is_null() {
        if let Ok(mut cd) = capture_data.lock() {
            cd.capture_error = Some("Get pointer failed".to_string());
            cd.capture_complete = true;
        }
        EdsRelease(stream);
        return EDS_ERR_OK;
    }

    let mut length: EdsUInt64 = 0;
    let error = EdsGetLength(stream, &mut length);
    if error != EDS_ERR_OK || length == 0 {
        if let Ok(mut cd) = capture_data.lock() {
            cd.capture_error = Some("Get length failed".to_string());
            cd.capture_complete = true;
        }
        EdsRelease(stream);
        return EDS_ERR_OK;
    }

    // Copy data
    let data_slice = std::slice::from_raw_parts(data_ptr as *const u8, length as usize);
    let image_data = data_slice.to_vec();

    if let Ok(mut cd) = capture_data.lock() {
        cd.image_data = Some(image_data);
        cd.capture_complete = true;
        cd.capture_error = None;
    }

    EdsRelease(stream);
    EDS_ERR_OK
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn state_event_handler(
    event: EdsStateEventID,
    _parameter: EdsUInt32,
    _context: *mut c_void,
) -> EdsError {
    if event == kEdsStateEvent_Shutdown {
        info!("[Canon] Camera shutdown/disconnect detected");
        if let Some(manager) = CAMERA_MANAGER.get() {
            if let Ok(mut m) = manager.lock() {
                if let Some(camera_ref) = m.camera_ref.take() {
                    let _ = EdsCloseSession(camera_ref);
                    EdsRelease(camera_ref);
                }
                m.session_open = false;
                m.event_handler_registered = false;
                m.state_event_handler_registered = false;
            }
        }
    }
    EDS_ERR_OK
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Initialize the Canon EDSDK
#[tauri::command]
pub fn canon_initialize(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if SDK_INITIALIZED.load(Ordering::SeqCst) {
            info!("[Canon] SDK already initialized");
            return Ok(true);
        }

        let dll_path = resolve_dll_path(&app);
        info!("[Canon] Initializing SDK from: {}", dll_path);

        unsafe {
            load_edsdk(&dll_path).map_err(|e| {
                error!("[Canon] Failed to load EDSDK.dll: {}", e);
                e
            })?;

            let error = EdsInitializeSDK();
            check_error(error).map_err(|e| {
                error!("[Canon] SDK init failed: {}", e);
                e
            })?;
        }

        CAMERA_MANAGER.get_or_init(|| Arc::new(Mutex::new(CameraManager::default())));
        SDK_INITIALIZED.store(true, Ordering::SeqCst);
        info!("[Canon] SDK initialized successfully");
        Ok(true)
    }
}

/// Terminate the Canon EDSDK
#[tauri::command]
pub fn canon_terminate() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Ok(true);
        }

        // Close session first
        let _ = canon_close_session();

        unsafe {
            let error = EdsTerminateSDK();
            check_error(error)?;
        }

        SDK_INITIALIZED.store(false, Ordering::SeqCst);
        info!("[Canon] SDK terminated");
        Ok(true)
    }
}

/// Check if SDK is initialized
#[tauri::command]
pub fn canon_is_initialized() -> bool {
    SDK_INITIALIZED.load(Ordering::SeqCst)
}

/// Get list of connected Canon cameras
#[tauri::command]
pub fn canon_get_camera_list() -> Result<Vec<CameraInfo>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let mut cameras = Vec::new();

        unsafe {
            let mut camera_list: EdsCameraListRef = ptr::null_mut();
            let error = EdsGetCameraList(&mut camera_list);
            check_error(error)?;

            if camera_list.is_null() {
                return Ok(cameras);
            }

            let mut count: EdsUInt32 = 0;
            let error = EdsGetChildCount(camera_list, &mut count);
            if error != EDS_ERR_OK {
                EdsRelease(camera_list);
                check_error(error)?;
            }

            for i in 0..count as i32 {
                let mut camera_ref: EdsCameraRef = ptr::null_mut();
                let error = EdsGetChildAtIndex(camera_list, i, &mut camera_ref);
                if error == EDS_ERR_OK && !camera_ref.is_null() {
                    let mut device_info = EdsDeviceInfo::default();
                    let error = EdsGetDeviceInfo(camera_ref, &mut device_info);
                    if error == EDS_ERR_OK {
                        cameras.push(CameraInfo {
                            name: cstr_to_string(&device_info.szDeviceDescription),
                            port_name: cstr_to_string(&device_info.szPortName),
                            device_sub_type: device_info.deviceSubType,
                            body_id: None,
                        });
                    }
                    EdsRelease(camera_ref);
                }
            }

            EdsRelease(camera_list);
        }

        info!("[Canon] Found {} camera(s)", cameras.len());
        Ok(cameras)
    }
}

/// Connect to camera by index (default: 0)
#[tauri::command]
pub fn canon_connect(index: Option<u32>) -> Result<CameraInfo, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = index;
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let index = index.unwrap_or(0);

        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let mut manager = manager.lock().map_err(|e| e.to_string())?;

        // Close existing session
        if manager.session_open {
            if let Some(camera_ref) = manager.camera_ref {
                unsafe {
                    let _ = EdsCloseSession(camera_ref);
                    EdsRelease(camera_ref);
                }
            }
            manager.camera_ref = None;
            manager.session_open = false;
        }

        unsafe {
            let mut camera_list: EdsCameraListRef = ptr::null_mut();
            let error = EdsGetCameraList(&mut camera_list);
            check_error(error)?;

            if camera_list.is_null() {
                return Err("No cameras found".to_string());
            }

            let mut count: EdsUInt32 = 0;
            let error = EdsGetChildCount(camera_list, &mut count);
            if error != EDS_ERR_OK {
                EdsRelease(camera_list);
                check_error(error)?;
            }

            if count == 0 || index >= count {
                EdsRelease(camera_list);
                return Err("No camera at specified index".to_string());
            }

            let mut camera_ref: EdsCameraRef = ptr::null_mut();
            let error = EdsGetChildAtIndex(camera_list, index as i32, &mut camera_ref);
            EdsRelease(camera_list);

            if error != EDS_ERR_OK || camera_ref.is_null() {
                check_error(error)?;
                return Err("Failed to get camera reference".to_string());
            }

            let mut device_info = EdsDeviceInfo::default();
            let error = EdsGetDeviceInfo(camera_ref, &mut device_info);
            check_error(error)?;

            let camera_info = CameraInfo {
                name: cstr_to_string(&device_info.szDeviceDescription),
                port_name: cstr_to_string(&device_info.szPortName),
                device_sub_type: device_info.deviceSubType,
                body_id: None,
            };

            manager.camera_ref = Some(camera_ref);

            info!("[Canon] Connected to: {}", camera_info.name);
            Ok(camera_info)
        }
    }
}

/// Open session with connected camera
#[tauri::command]
pub fn canon_open_session() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let mut manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager
            .camera_ref
            .ok_or("No camera connected")?;

        unsafe {
            let error = EdsOpenSession(camera_ref);
            check_error(error)?;

            // Set save target to host
            let save_to: EdsUInt32 = kEdsSaveTo_Host;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );

            // Set capacity
            let capacity = EdsCapacity {
                numberOfFreeClusters: 0x7FFFFFFF,
                bytesPerSector: 512,
                reset: 1,
            };
            let _ = EdsSetCapacity(camera_ref, capacity);
        }

        manager.session_open = true;

        // Register state event handler
        if !manager.state_event_handler_registered {
            unsafe {
                let error = EdsSetStateEventHandler(
                    camera_ref,
                    kEdsStateEvent_All,
                    Some(state_event_handler),
                    ptr::null_mut(),
                );
                if error == EDS_ERR_OK {
                    manager.state_event_handler_registered = true;
                } else {
                    warn!("[Canon] Failed to register state event handler");
                }
            }
        }

        info!("[Canon] Session opened");
        Ok(true)
    }
}

/// Close session
#[tauri::command]
pub fn canon_close_session() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let manager = match CAMERA_MANAGER.get() {
            Some(m) => m,
            None => return Ok(true),
        };

        let mut manager = match manager.lock() {
            Ok(m) => m,
            Err(_) => return Ok(false),
        };

        if !manager.session_open {
            return Ok(true);
        }

        if let Some(camera_ref) = manager.camera_ref {
            unsafe {
                let _ = EdsCloseSession(camera_ref);
                EdsRelease(camera_ref);
            }
        }

        manager.camera_ref = None;
        manager.session_open = false;
        manager.event_handler_registered = false;
        manager.state_event_handler_registered = false;

        info!("[Canon] Session closed");
        Ok(true)
    }
}

/// Check if camera is connected
#[tauri::command]
pub fn canon_is_connected() -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let manager = match CAMERA_MANAGER.get() {
            Some(m) => m,
            None => return false,
        };
        let manager = match manager.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        manager.camera_ref.is_some() && manager.session_open
    }
}

/// Take a picture (blocking — waits for image download)
#[tauri::command]
pub fn canon_take_picture() -> Result<CaptureResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Ok(CaptureResult {
                success: false,
                error: Some("SDK not initialized".to_string()),
                image_data: None,
            });
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let camera_ref = {
            let mut manager = manager.lock().map_err(|e| e.to_string())?;

            let camera_ref = match manager.camera_ref {
                Some(r) => r,
                None => {
                    return Ok(CaptureResult {
                        success: false,
                        error: Some("No camera connected".to_string()),
                        image_data: None,
                    });
                }
            };

            if !manager.session_open {
                return Ok(CaptureResult {
                    success: false,
                    error: Some("Session not open".to_string()),
                    image_data: None,
                });
            }

            // Register object event handler if needed
            if !manager.event_handler_registered {
                unsafe {
                    let error = EdsSetObjectEventHandler(
                        camera_ref,
                        kEdsObjectEvent_All,
                        Some(object_event_handler),
                        ptr::null_mut(),
                    );
                    if error != EDS_ERR_OK {
                        return Ok(CaptureResult {
                            success: false,
                            error: Some(format!(
                                "Failed to register event handler: {}",
                                error_to_string(error)
                            )),
                            image_data: None,
                        });
                    }
                }
                manager.event_handler_registered = true;
            }

            camera_ref
        };

        // Init capture data
        let capture_data =
            CAPTURE_DATA.get_or_init(|| Arc::new(Mutex::new(CaptureData::default())));
        if let Ok(mut cd) = capture_data.lock() {
            cd.image_data = None;
            cd.capture_complete = false;
            cd.capture_error = None;
        }

        // Send take picture command
        let take_error = unsafe { EdsSendCommand(camera_ref, kEdsCameraCommand_TakePicture, 0) };

        if take_error != EDS_ERR_OK {
            return Ok(CaptureResult {
                success: false,
                error: Some(format!(
                    "Take picture failed: {}",
                    error_to_string(take_error)
                )),
                image_data: None,
            });
        }

        // Wait for capture (max 30s)
        for _ in 0..1500 {
            unsafe {
                let _ = EdsGetEvent();
            }

            if let Ok(cd) = capture_data.lock() {
                if cd.capture_complete {
                    break;
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // Get result
        let (image_data, error_msg) = if let Ok(mut cd) = capture_data.lock() {
            let data = cd.image_data.take();
            let err = cd.capture_error.take();
            cd.capture_complete = false;
            (data, err)
        } else {
            (None, Some("Failed to lock capture data".to_string()))
        };

        if let Some(err) = error_msg {
            return Ok(CaptureResult {
                success: false,
                error: Some(err),
                image_data: None,
            });
        }

        match image_data {
            Some(data) => {
                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                info!("[Canon] Capture success: {} bytes", data.len());
                Ok(CaptureResult {
                    success: true,
                    error: None,
                    image_data: Some(b64),
                })
            }
            None => Ok(CaptureResult {
                success: false,
                error: Some("Capture timeout - no image received".to_string()),
                image_data: None,
            }),
        }
    }
}

/// Send shutter command (non-blocking)
#[tauri::command]
pub fn canon_send_shutter() -> Result<CaptureResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Ok(CaptureResult {
                success: false,
                error: Some("SDK not initialized".to_string()),
                image_data: None,
            });
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let camera_ref = {
            let mut manager = manager.lock().map_err(|e| e.to_string())?;

            let camera_ref = match manager.camera_ref {
                Some(r) => r,
                None => {
                    return Ok(CaptureResult {
                        success: false,
                        error: Some("No camera connected".to_string()),
                        image_data: None,
                    });
                }
            };

            if !manager.session_open {
                return Ok(CaptureResult {
                    success: false,
                    error: Some("Session not open".to_string()),
                    image_data: None,
                });
            }

            if !manager.event_handler_registered {
                unsafe {
                    let error = EdsSetObjectEventHandler(
                        camera_ref,
                        kEdsObjectEvent_All,
                        Some(object_event_handler),
                        ptr::null_mut(),
                    );
                    if error != EDS_ERR_OK {
                        return Ok(CaptureResult {
                            success: false,
                            error: Some(format!(
                                "Failed to register handler: {}",
                                error_to_string(error)
                            )),
                            image_data: None,
                        });
                    }
                }
                manager.event_handler_registered = true;
            }

            camera_ref
        };

        // Reset capture state
        let capture_data =
            CAPTURE_DATA.get_or_init(|| Arc::new(Mutex::new(CaptureData::default())));
        if let Ok(mut cd) = capture_data.lock() {
            cd.image_data = None;
            cd.capture_complete = false;
            cd.capture_error = None;
        }

        let take_error = unsafe { EdsSendCommand(camera_ref, kEdsCameraCommand_TakePicture, 0) };

        if take_error != EDS_ERR_OK {
            return Ok(CaptureResult {
                success: false,
                error: Some(format!(
                    "Shutter failed: {}",
                    error_to_string(take_error)
                )),
                image_data: None,
            });
        }

        // Return immediately — caller should poll with canon_get_capture_result
        Ok(CaptureResult {
            success: true,
            error: None,
            image_data: None,
        })
    }
}

/// Get capture result (non-blocking check)
#[tauri::command]
pub fn canon_get_capture_result() -> Result<CaptureResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let capture_data = match CAPTURE_DATA.get() {
            Some(cd) => cd,
            None => {
                return Ok(CaptureResult {
                    success: false,
                    error: Some("No capture in progress".to_string()),
                    image_data: None,
                });
            }
        };

        if let Ok(mut cd) = capture_data.lock() {
            if !cd.capture_complete {
                // Still pending
                return Ok(CaptureResult {
                    success: false,
                    error: None,
                    image_data: None,
                });
            }

            let image_data = cd.image_data.take();
            let error_msg = cd.capture_error.take();
            cd.capture_complete = false;

            if let Some(err) = error_msg {
                return Ok(CaptureResult {
                    success: false,
                    error: Some(err),
                    image_data: None,
                });
            }

            match image_data {
                Some(data) => {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                    Ok(CaptureResult {
                        success: true,
                        error: None,
                        image_data: Some(b64),
                    })
                }
                None => Ok(CaptureResult {
                    success: false,
                    error: Some("Capture complete but no data".to_string()),
                    image_data: None,
                }),
            }
        } else {
            Ok(CaptureResult {
                success: false,
                error: Some("Lock error".to_string()),
                image_data: None,
            })
        }
    }
}

/// Process pending EDSDK events (call periodically)
#[tauri::command]
pub fn canon_process_events() -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return false;
        }
        unsafe {
            let _ = EdsGetEvent();
        }
        true
    }
}

/// Start live view
#[tauri::command]
pub fn canon_start_live_view() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            let evf_output: EdsUInt32 = kEdsEvfOutputDevice_PC;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Evf_OutputDevice,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &evf_output as *const _ as *const c_void,
            );
            check_error(error)?;
        }

        info!("[Canon] Live view started");
        Ok(true)
    }
}

/// Stop live view
#[tauri::command]
pub fn canon_stop_live_view() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            let evf_output: EdsUInt32 = 0;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Evf_OutputDevice,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &evf_output as *const _ as *const c_void,
            );
            check_error(error)?;
        }

        info!("[Canon] Live view stopped");
        Ok(true)
    }
}

/// Get a live view frame (returns base64 JPEG)
#[tauri::command]
pub fn canon_get_live_view_frame() -> Result<Option<LiveViewFrame>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            let mut stream: EdsStreamRef = ptr::null_mut();
            let error = EdsCreateMemoryStream(0, &mut stream);
            if error != EDS_ERR_OK {
                return Ok(None);
            }

            let mut evf_image: EdsEvfImageRef = ptr::null_mut();
            let error = EdsCreateEvfImageRef(stream, &mut evf_image);
            if error != EDS_ERR_OK {
                EdsRelease(stream);
                return Ok(None);
            }

            let error = EdsDownloadEvfImage(camera_ref, evf_image);
            if error != EDS_ERR_OK {
                EdsRelease(evf_image);
                EdsRelease(stream);
                return Ok(None);
            }

            let mut data_ptr: *mut c_void = ptr::null_mut();
            let error = EdsGetPointer(stream, &mut data_ptr);
            if error != EDS_ERR_OK || data_ptr.is_null() {
                EdsRelease(evf_image);
                EdsRelease(stream);
                return Ok(None);
            }

            let mut length: EdsUInt64 = 0;
            let error = EdsGetLength(stream, &mut length);
            if error != EDS_ERR_OK || length == 0 {
                EdsRelease(evf_image);
                EdsRelease(stream);
                return Ok(None);
            }

            let data_slice = std::slice::from_raw_parts(data_ptr as *const u8, length as usize);
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(data_slice);

            EdsRelease(evf_image);
            EdsRelease(stream);

            Ok(Some(LiveViewFrame { data: b64 }))
        }
    }
}

/// Get camera property
#[tauri::command]
pub fn canon_get_property(property_id: u32) -> Result<Option<u32>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = property_id;
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            let mut data_type: EdsDataType = 0;
            let mut size: EdsUInt32 = 0;
            let error =
                EdsGetPropertySize(camera_ref, property_id, 0, &mut data_type, &mut size);
            check_error(error)?;

            if size == 4 {
                let mut value: EdsUInt32 = 0;
                let error = EdsGetPropertyData(
                    camera_ref,
                    property_id,
                    0,
                    size,
                    &mut value as *mut _ as *mut c_void,
                );
                if error == EDS_ERR_OK {
                    return Ok(Some(value));
                }
            }
        }

        Ok(None)
    }
}

/// Set camera property
#[tauri::command]
pub fn canon_set_property(property_id: u32, value: u32) -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (property_id, value);
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let manager = manager.lock().map_err(|e| e.to_string())?;

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            let error = EdsSetPropertyData(
                camera_ref,
                property_id,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &value as *const _ as *const c_void,
            );
            check_error(error)?;
        }

        Ok(true)
    }
}

/// Get battery level
#[tauri::command]
pub fn canon_get_battery_level() -> Result<Option<u32>, String> {
    canon_get_property(kEdsPropID_BatteryLevel)
}

/// Get available shots
#[tauri::command]
pub fn canon_get_available_shots() -> Result<Option<u32>, String> {
    canon_get_property(kEdsPropID_AvailableShots)
}

// Property ID constants are in edsdk_sys — re-export for frontend reference
// Frontend can use numeric values directly: ISO=0x402, Av=0x405, Tv=0x406, etc.
