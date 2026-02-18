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

/// Max pixel dimension (width or height) for captured photos.
/// 3000px is enough for 600 DPI 4×6 prints while vastly reducing file size.
const CAPTURE_MAX_DIMENSION: u32 = 3000;
/// JPEG quality for re-encoded captures (1–100).
const CAPTURE_JPEG_QUALITY: u8 = 92;

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
static IS_CAPTURING: AtomicBool = AtomicBool::new(false);

/// Movie recording state — shared between event handler and Tauri commands
static MOVIE_DATA: OnceLock<Arc<Mutex<MovieData>>> = OnceLock::new();
static IS_MOVIE_RECORDING: AtomicBool = AtomicBool::new(false);

struct MovieData {
    /// Local path to the downloaded movie file (set by the event handler)
    movie_path: Option<String>,
    /// True when the movie file has been downloaded from camera
    download_complete: bool,
    download_error: Option<String>,
}

impl Default for MovieData {
    fn default() -> Self {
        Self {
            movie_path: None,
            download_complete: false,
            download_error: None,
        }
    }
}

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
    // Helper: check both "EDSDK/Dll/EDSDK.dll" (dev) and "EDSDK/EDSDK.dll" (bundled/flat)
    let candidates = |base: &std::path::Path| -> Option<String> {
        // Original structure: EDSDK/Dll/EDSDK.dll
        let dll = base.join("EDSDK").join("Dll").join("EDSDK.dll");
        if dll.exists() {
            return Some(dll.to_string_lossy().to_string());
        }
        // Flat bundled structure: EDSDK/EDSDK.dll
        let dll = base.join("EDSDK").join("EDSDK.dll");
        if dll.exists() {
            return Some(dll.to_string_lossy().to_string());
        }
        None
    };

    // 1. Resource dir (installed via NSIS)
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(path) = candidates(&resource_dir) {
            return path;
        }
    }

    // 2. Relative to exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Same dir as exe
            if let Some(path) = candidates(exe_dir) {
                return path;
            }
            // _up_ (NSIS)
            if let Some(path) = candidates(&exe_dir.join("_up_")) {
                return path;
            }
            // Dev mode: walk up
            let mut dir = exe_dir.to_path_buf();
            for _ in 0..5 {
                if let Some(path) = candidates(&dir) {
                    return path;
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
        if let Some(path) = candidates(&cwd) {
            return path;
        }
    }

    // Fallback
    "EDSDK/Dll/EDSDK.dll".to_string()
}

use tauri::Manager;

// =============================================================================
// Image Resize Helper
// =============================================================================

/// Resize a captured JPEG to fit within `max_dim` pixels (longest side) and
/// re-encode as JPEG at the given quality.  If the image is already small
/// enough it is still re-encoded to optimise compression.
#[cfg(target_os = "windows")]
fn resize_captured_jpeg(raw_bytes: &[u8], max_dim: u32, quality: u8) -> Result<Vec<u8>, String> {
    use image::GenericImageView;

    let img = image::load_from_memory(raw_bytes)
        .map_err(|e| format!("Image load error: {}", e))?;

    let (w, h) = img.dimensions();

    let resized = if w > max_dim || h > max_dim {
        img.resize(max_dim, max_dim, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    resized
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode error: {}", e))?;

    info!(
        "[Canon] Resized capture: {}x{} -> {}x{}, {:.1} MB -> {:.1} MB",
        w, h,
        resized.width(), resized.height(),
        raw_bytes.len() as f64 / 1_048_576.0,
        buf.len() as f64 / 1_048_576.0,
    );

    Ok(buf)
}

// =============================================================================
// Event Handlers (Windows only)
// =============================================================================

#[cfg(target_os = "windows")]
unsafe extern "system" fn object_event_handler(
    event: EdsObjectEventID,
    object: EdsBaseRef,
    _context: *mut c_void,
) -> EdsError {
    // --- Movie recording: DirItemCreated when camera saves movie to SD card ---
    if event == kEdsObjectEvent_DirItemCreated && IS_MOVIE_RECORDING.load(Ordering::SeqCst) {
        info!("[Canon] Movie DirItemCreated event received");
        let dir_item = object as EdsDirectoryItemRef;

        let movie_data = match MOVIE_DATA.get() {
            Some(md) => md,
            None => return EDS_ERR_OK,
        };

        // Get file info
        let mut dir_info: EdsDirectoryItemInfo = std::mem::zeroed();
        let error = EdsGetDirectoryItemInfo(dir_item, &mut dir_info);
        if error != EDS_ERR_OK {
            if let Ok(mut md) = movie_data.lock() {
                md.download_error = Some(format!("Get dir info failed: {}", error_to_string(error)));
                md.download_complete = true;
            }
            return EDS_ERR_OK;
        }

        let file_size = dir_info.size;
        let filename = cstr_to_string(&dir_info.szFileName);
        info!("[Canon] Movie file on camera: {} ({} bytes)", filename, file_size);

        // Download to a temp directory on host
        let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
        let _ = std::fs::create_dir_all(&temp_dir);
        let local_path = temp_dir.join(&filename);
        let local_path_str = local_path.to_string_lossy().to_string();

        // Create a file stream for download
        let c_path = match std::ffi::CString::new(local_path_str.as_bytes()) {
            Ok(cs) => cs,
            Err(_) => {
                if let Ok(mut md) = movie_data.lock() {
                    md.download_error = Some("Invalid path".to_string());
                    md.download_complete = true;
                }
                return EDS_ERR_OK;
            }
        };

        let mut stream: EdsStreamRef = ptr::null_mut();
        let error = EdsCreateFileStream(
            c_path.as_ptr(),
            kEdsFileCreateDisposition_CreateAlways,
            kEdsAccess_ReadWrite,
            &mut stream,
        );
        if error != EDS_ERR_OK {
            if let Ok(mut md) = movie_data.lock() {
                md.download_error = Some(format!("Create file stream failed: {}", error_to_string(error)));
                md.download_complete = true;
            }
            return EDS_ERR_OK;
        }

        // Download
        let error = EdsDownload(dir_item, file_size, stream);
        if error != EDS_ERR_OK {
            if let Ok(mut md) = movie_data.lock() {
                md.download_error = Some(format!("Movie download failed: {}", error_to_string(error)));
                md.download_complete = true;
            }
            EdsRelease(stream);
            EdsDownloadCancel(dir_item);
            return EDS_ERR_OK;
        }

        let _ = EdsDownloadComplete(dir_item);
        EdsRelease(stream);

        // Delete the movie file from SD card to free space
        let del_error = EdsDeleteDirectoryItem(dir_item);
        if del_error != EDS_ERR_OK {
            warn!("[Canon] Failed to delete movie from SD card: {} (non-fatal)", error_to_string(del_error));
        } else {
            info!("[Canon] Movie deleted from SD card to free space");
        }

        info!("[Canon] Movie downloaded to: {}", local_path_str);

        if let Ok(mut md) = movie_data.lock() {
            md.movie_path = Some(local_path_str);
            md.download_complete = true;
            md.download_error = None;
        }

        return EDS_ERR_OK;
    }

    // --- Photo capture: DirItemRequestTransfer ---
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
            // IMPORTANT: use try_lock to avoid deadlock.
            // This callback may fire from EdsGetEvent() while CAMERA_MANAGER
            // is held by the caller.  If we can't lock, the disconnect will
            // be detected naturally when the next EDSDK call fails.
            if let Ok(mut m) = manager.try_lock() {
                if let Some(camera_ref) = m.camera_ref.take() {
                    let _ = EdsCloseSession(camera_ref);
                    EdsRelease(camera_ref);
                }
                m.session_open = false;
                m.event_handler_registered = false;
                m.state_event_handler_registered = false;
            } else {
                warn!("[Canon] state_event_handler: could not lock manager, disconnect will be detected later");
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

        // Prevent concurrent captures
        if IS_CAPTURING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            warn!("[Canon] Capture already in progress");
            return Ok(CaptureResult {
                success: false,
                error: Some("Capture already in progress".to_string()),
                image_data: None,
            });
        }

        // Use a guard to ensure IS_CAPTURING is reset even on panic/early return
        struct CaptureGuard;
        impl Drop for CaptureGuard {
            fn drop(&mut self) {
                IS_CAPTURING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = CaptureGuard;

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

        // Safety guard: ensure SaveTo=Host before every photo capture
        // (prevents photos going to SD card if movie recording restore failed)
        unsafe {
            let save_to: EdsUInt32 = kEdsSaveTo_Host;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );
            let capacity = EdsCapacity {
                numberOfFreeClusters: 0x7FFFFFFF,
                bytesPerSector: 512,
                reset: 1,
            };
            let _ = EdsSetCapacity(camera_ref, capacity);
        }

        info!("[Canon] Sending TakePicture command...");

        // Send take picture command
        let take_error = unsafe { EdsSendCommand(camera_ref, kEdsCameraCommand_TakePicture, 0) };

        if take_error != EDS_ERR_OK {
            error!("[Canon] TakePicture command failed: {}", error_to_string(take_error));
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
        // Call EdsGetEvent() to pump the event loop — this is the ONLY place
        // calling EdsGetEvent during capture (frontend pauses its event polling)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);
        let mut event_count = 0;

        while start.elapsed() < timeout {
            unsafe {
                let _ = EdsGetEvent();
            }
            event_count += 1;

            if let Ok(cd) = capture_data.lock() {
                if cd.capture_complete {
                    info!("[Canon] Capture complete after {} events, {:.1}s",
                        event_count, start.elapsed().as_secs_f32());
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
            error!("[Canon] Capture error: {}", err);
            return Ok(CaptureResult {
                success: false,
                error: Some(err),
                image_data: None,
            });
        }

        match image_data {
            Some(data) => {
                use base64::Engine;

                // Resize to max CAPTURE_MAX_DIMENSION px and re-encode as
                // JPEG to dramatically reduce payload size (~27 MB → ~1-2 MB).
                let processed = resize_captured_jpeg(
                    &data, CAPTURE_MAX_DIMENSION, CAPTURE_JPEG_QUALITY,
                ).unwrap_or_else(|e| {
                    warn!("[Canon] Resize failed ({}), using original", e);
                    data.clone()
                });

                let b64 = base64::engine::general_purpose::STANDARD.encode(&processed);
                info!(
                    "[Canon] Capture success: original {:.1} MB -> resized {:.1} MB",
                    data.len() as f64 / 1_048_576.0,
                    processed.len() as f64 / 1_048_576.0,
                );
                Ok(CaptureResult {
                    success: true,
                    error: None,
                    image_data: Some(b64),
                })
            }
            None => {
                error!("[Canon] Capture timeout - no image received after {:.1}s", start.elapsed().as_secs_f32());
                Ok(CaptureResult {
                    success: false,
                    error: Some("Capture timeout - no image received".to_string()),
                    image_data: None,
                })
            }
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
        // Skip if capture is in progress — canon_take_picture pumps events itself
        if IS_CAPTURING.load(Ordering::SeqCst) {
            return true;
        }
        // Use try_lock to avoid running concurrently with other EDSDK operations.
        // If CAMERA_MANAGER is locked (e.g. by canon_get_live_view_frame),
        // skip this cycle — events will be processed in the next cycle.
        if let Some(manager) = CAMERA_MANAGER.get() {
            if let Ok(_guard) = manager.try_lock() {
                unsafe {
                    let _ = EdsGetEvent();
                }
            }
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

        // Skip if capture is in progress — don't compete with EdsGetEvent loop
        if IS_CAPTURING.load(Ordering::SeqCst) {
            return Ok(None);
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        // Use try_lock: if another invoke is already grabbing a frame,
        // skip this cycle instead of blocking the thread pool.
        let manager = match manager.try_lock() {
            Ok(m) => m,
            Err(_) => return Ok(None),
        };

        let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
        if !manager.session_open {
            return Err("Session not open".to_string());
        }

        unsafe {
            // Process pending SDK events while we hold the lock.
            // This replaces the separate event-polling interval and ensures
            // EdsGetEvent never runs concurrently with other EDSDK calls.
            let _ = EdsGetEvent();

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

// =============================================================================
// Movie Recording via EDSDK
// =============================================================================

/// Start movie recording on the camera.
///
/// Flow:
/// 1. Ensure event handler is registered (to catch DirItemCreated)
/// 2. Set SaveTo = Camera (movie must be saved to SD card)
/// 3. Switch to movie mode (MovieSelectSwON)
/// 4. Start live view if not already active (required for movie recording)
/// 5. Set kEdsPropID_Record = 4 (begin recording)
#[tauri::command]
pub fn canon_start_movie_record() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Err("SDK not initialized".to_string());
        }

        if IS_MOVIE_RECORDING.load(Ordering::SeqCst) {
            warn!("[Canon] Movie recording already in progress");
            return Ok(true);
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let (camera_ref, _session_open) = {
            let mut manager = manager.lock().map_err(|e| e.to_string())?;

            let camera_ref = manager.camera_ref.ok_or("No camera connected")?;
            if !manager.session_open {
                return Err("Session not open".to_string());
            }

            // Register event handler if needed (needed for movie download)
            if !manager.event_handler_registered {
                unsafe {
                    let error = EdsSetObjectEventHandler(
                        camera_ref,
                        kEdsObjectEvent_All,
                        Some(object_event_handler),
                        ptr::null_mut(),
                    );
                    if error != EDS_ERR_OK {
                        return Err(format!("Failed to register handler: {}", error_to_string(error)));
                    }
                }
                manager.event_handler_registered = true;
            }

            (camera_ref, manager.session_open)
        };

        // Reset movie data
        let movie_data = MOVIE_DATA.get_or_init(|| Arc::new(Mutex::new(MovieData::default())));
        if let Ok(mut md) = movie_data.lock() {
            md.movie_path = None;
            md.download_complete = false;
            md.download_error = None;
        }

        unsafe {
            // 1. Set SaveTo = Camera (movie files must be saved on the SD card)
            let save_to: EdsUInt32 = kEdsSaveTo_Camera;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );
            if error != EDS_ERR_OK {
                warn!("[Canon] Failed to set SaveTo=Camera: {}", error_to_string(error));
                // Continue anyway — some cameras default to camera save for movies
            }

            // 2. Switch to movie mode
            let error = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwON, 0);
            if error != EDS_ERR_OK {
                warn!("[Canon] MovieSelectSwON failed: {} — camera may already be in movie mode", error_to_string(error));
                // Not fatal — R50 may already be in movie mode via physical dial
            }

            // Brief stabilization
            std::thread::sleep(std::time::Duration::from_millis(200));

            // CRITICAL: Disable AF and Drive modes that cause freezes during capture
            // 2a. Disable Movie Servo AF (prevents focus hunting/locking during shutter press)
            let servo_af: EdsUInt32 = 0; // 0 = OFF
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_MovieServoAf,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &servo_af as *const _ as *const c_void,
            );

            // 2b. Set AF Mode to One-Shot if possible (prevents continuous AF)
            let af_mode: EdsUInt32 = 0; // One-Shot usually 0 or 3 depending on cam
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_AFMode,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &af_mode as *const _ as *const c_void,
            );

            // 2c. Disable Mirror Lockup (prevent double-press requirement)
            let mlu: EdsUInt32 = 0; // Disable
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_MirrorLockUpState,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &mlu as *const _ as *const c_void,
            );

             // 2d. Force JPEG Large (no RAW buffer overhead)
            let quality: EdsUInt32 = 0x0010ff0f; // EdsImageQuality_LJ (Large Fine JPEG)
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_ImageQuality,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &quality as *const _ as *const c_void,
            );


            // 3. Ensure live view is outputting to PC (required for movie recording)
            let evf_output: EdsUInt32 = kEdsEvfOutputDevice_PC;

            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Evf_OutputDevice,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &evf_output as *const _ as *const c_void,
            );

            std::thread::sleep(std::time::Duration::from_millis(100));

            // 4. Start recording: set kEdsPropID_Record = 4
            let record_start: EdsUInt32 = kEdsRecord_Begin;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Record,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &record_start as *const _ as *const c_void,
            );
            if error != EDS_ERR_OK {
                // Try to revert to photo mode
                let _ = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwOFF, 0);
                return Err(format!("Start recording failed: {}", error_to_string(error)));
            }
        }

        IS_MOVIE_RECORDING.store(true, Ordering::SeqCst);
        info!("[Canon] Movie recording started");
        Ok(true)
    }
}

/// Stop movie recording, wait for file download from camera, and return the local path.
///
/// Flow:
/// 1. Set kEdsPropID_Record = 0 (stop recording)
/// 2. Wait for DirItemCreated event (camera saves movie → triggers event handler)
/// 3. Event handler downloads movie file to temp directory
/// 4. Switch back to photo mode (MovieSelectSwOFF)
/// 5. Restore SaveTo = Host
/// 6. Return local file path
#[tauri::command]
pub fn canon_stop_movie_record() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !IS_MOVIE_RECORDING.load(Ordering::SeqCst) {
            return Err("Not currently recording".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let camera_ref = {
            let manager = manager.lock().map_err(|e| e.to_string())?;
            manager.camera_ref.ok_or("No camera connected")?
        };

        // Reset movie data for catching the new download event
        let movie_data = MOVIE_DATA.get_or_init(|| Arc::new(Mutex::new(MovieData::default())));
        if let Ok(mut md) = movie_data.lock() {
            md.movie_path = None;
            md.download_complete = false;
            md.download_error = None;
        }

        unsafe {
            // 1. Stop recording: set kEdsPropID_Record = 0
            let record_stop: EdsUInt32 = kEdsRecord_End;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Record,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &record_stop as *const _ as *const c_void,
            );
            if error != EDS_ERR_OK {
                warn!("[Canon] Stop recording property set failed: {}", error_to_string(error));
                // Continue — we still need to wait and clean up
            }
        }

        info!("[Canon] Movie recording stopped, waiting for file download...");

        // 2. Wait for download (max 30s — large movie files may take time)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);

        while start.elapsed() < timeout {
            // Pump EDSDK events to trigger the callback
            unsafe {
                let _ = EdsGetEvent();
            }

            if let Ok(md) = movie_data.lock() {
                if md.download_complete {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        IS_MOVIE_RECORDING.store(false, Ordering::SeqCst);

        // 3. Switch back to photo mode
        unsafe {
            let _ = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwOFF, 0);
            std::thread::sleep(std::time::Duration::from_millis(200));

            // 4. Restore SaveTo = Host (for photo capture)
            let save_to: EdsUInt32 = kEdsSaveTo_Host;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );

            // Restore host capacity
            let capacity = EdsCapacity {
                numberOfFreeClusters: 0x7FFFFFFF,
                bytesPerSector: 512,
                reset: 1,
            };
            let _ = EdsSetCapacity(camera_ref, capacity);
        }

        // 5. Return result
        if let Ok(md) = movie_data.lock() {
            if let Some(ref err) = md.download_error {
                return Err(format!("Movie download failed: {}", err));
            }
            if let Some(ref path) = md.movie_path {
                info!("[Canon] Movie file ready: {}", path);
                return Ok(path.clone());
            }
        }

        Err("Movie download timeout — no file received from camera".to_string())
    }
}

/// Fast movie stop — stops recording and switches to photo mode immediately.
///
/// Unlike `canon_stop_movie_record`, this does NOT wait for the movie file
/// download from the SD card.  It returns as soon as the camera is ready
/// for a still capture (~200 ms instead of 1-2 s).
///
/// Call `canon_finalize_movie_download` later to pump events, download the
/// movie file, and retrieve its local path.
///
/// Flow:
/// 1. Set kEdsPropID_Record = 0 (stop recording)
/// 2. Switch to photo mode (MovieSelectSwOFF)
/// 3. Restore SaveTo = Host + capacity
/// 4. Return immediately — IS_MOVIE_RECORDING stays true so the event
///    handler still catches the DirItemCreated download event later.
#[tauri::command]
pub fn canon_stop_movie_record_fast() -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !IS_MOVIE_RECORDING.load(Ordering::SeqCst) {
            return Err("Not currently recording".to_string());
        }

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let camera_ref = {
            let manager = manager.lock().map_err(|e| e.to_string())?;
            manager.camera_ref.ok_or("No camera connected")?
        };

        // Reset movie data so the event handler writes fresh download info
        let movie_data = MOVIE_DATA.get_or_init(|| Arc::new(Mutex::new(MovieData::default())));
        if let Ok(mut md) = movie_data.lock() {
            md.movie_path = None;
            md.download_complete = false;
            md.download_error = None;
        }

        unsafe {
            // 1. Stop recording
            let record_stop: EdsUInt32 = kEdsRecord_End;
            let error = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Record,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &record_stop as *const _ as *const c_void,
            );
            if error != EDS_ERR_OK {
                warn!("[Canon] Stop recording property set failed: {}", error_to_string(error));
            }

            // 2. Switch back to photo mode
            let _ = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwOFF, 0);
            std::thread::sleep(std::time::Duration::from_millis(200));

            // 3. Stop live view (so takePicture doesn't need a separate invoke)
            let evf_output: EdsUInt32 = 0;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Evf_OutputDevice,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &evf_output as *const _ as *const c_void,
            );

            // 4. Restore SaveTo = Host (required for still capture)
            let save_to: EdsUInt32 = kEdsSaveTo_Host;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );

            let capacity = EdsCapacity {
                numberOfFreeClusters: 0x7FFFFFFF,
                bytesPerSector: 512,
                reset: 1,
            };
            let _ = EdsSetCapacity(camera_ref, capacity);
        }

        info!("[Canon] Movie recording stopped (fast), LV off — ready for photo, movie download pending");
        Ok(true)
    }
}

/// Take a photo WHILE the camera is still recording video.
///
/// Uses `PressShutterButton` to snap a still image during movie recording,
/// then immediately stops the recording.  The photo is returned synchronously;
/// the movie file download happens later via `canon_finalize_movie_download`.
///
/// Flow:
/// 1. Set SaveTo = Both (photo→host, movie→SD card)
/// 2. Set host capacity so the camera can send the photo to host
/// 3. Init CAPTURE_DATA for receiving the photo
/// 4. Reset MOVIE_DATA for the upcoming movie download
/// 5. PressShutterButton Completely_NonAF → camera takes a still
/// 6. Pump EdsGetEvent until DirItemRequestTransfer (photo) arrives
/// 7. Set kEdsPropID_Record = 0 (stop recording)
/// 8. Return the photo — movie DirItemCreated will fire later
///
/// If PressShutterButton fails (camera/firmware doesn't support photo-in-movie),
/// falls back to stop-then-shoot: stop recording fast → TakePicture.
#[tauri::command]
pub fn canon_take_photo_during_recording() -> Result<CaptureResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !IS_MOVIE_RECORDING.load(Ordering::SeqCst) {
            // Not recording — fall back to normal photo capture
            info!("[Canon] Not recording, delegating to normal take_picture");
            return canon_take_picture();
        }

        if !SDK_INITIALIZED.load(Ordering::SeqCst) {
            return Ok(CaptureResult {
                success: false,
                error: Some("SDK not initialized".to_string()),
                image_data: None,
            });
        }

        // Prevent concurrent captures
        if IS_CAPTURING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Ok(CaptureResult {
                success: false,
                error: Some("Capture already in progress".to_string()),
                image_data: None,
            });
        }

        struct CaptureGuard;
        impl Drop for CaptureGuard {
            fn drop(&mut self) {
                IS_CAPTURING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = CaptureGuard;

        let manager = CAMERA_MANAGER
            .get()
            .ok_or("Camera manager not initialized")?;

        let camera_ref = {
            let manager = manager.lock().map_err(|e| e.to_string())?;
            manager.camera_ref.ok_or("No camera connected")?
        };

        // 1. Set SaveTo = Both so photo goes to host while movie stays on SD
        unsafe {
            let save_to: EdsUInt32 = kEdsSaveTo_Both;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_SaveTo,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &save_to as *const _ as *const c_void,
            );

            // 2. Set host capacity
            let capacity = EdsCapacity {
                numberOfFreeClusters: 0x7FFFFFFF,
                bytesPerSector: 512,
                reset: 1,
            };
            let _ = EdsSetCapacity(camera_ref, capacity);
        }

        // 3. Init capture data for the photo
        let capture_data =
            CAPTURE_DATA.get_or_init(|| Arc::new(Mutex::new(CaptureData::default())));
        if let Ok(mut cd) = capture_data.lock() {
            cd.image_data = None;
            cd.capture_complete = false;
            cd.capture_error = None;
        }

        // 4. Reset movie data for the upcoming movie download event
        let movie_data = MOVIE_DATA.get_or_init(|| Arc::new(Mutex::new(MovieData::default())));
        if let Ok(mut md) = movie_data.lock() {
            md.movie_path = None;
            md.download_complete = false;
            md.download_error = None;
        }

        // 5. Press shutter button to take a photo while recording
        info!("[Canon] Taking photo during recording via PressShutterButton...");
        let shutter_error = unsafe {
            EdsSendCommand(
                camera_ref,
                kEdsCameraCommand_PressShutterButton,
                kEdsShutterButton_Completely_NonAF as i32,
            )
        };

        if shutter_error != EDS_ERR_OK {
            warn!("[Canon] PressShutterButton during recording failed: {} — falling back to stop-then-shoot",
                error_to_string(shutter_error));

            // Release the shutter button
            unsafe {
                let _ = EdsSendCommand(
                    camera_ref,
                    kEdsCameraCommand_PressShutterButton,
                    kEdsShutterButton_OFF as i32,
                );
            }

            // FALLBACK: stop recording fast then take a normal photo
            drop(_guard);
            IS_CAPTURING.store(false, Ordering::SeqCst);

            // Stop recording + switch to photo mode
            let _ = canon_stop_movie_record_fast();

            // Normal photo capture
            return canon_take_picture();
        }

        // 6. Pump events until photo arrives (DirItemRequestTransfer)
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(15);
        let mut event_count = 0;

        while start.elapsed() < timeout {
            unsafe {
                let _ = EdsGetEvent();
            }
            event_count += 1;

            if let Ok(cd) = capture_data.lock() {
                if cd.capture_complete {
                    info!("[Canon] Photo-during-recording received after {} events, {:.1}s",
                        event_count, start.elapsed().as_secs_f32());
                    break;
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        // Release the shutter button
        unsafe {
            let _ = EdsSendCommand(
                camera_ref,
                kEdsCameraCommand_PressShutterButton,
                kEdsShutterButton_OFF as i32,
            );
        }

        // 7. Stop recording AFTER photo is taken
        info!("[Canon] Photo captured, now stopping recording...");
        unsafe {
            let record_stop: EdsUInt32 = kEdsRecord_End;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Record,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &record_stop as *const _ as *const c_void,
            );

            // 7b. Switch back to photo mode so the camera is ready for
            //     the next cycle.  Without this the camera stays in movie
            //     mode and live-view restart fails / shows mode OSD.
            let _ = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwOFF, 0);
            std::thread::sleep(std::time::Duration::from_millis(200));

            // Stop live view
            let evf_output: EdsUInt32 = 0;
            let _ = EdsSetPropertyData(
                camera_ref,
                kEdsPropID_Evf_OutputDevice,
                0,
                std::mem::size_of::<EdsUInt32>() as u32,
                &evf_output as *const _ as *const c_void,
            );

            // NOTE: Do NOT restore SaveTo = Host yet!
            // Wait until the movie file is downloaded in canon_finalize_movie_download.
            // Switching too early might cancel the pending DirItemCreated event for the movie file.
        }
        // IS_MOVIE_RECORDING stays true — movie download via finalizeMovieDownload later
        info!("[Canon] Recording stopped, camera in photo mode (SaveTo kept for movie file integrity)");

        // 8. Process photo result
        let (image_data, error_msg) = if let Ok(mut cd) = capture_data.lock() {
            let data = cd.image_data.take();
            let err = cd.capture_error.take();
            cd.capture_complete = false;
            (data, err)
        } else {
            (None, Some("Failed to lock capture data".to_string()))
        };

        if let Some(err) = error_msg {
            error!("[Canon] Photo-during-recording error: {}", err);
            return Ok(CaptureResult {
                success: false,
                error: Some(err),
                image_data: None,
            });
        }

        match image_data {
            Some(data) => {
                use base64::Engine;

                let processed = resize_captured_jpeg(
                    &data, CAPTURE_MAX_DIMENSION, CAPTURE_JPEG_QUALITY,
                ).unwrap_or_else(|e| {
                    warn!("[Canon] Resize failed ({}), using original", e);
                    data.clone()
                });

                let b64 = base64::engine::general_purpose::STANDARD.encode(&processed);
                info!(
                    "[Canon] Photo-during-recording success: {:.1} MB -> {:.1} MB",
                    data.len() as f64 / 1_048_576.0,
                    processed.len() as f64 / 1_048_576.0,
                );
                Ok(CaptureResult {
                    success: true,
                    error: None,
                    image_data: Some(b64),
                })
            }
            None => {
                warn!("[Canon] No photo received during recording — falling back to stop-then-shoot");
                // Stop movie mode, take a normal photo
                drop(_guard);
                IS_CAPTURING.store(false, Ordering::SeqCst);

                // Need to stop movie mode since recording was already stopped above
                unsafe {
                    let _ = EdsSendCommand(camera_ref, kEdsCameraCommand_MovieSelectSwOFF, 0);
                    std::thread::sleep(std::time::Duration::from_millis(200));

                    let evf_output: EdsUInt32 = 0;
                    let _ = EdsSetPropertyData(
                        camera_ref,
                        kEdsPropID_Evf_OutputDevice,
                        0,
                        std::mem::size_of::<EdsUInt32>() as u32,
                        &evf_output as *const _ as *const c_void,
                    );

                    // NOTE: Do NOT restore SaveTo = Host yet!
                    // Wait until the movie file is downloaded in canon_finalize_movie_download.
                    // If we restore it now, the movie file download (SaveTo=Camera) might fail or get confused.
                }

                canon_take_picture()
            }
        }
    }
}

/// Wait for the movie file to finish downloading from the camera.
///
/// Call this AFTER `canon_stop_movie_record_fast` + `canon_take_picture`
/// to pump EDSDK events until the movie DirItemCreated event is processed
/// and the file has been downloaded to disk.
///
/// Sets IS_MOVIE_RECORDING = false when done.
#[tauri::command]
pub fn canon_finalize_movie_download() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Canon EDSDK is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let movie_data = MOVIE_DATA.get_or_init(|| Arc::new(Mutex::new(MovieData::default())));

        // Helper to check if download is complete
        let check_download = || -> Option<Result<String, String>> {
            if let Ok(md) = movie_data.lock() {
                if md.download_complete {
                    if let Some(ref err) = md.download_error {
                        return Some(Err(format!("Movie download failed: {}", err)));
                    }
                    if let Some(ref path) = md.movie_path {
                        info!("[Canon] Movie file ready: {}", path);
                        return Some(Ok(path.clone()));
                    }
                    return Some(Err("Movie download completed but no file path".to_string()));
                }
            }
            None
        };

        // Helper to restore SaveTo=Host
        let restore_save_to_host = || {
            if let Some(manager) = CAMERA_MANAGER.get() {
                if let Ok(manager) = manager.lock() {
                    if let Some(camera_ref) = manager.camera_ref {
                        info!("[Canon] Finalize Movie: Restoring SaveTo=Host");
                        unsafe {
                            let save_to: EdsUInt32 = kEdsSaveTo_Host;
                            let _ = EdsSetPropertyData(
                                camera_ref,
                                kEdsPropID_SaveTo,
                                0,
                                std::mem::size_of::<EdsUInt32>() as u32,
                                &save_to as *const _ as *const c_void,
                            );
                            let capacity = EdsCapacity {
                                numberOfFreeClusters: 0x7FFFFFFF,
                                bytesPerSector: 512,
                                reset: 1,
                            };
                            let _ = EdsSetCapacity(camera_ref, capacity);
                        }
                    }
                }
            }
        };

        // 1. Check if already downloaded
        if let Some(result) = check_download() {
            IS_MOVIE_RECORDING.store(false, Ordering::SeqCst);
            restore_save_to_host();
            return result;
        }

        info!("[Canon] Waiting for movie file download...");

        // 2. Wait loop
        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(30);

        while start.elapsed() < timeout {
            unsafe {
                let _ = EdsGetEvent();
            }

            if let Some(result) = check_download() {
                IS_MOVIE_RECORDING.store(false, Ordering::SeqCst);
                restore_save_to_host();
                return result;
            }

            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        IS_MOVIE_RECORDING.store(false, Ordering::SeqCst);
        restore_save_to_host();

        Err("Movie download timeout — no file received from camera".to_string())
    }
}

/// Check if camera is currently recording a movie
#[tauri::command]
pub fn canon_is_movie_recording() -> bool {
    IS_MOVIE_RECORDING.load(Ordering::SeqCst)
}

// Property ID constants are in edsdk_sys — re-export for frontend reference
// Frontend can use numeric values directly: ISO=0x402, Av=0x405, Tv=0x406, etc.
