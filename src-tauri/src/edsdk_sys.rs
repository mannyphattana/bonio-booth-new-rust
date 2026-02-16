//! Canon EDSDK Raw FFI Bindings
//!
//! Low-level unsafe bindings to the Canon EDSDK C API.
//! Dynamically loads EDSDK.dll at runtime via LoadLibraryA/GetProcAddress.

#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![allow(dead_code)]

use std::os::raw::{c_char, c_int, c_void};

// =============================================================================
// Basic Types
// =============================================================================

pub type EdsVoid = c_void;
pub type EdsBool = c_int;
pub type EdsChar = c_char;
pub type EdsInt32 = i32;
pub type EdsUInt32 = u32;
pub type EdsUInt64 = u64;

pub type EdsError = EdsUInt32;
pub type EdsDataType = EdsUInt32;
pub type EdsPropertyID = EdsUInt32;
pub type EdsPropertyEventID = EdsUInt32;
pub type EdsObjectEventID = EdsUInt32;
pub type EdsStateEventID = EdsUInt32;
pub type EdsCameraCommand = EdsUInt32;
pub type EdsCameraStatusCommand = EdsUInt32;
pub type EdsAccess = EdsUInt32;
pub type EdsFileCreateDisposition = EdsUInt32;
pub type EdsEvfOutputDevice = EdsUInt32;
pub type EdsShutterButton = EdsUInt32;
pub type EdsSaveTo = EdsUInt32;

// =============================================================================
// Reference Types (Opaque Handles)
// =============================================================================

pub type EdsBaseRef = *mut c_void;
pub type EdsCameraListRef = *mut c_void;
pub type EdsCameraRef = *mut c_void;
pub type EdsDirectoryItemRef = *mut c_void;
pub type EdsStreamRef = *mut c_void;
pub type EdsEvfImageRef = *mut c_void;

// =============================================================================
// Constants - Error Codes
// =============================================================================

pub const EDS_ERR_OK: EdsError = 0x00000000;
pub const EDS_ERR_INTERNAL_ERROR: EdsError = 0x00000002;
pub const EDS_ERR_DEVICE_NOT_FOUND: EdsError = 0x00000080;
pub const EDS_ERR_DEVICE_BUSY: EdsError = 0x00000081;
pub const EDS_ERR_COMM_DISCONNECTED: EdsError = 0x000000C1;
pub const EDS_ERR_SESSION_NOT_OPEN: EdsError = 0x00002003;
pub const EDS_ERR_INVALID_HANDLE: EdsError = 0x00000061;
pub const EDS_ERR_INVALID_PARAMETER: EdsError = 0x00000060;
pub const EDS_ERR_TAKE_PICTURE_AF_NG: EdsError = 0x00008D01;
pub const EDS_ERR_TAKE_PICTURE_NO_CARD_NG: EdsError = 0x00008D06;
pub const EDS_ERR_TAKE_PICTURE_NO_LENS_NG: EdsError = 0x00008D0B;
pub const EDS_ERR_LOW_BATTERY: EdsError = 0x0000A101;
pub const EDS_ERR_OBJECT_NOTREADY: EdsError = 0x0000A102;
pub const EDS_ERR_NOT_SUPPORTED: EdsError = 0x00000007;
pub const EDS_ERR_OPERATION_CANCELLED: EdsError = 0x00000005;

// =============================================================================
// Constants - Property IDs
// =============================================================================

pub const kEdsPropID_ProductName: EdsPropertyID = 0x00000002;
pub const kEdsPropID_BatteryLevel: EdsPropertyID = 0x00000008;
pub const kEdsPropID_SaveTo: EdsPropertyID = 0x0000000B;
pub const kEdsPropID_BodyIDEx: EdsPropertyID = 0x00000015;
pub const kEdsPropID_ImageQuality: EdsPropertyID = 0x00000100;
pub const kEdsPropID_WhiteBalance: EdsPropertyID = 0x00000106;
pub const kEdsPropID_ISOSpeed: EdsPropertyID = 0x00000402;
pub const kEdsPropID_Av: EdsPropertyID = 0x00000405;
pub const kEdsPropID_Tv: EdsPropertyID = 0x00000406;
pub const kEdsPropID_ExposureCompensation: EdsPropertyID = 0x00000407;
pub const kEdsPropID_AvailableShots: EdsPropertyID = 0x0000040A;
pub const kEdsPropID_AEMode: EdsPropertyID = 0x00000400;
pub const kEdsPropID_DriveMode: EdsPropertyID = 0x00000401;
pub const kEdsPropID_MeteringMode: EdsPropertyID = 0x00000403;
pub const kEdsPropID_AFMode: EdsPropertyID = 0x00000404;

// EVF Properties
pub const kEdsPropID_Evf_OutputDevice: EdsPropertyID = 0x00000500;
pub const kEdsPropID_Evf_Mode: EdsPropertyID = 0x00000501;

// =============================================================================
// Constants - Camera Commands
// =============================================================================

pub const kEdsCameraCommand_TakePicture: EdsCameraCommand = 0x00000000;
pub const kEdsCameraCommand_ExtendShutDownTimer: EdsCameraCommand = 0x00000001;
pub const kEdsCameraCommand_PressShutterButton: EdsCameraCommand = 0x00000004;

// =============================================================================
// Constants - Events
// =============================================================================

// Object events
pub const kEdsObjectEvent_All: EdsObjectEventID = 0x00000200;
pub const kEdsObjectEvent_DirItemRequestTransfer: EdsObjectEventID = 0x00000208;

// State events
pub const kEdsStateEvent_All: EdsStateEventID = 0x00000300;
pub const kEdsStateEvent_Shutdown: EdsStateEventID = 0x00000301;

// =============================================================================
// Constants - Save To
// =============================================================================

pub const kEdsSaveTo_Host: EdsSaveTo = 2;

// =============================================================================
// Constants - EVF Output Device
// =============================================================================

pub const kEdsEvfOutputDevice_PC: EdsEvfOutputDevice = 2;

// =============================================================================
// Constants - Shutter Button
// =============================================================================

pub const kEdsShutterButton_OFF: EdsShutterButton = 0x00000000;
pub const kEdsShutterButton_Halfway: EdsShutterButton = 0x00000001;
pub const kEdsShutterButton_Completely: EdsShutterButton = 0x00000003;
pub const kEdsShutterButton_Halfway_NonAF: EdsShutterButton = 0x00010001;
pub const kEdsShutterButton_Completely_NonAF: EdsShutterButton = 0x00010003;

// =============================================================================
// Constants
// =============================================================================

pub const EDS_MAX_NAME: usize = 256;

// =============================================================================
// Structures
// =============================================================================

#[repr(C)]
#[derive(Debug, Clone)]
pub struct EdsDeviceInfo {
    pub szPortName: [EdsChar; EDS_MAX_NAME],
    pub szDeviceDescription: [EdsChar; EDS_MAX_NAME],
    pub deviceSubType: EdsUInt32,
    pub reserved: EdsUInt32,
}

impl Default for EdsDeviceInfo {
    fn default() -> Self {
        Self {
            szPortName: [0; EDS_MAX_NAME],
            szDeviceDescription: [0; EDS_MAX_NAME],
            deviceSubType: 0,
            reserved: 0,
        }
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct EdsCapacity {
    pub numberOfFreeClusters: EdsInt32,
    pub bytesPerSector: EdsInt32,
    pub reset: EdsBool,
}

impl Default for EdsCapacity {
    fn default() -> Self {
        Self {
            numberOfFreeClusters: 0,
            bytesPerSector: 0,
            reset: 0,
        }
    }
}

#[repr(C)]
#[derive(Debug, Clone)]
pub struct EdsDirectoryItemInfo {
    pub size: EdsUInt64,
    pub isFolder: EdsBool,
    pub groupID: EdsUInt32,
    pub option: EdsUInt32,
    pub szFileName: [EdsChar; EDS_MAX_NAME],
    pub format: EdsUInt32,
    pub dateTime: EdsUInt32,
}

impl Default for EdsDirectoryItemInfo {
    fn default() -> Self {
        Self {
            size: 0,
            isFolder: 0,
            groupID: 0,
            option: 0,
            szFileName: [0; EDS_MAX_NAME],
            format: 0,
            dateTime: 0,
        }
    }
}

// =============================================================================
// Callback Type Definitions
// =============================================================================

pub type EdsObjectEventHandler = Option<
    unsafe extern "system" fn(
        inEvent: EdsObjectEventID,
        inRef: EdsBaseRef,
        inContext: *mut c_void,
    ) -> EdsError,
>;

pub type EdsStateEventHandler = Option<
    unsafe extern "system" fn(
        inEvent: EdsStateEventID,
        inEventData: EdsUInt32,
        inContext: *mut c_void,
    ) -> EdsError,
>;

// =============================================================================
// FFI Functions - Dynamic Loading (Windows only)
// =============================================================================

#[cfg(target_os = "windows")]
pub mod dynamic {
    use super::*;
    use std::sync::OnceLock;
    use windows::core::PCSTR;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA, SetDllDirectoryA};

    struct SafeModule(HMODULE);
    unsafe impl Send for SafeModule {}
    unsafe impl Sync for SafeModule {}

    static EDSDK_MODULE: OnceLock<Option<SafeModule>> = OnceLock::new();

    /// Load EDSDK.dll from the given path.
    ///
    /// Before loading, we call `SetDllDirectoryA` to add the parent folder of
    /// EDSDK.dll to the DLL search path. This is critical because EDSDK.dll
    /// depends on many sibling DLLs (EdsImage.dll, DppCore.dll, etc.) that
    /// must be found at load time.
    pub unsafe fn load_edsdk(dll_path: &str) -> Result<(), String> {
        // Check if already loaded
        if EDSDK_MODULE.get().is_some() {
            return Ok(());
        }

        // Set the DLL search directory to the parent folder of EDSDK.dll
        // so that Windows can find dependent DLLs (EdsImage.dll, etc.)
        if let Some(parent) = std::path::Path::new(dll_path).parent() {
            let dir_str = parent.to_string_lossy().to_string();
            if let Ok(dir_cstr) = std::ffi::CString::new(dir_str.as_str()) {
                let _ = SetDllDirectoryA(PCSTR::from_raw(dir_cstr.as_ptr() as *const u8));
            }
        }

        let path_cstr = std::ffi::CString::new(dll_path).map_err(|e| e.to_string())?;
        let module = LoadLibraryA(PCSTR::from_raw(path_cstr.as_ptr() as *const u8));

        // Reset the DLL search directory back to default
        let _ = SetDllDirectoryA(PCSTR::null());

        match module {
            Ok(handle) => {
                EDSDK_MODULE.get_or_init(|| Some(SafeModule(handle)));
                Ok(())
            }
            Err(e) => Err(format!("Failed to load EDSDK.dll from '{}': {:?}", dll_path, e)),
        }
    }

    /// Check if EDSDK.dll is loaded
    pub fn is_loaded() -> bool {
        EDSDK_MODULE.get().and_then(|m| m.as_ref()).is_some()
    }

    macro_rules! edsdk_fn {
        ($name:ident, $ret:ty $(, $arg:ident: $argty:ty)*) => {
            pub unsafe fn $name($($arg: $argty),*) -> $ret {
                type FnType = unsafe extern "system" fn($($argty),*) -> $ret;
                let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
                if let Some(module) = module {
                    let func_name = std::ffi::CString::new(stringify!($name)).unwrap();
                    let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
                    if let Some(proc) = proc {
                        let func: FnType = std::mem::transmute(proc);
                        return func($($arg),*);
                    }
                }
                EDS_ERR_INTERNAL_ERROR
            }
        };
    }

    // SDK Initialization
    edsdk_fn!(EdsInitializeSDK, EdsError);
    edsdk_fn!(EdsTerminateSDK, EdsError);

    // Reference counting (returns u32, not EdsError)
    pub unsafe fn EdsRetain(inRef: EdsBaseRef) -> EdsUInt32 {
        type FnType = unsafe extern "system" fn(EdsBaseRef) -> EdsUInt32;
        let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
        if let Some(module) = module {
            let func_name = std::ffi::CString::new("EdsRetain").unwrap();
            let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
            if let Some(proc) = proc {
                let func: FnType = std::mem::transmute(proc);
                return func(inRef);
            }
        }
        0
    }

    pub unsafe fn EdsRelease(inRef: EdsBaseRef) -> EdsUInt32 {
        type FnType = unsafe extern "system" fn(EdsBaseRef) -> EdsUInt32;
        let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
        if let Some(module) = module {
            let func_name = std::ffi::CString::new("EdsRelease").unwrap();
            let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
            if let Some(proc) = proc {
                let func: FnType = std::mem::transmute(proc);
                return func(inRef);
            }
        }
        0
    }

    // Camera list
    edsdk_fn!(EdsGetCameraList, EdsError, outCameraListRef: *mut EdsCameraListRef);
    edsdk_fn!(EdsGetChildCount, EdsError, inRef: EdsBaseRef, outCount: *mut EdsUInt32);
    edsdk_fn!(EdsGetChildAtIndex, EdsError, inRef: EdsBaseRef, inIndex: EdsInt32, outRef: *mut EdsBaseRef);
    edsdk_fn!(EdsGetDeviceInfo, EdsError, inCameraRef: EdsCameraRef, outDeviceInfo: *mut EdsDeviceInfo);

    // Session management
    edsdk_fn!(EdsOpenSession, EdsError, inCameraRef: EdsCameraRef);
    edsdk_fn!(EdsCloseSession, EdsError, inCameraRef: EdsCameraRef);

    // Commands
    edsdk_fn!(EdsSendCommand, EdsError, inCameraRef: EdsCameraRef, inCommand: EdsCameraCommand, inParam: EdsInt32);
    edsdk_fn!(EdsSendStatusCommand, EdsError, inCameraRef: EdsCameraRef, inStatusCommand: EdsCameraStatusCommand, inParam: EdsInt32);

    // Properties
    edsdk_fn!(EdsGetPropertySize, EdsError, inRef: EdsBaseRef, inPropertyID: EdsPropertyID, inParam: EdsInt32, outDataType: *mut EdsDataType, outSize: *mut EdsUInt32);
    edsdk_fn!(EdsGetPropertyData, EdsError, inRef: EdsBaseRef, inPropertyID: EdsPropertyID, inParam: EdsInt32, inPropertySize: EdsUInt32, outPropertyData: *mut c_void);
    edsdk_fn!(EdsSetPropertyData, EdsError, inRef: EdsBaseRef, inPropertyID: EdsPropertyID, inParam: EdsInt32, inPropertySize: EdsUInt32, inPropertyData: *const c_void);

    // Capacity
    edsdk_fn!(EdsSetCapacity, EdsError, inCameraRef: EdsCameraRef, inCapacity: EdsCapacity);

    // Directory item functions
    edsdk_fn!(EdsGetDirectoryItemInfo, EdsError, inDirItemRef: EdsDirectoryItemRef, outDirItemInfo: *mut EdsDirectoryItemInfo);
    edsdk_fn!(EdsDownload, EdsError, inDirItemRef: EdsDirectoryItemRef, inReadSize: EdsUInt64, outStream: EdsStreamRef);
    edsdk_fn!(EdsDownloadComplete, EdsError, inDirItemRef: EdsDirectoryItemRef);
    edsdk_fn!(EdsDownloadCancel, EdsError, inDirItemRef: EdsDirectoryItemRef);

    // Stream functions
    edsdk_fn!(EdsCreateMemoryStream, EdsError, inBufferSize: EdsUInt64, outStream: *mut EdsStreamRef);
    edsdk_fn!(EdsGetPointer, EdsError, inStream: EdsStreamRef, outPointer: *mut *mut c_void);
    edsdk_fn!(EdsGetLength, EdsError, inStream: EdsStreamRef, outLength: *mut EdsUInt64);

    // EVF (Live View) functions
    edsdk_fn!(EdsCreateEvfImageRef, EdsError, inStreamRef: EdsStreamRef, outEvfImageRef: *mut EdsEvfImageRef);
    edsdk_fn!(EdsDownloadEvfImage, EdsError, inCameraRef: EdsCameraRef, outEvfImageRef: EdsEvfImageRef);

    // Event handlers
    pub unsafe fn EdsSetObjectEventHandler(
        inCameraRef: EdsCameraRef,
        inEvent: EdsObjectEventID,
        inObjectEventHandler: EdsObjectEventHandler,
        inContext: *mut c_void,
    ) -> EdsError {
        type FnType = unsafe extern "system" fn(EdsCameraRef, EdsObjectEventID, EdsObjectEventHandler, *mut c_void) -> EdsError;
        let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
        if let Some(module) = module {
            let func_name = std::ffi::CString::new("EdsSetObjectEventHandler").unwrap();
            let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
            if let Some(proc) = proc {
                let func: FnType = std::mem::transmute(proc);
                return func(inCameraRef, inEvent, inObjectEventHandler, inContext);
            }
        }
        EDS_ERR_INTERNAL_ERROR
    }

    pub unsafe fn EdsSetStateEventHandler(
        inCameraRef: EdsCameraRef,
        inEvent: EdsStateEventID,
        inStateEventHandler: EdsStateEventHandler,
        inContext: *mut c_void,
    ) -> EdsError {
        type FnType = unsafe extern "system" fn(EdsCameraRef, EdsStateEventID, EdsStateEventHandler, *mut c_void) -> EdsError;
        let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
        if let Some(module) = module {
            let func_name = std::ffi::CString::new("EdsSetStateEventHandler").unwrap();
            let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
            if let Some(proc) = proc {
                let func: FnType = std::mem::transmute(proc);
                return func(inCameraRef, inEvent, inStateEventHandler, inContext);
            }
        }
        EDS_ERR_INTERNAL_ERROR
    }

    // Message loop (required for Windows)
    pub unsafe fn EdsGetEvent() -> EdsError {
        type FnType = unsafe extern "system" fn() -> EdsError;
        let module = EDSDK_MODULE.get().and_then(|m| m.as_ref().map(|s| s.0));
        if let Some(module) = module {
            let func_name = std::ffi::CString::new("EdsGetEvent").unwrap();
            let proc = GetProcAddress(module, PCSTR::from_raw(func_name.as_ptr() as *const u8));
            if let Some(proc) = proc {
                let func: FnType = std::mem::transmute(proc);
                return func();
            }
        }
        EDS_ERR_OK
    }
}

/// Helper function to convert error code to string
pub fn error_to_string(error: EdsError) -> &'static str {
    match error {
        EDS_ERR_OK => "OK",
        EDS_ERR_INTERNAL_ERROR => "Internal error",
        EDS_ERR_DEVICE_NOT_FOUND => "Device not found",
        EDS_ERR_DEVICE_BUSY => "Device busy",
        EDS_ERR_COMM_DISCONNECTED => "Communication disconnected",
        EDS_ERR_SESSION_NOT_OPEN => "Session not open",
        EDS_ERR_INVALID_HANDLE => "Invalid handle",
        EDS_ERR_INVALID_PARAMETER => "Invalid parameter",
        EDS_ERR_TAKE_PICTURE_AF_NG => "Auto-focus failed",
        EDS_ERR_TAKE_PICTURE_NO_CARD_NG => "No memory card",
        EDS_ERR_TAKE_PICTURE_NO_LENS_NG => "No lens attached",
        EDS_ERR_LOW_BATTERY => "Low battery",
        EDS_ERR_OBJECT_NOTREADY => "Object not ready",
        EDS_ERR_NOT_SUPPORTED => "Not supported",
        EDS_ERR_OPERATION_CANCELLED => "Operation cancelled",
        _ => "Unknown error",
    }
}

/// Convert C string (i8 array) to Rust String
pub fn cstr_to_string(chars: &[i8]) -> String {
    let bytes: Vec<u8> = chars
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).to_string()
}
