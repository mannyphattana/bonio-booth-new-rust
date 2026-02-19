use log::error;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Raw FFI declarations for Win32 print functions not available in the windows crate
#[cfg(target_os = "windows")]
mod print_ffi {
    /// DOCINFOW structure for StartDocW
    #[repr(C)]
    pub struct DOCINFOW {
        pub cb_size: i32,
        pub doc_name: *const u16,
        pub output: *const u16,
        pub datatype: *const u16,
        pub fw_type: u32,
    }

    #[link(name = "gdi32")]
    extern "system" {
        pub fn StartDocW(hdc: isize, lpdi: *const DOCINFOW) -> i32;
        pub fn EndDoc(hdc: isize) -> i32;
        pub fn StartPage(hdc: isize) -> i32;
        pub fn EndPage(hdc: isize) -> i32;
    }

    #[link(name = "winspool")]
    extern "system" {
        pub fn DeviceCapabilitiesW(
            p_device: *const u16,
            p_port: *const u16,
            fw_capability: u16,
            p_output: *mut u16,
            p_dev_mode: *const u8,
        ) -> i32;
    }

    pub const DC_PAPERNAMES: u16 = 16;
    pub const DC_PAPERS: u16 = 2;
}

/// Helper: convert Rust string to null-terminated wide string (UTF-16)
#[cfg(target_os = "windows")]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Query available paper sizes from a printer driver using Win32 DeviceCapabilities API.
/// Returns Vec of (paper_id, paper_name) tuples.
#[cfg(target_os = "windows")]
fn win32_get_paper_sizes(printer_name: &str) -> Result<Vec<(i16, String)>, String> {
    use print_ffi::*;

    let wide_name = to_wide(printer_name);

    unsafe {
        // Get count of paper sizes
        let count = DeviceCapabilitiesW(
            wide_name.as_ptr(),
            std::ptr::null(),
            DC_PAPERNAMES,
            std::ptr::null_mut(),
            std::ptr::null(),
        );

        if count <= 0 {
            return Ok(vec![]);
        }

        let count = count as usize;

        // Get paper names (each name is 64 wide chars)
        let mut names_buf = vec![0u16; count * 64];
        DeviceCapabilitiesW(
            wide_name.as_ptr(),
            std::ptr::null(),
            DC_PAPERNAMES,
            names_buf.as_mut_ptr(),
            std::ptr::null(),
        );

        // Get paper IDs (array of WORD = u16)
        let mut ids_buf = vec![0u16; count];
        DeviceCapabilitiesW(
            wide_name.as_ptr(),
            std::ptr::null(),
            DC_PAPERS,
            ids_buf.as_mut_ptr(),
            std::ptr::null(),
        );

        let mut result = Vec::new();
        for i in 0..count {
            let name_slice = &names_buf[i * 64..(i + 1) * 64];
            let end = name_slice.iter().position(|&c| c == 0).unwrap_or(64);
            let name = String::from_utf16_lossy(&name_slice[..end]);
            result.push((ids_buf[i] as i16, name));
        }

        Ok(result)
    }
}

/// Check if a printer with the given name exists by trying to open it.
#[cfg(target_os = "windows")]
fn win32_printer_exists(printer_name: &str) -> bool {
    use windows::Win32::Graphics::Printing::{OpenPrinterW, ClosePrinter};
    use windows::Win32::Foundation::HANDLE;
    use windows::core::PCWSTR;

    let wide_name = to_wide(printer_name);
    unsafe {
        let mut handle = HANDLE::default();
        let ok = OpenPrinterW(
            PCWSTR(wide_name.as_ptr()),
            &mut handle,
            None,
        ).is_ok();
        if ok {
            let _ = ClosePrinter(handle);
        }
        ok
    }
}

/// Print an image using native Win32 GDI API.
/// No PowerShell, no popup windows, full control over paper size and orientation.
/// Auto-switches to "{printer_name} (CUT)" driver for cut frames if available.
#[cfg(target_os = "windows")]
fn win32_gdi_print(printer_name: &str, image_path: &str, frame_type: &str) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Graphics::Printing::{
        OpenPrinterW, ClosePrinter, DocumentPropertiesW,
    };
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::core::PCWSTR;

    let needs_cut = frame_type == "2x6" || frame_type == "6x2";
    let is_landscape = frame_type == "6x4" || frame_type == "6x2";

    // Auto-switch drivers: if needs_cut, try "{name} (CUT)" variant
    // If no-cut, use base name (strip " (CUT)" suffix if present)
    let actual_printer = if needs_cut {
        let cut_name = if printer_name.to_uppercase().contains("(CUT)") {
            printer_name.to_string()
        } else {
            format!("{} (CUT)", printer_name)
        };
        // Verify CUT printer exists by trying to open it
        if win32_printer_exists(&cut_name) {
            log::info!("[Printer] Auto-switching to CUT driver: '{}'", cut_name);
            cut_name
        } else {
            log::info!("[Printer] CUT driver '{}' not found, using '{}'", cut_name, printer_name);
            printer_name.to_string()
        }
    } else {
        // For no-cut: use base name (without " (CUT)")
        let base_name = printer_name.replace(" (CUT)", "").replace(" (cut)", "");
        if base_name != printer_name && win32_printer_exists(&base_name) {
            log::info!("[Printer] Using base (no-cut) driver: '{}'", base_name);
            base_name
        } else {
            printer_name.to_string()
        }
    };

    log::info!("[Printer] Actual printer for job: '{}'", actual_printer);

    let wide_name = to_wide(&actual_printer);
    let wide_winspool = to_wide("WINSPOOL");

    unsafe {
        // 1. Open printer
        let mut printer_handle = HANDLE::default();
        OpenPrinterW(
            PCWSTR(wide_name.as_ptr()),
            &mut printer_handle,
            None,
        ).map_err(|e| format!("OpenPrinter failed: {}", e))?;

        // 2. Get DEVMODE buffer size
        let dm_size = DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(wide_name.as_ptr()),
            None,
            None,
            0,
        );

        if dm_size < 0 {
            let _ = ClosePrinter(printer_handle);
            return Err("DocumentProperties: failed to get DEVMODE size".into());
        }

        // 3. Get current DEVMODE
        let mut dm_buf = vec![0u8; dm_size as usize];
        let dm_ptr = dm_buf.as_mut_ptr() as *mut DEVMODEW;

        let res = DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(wide_name.as_ptr()),
            Some(dm_ptr),
            None,
            2, // DM_OUT_BUFFER
        );

        if res < 0 {
            let _ = ClosePrinter(printer_handle);
            return Err("DocumentProperties: failed to get DEVMODE".into());
        }

        // 4. Find and set paper size
        let paper_sizes = win32_get_paper_sizes(&actual_printer)?;
        log::info!("[Printer] frame_type=\"{}\" needs_cut={} is_landscape={}", frame_type, needs_cut, is_landscape);
        log::info!("[Printer] Available paper sizes for '{}' ({} found):", actual_printer, paper_sizes.len());
        for (id, name) in &paper_sizes {
            log::info!("[Printer]   id={} name=\"{}\"", id, name);
        }

        let selected = if needs_cut {
            // First try: exact match for "2x6" or "cut"
            let first = paper_sizes.iter().find(|(_, n)| {
                let lower = n.to_lowercase();
                lower.contains("cut") || lower.contains("2x6")
            });
            if first.is_some() {
                log::info!("[Printer] Cut paper found via primary match (cut/2x6)");
                first
            } else {
                // Fallback: any paper with "cut" in the name
                let fallback = paper_sizes.iter().find(|(_, n)| {
                    n.to_lowercase().contains("cut")
                });
                if fallback.is_some() {
                    log::info!("[Printer] Cut paper found via fallback match (any 'cut')");
                }
                fallback
            }
        } else {
            paper_sizes.iter().find(|(_, n)| {
                let lower = n.to_lowercase();
                (lower.contains("4x6") || lower.contains("6x4"))
                    && !lower.contains("cut") && !lower.contains("2x6")
            })
        };

        let dm = &mut *dm_ptr;

        if let Some((paper_id, paper_name)) = selected {
            dm.Anonymous1.Anonymous1.dmPaperSize = *paper_id;
            dm.dmFields |= DM_PAPERSIZE;
            log::info!("[Printer] Selected paper: \"{}\" (id={})", paper_name, paper_id);
        } else {
            log::warn!("[Printer] No matching paper for frame_type={}, using driver default", frame_type);
        }

        // Set orientation
        dm.Anonymous1.Anonymous1.dmOrientation = if is_landscape { 2 } else { 1 };
        dm.dmFields |= DM_ORIENTATION;

        // Apply modified DEVMODE
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(wide_name.as_ptr()),
            Some(dm_ptr),
            Some(dm_ptr as *const _),
            10, // DM_IN_BUFFER(8) | DM_OUT_BUFFER(2)
        );

        let _ = ClosePrinter(printer_handle);

        // 5. Create device context with modified DEVMODE
        let hdc = CreateDCW(
            PCWSTR(wide_winspool.as_ptr()),
            PCWSTR(wide_name.as_ptr()),
            PCWSTR::null(),
            Some(dm_ptr as *const _),
        );

        if hdc.is_invalid() {
            return Err("CreateDC failed".into());
        }

        // 6. Get printable area
        let page_w = GetDeviceCaps(hdc, HORZRES);
        let page_h = GetDeviceCaps(hdc, VERTRES);
        log::info!("[Printer] Page: {}x{} device units", page_w, page_h);

        // 7. Load image and convert to BGRA bottom-up (Windows bitmap format)
        let img = image::open(image_path)
            .map_err(|e| format!("Failed to open image for printing: {}", e))?;
        let rgba = img.to_rgba8();
        let (img_w, img_h) = (rgba.width(), rgba.height());
        let raw = rgba.as_raw();
        let stride = (img_w * 4) as usize;
        let mut bgra = vec![0u8; stride * img_h as usize];
        for y in 0..img_h as usize {
            let src_row = y * stride;
            let dst_row = (img_h as usize - 1 - y) * stride;
            for x in 0..img_w as usize {
                let si = src_row + x * 4;
                let di = dst_row + x * 4;
                bgra[di]     = raw[si + 2]; // B
                bgra[di + 1] = raw[si + 1]; // G
                bgra[di + 2] = raw[si];     // R
                bgra[di + 3] = raw[si + 3]; // A
            }
        }

        // 8. Print
        let doc_name = to_wide("Bonio Booth Print");
        let doc_info = print_ffi::DOCINFOW {
            cb_size: std::mem::size_of::<print_ffi::DOCINFOW>() as i32,
            doc_name: doc_name.as_ptr(),
            output: std::ptr::null(),
            datatype: std::ptr::null(),
            fw_type: 0,
        };

        // Extract raw isize handle for FFI calls
        // CreatedHDC -> HDC -> isize (all repr(transparent))
        let raw_hdc: isize = std::mem::transmute_copy(&hdc);

        if print_ffi::StartDocW(raw_hdc, &doc_info) <= 0 {
            return Err("StartDoc failed".into());
        }

        if print_ffi::StartPage(raw_hdc) <= 0 {
            print_ffi::EndDoc(raw_hdc);
            return Err("StartPage failed".into());
        }

        SetStretchBltMode(hdc, HALFTONE);

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: img_w as i32,
                biHeight: img_h as i32,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD::default()],
        };

        StretchDIBits(
            hdc,
            0, 0, page_w, page_h,
            0, 0, img_w as i32, img_h as i32,
            Some(bgra.as_ptr() as *const _),
            &bmi,
            DIB_RGB_COLORS,
            SRCCOPY,
        );

        print_ffi::EndPage(raw_hdc);
        print_ffi::EndDoc(raw_hdc);

        log::info!("[Printer] Print job sent successfully via Win32 GDI");
        Ok(())
    }
}

/// Create a Command that hides the console window on Windows
fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrinterInfo {
    pub name: String,
    pub status: String,
    pub is_online: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DslrCameraInfo {
    pub name: String,
    pub device_id: String,
}

#[tauri::command]
pub async fn list_dslr_cameras() -> Result<Vec<DslrCameraInfo>, String> {
    // Use PowerShell to detect imaging devices (PTP cameras, DSLRs)
    let ps_cmd = r#"
        $devices = @()
        # Check PnP Image class devices (cameras in PTP mode)
        try {
            $imgDevices = Get-PnpDevice -Class Image -Status OK -ErrorAction SilentlyContinue
            foreach ($d in $imgDevices) {
                $devices += [PSCustomObject]@{
                    Name = $d.FriendlyName
                    DeviceId = $d.InstanceId
                }
            }
        } catch {}
        # Check WPD devices as fallback (cameras sometimes show here)
        try {
            $wpdDevices = Get-PnpDevice -Class WPD -Status OK -ErrorAction SilentlyContinue
            foreach ($d in $wpdDevices) {
                if ($d.FriendlyName -notlike '*Phone*' -and $d.FriendlyName -notlike '*MTP*') {
                    $devices += [PSCustomObject]@{
                        Name = $d.FriendlyName
                        DeviceId = $d.InstanceId
                    }
                }
            }
        } catch {}
        if ($devices.Count -eq 0) { "[]" } else { $devices | ConvertTo-Json }
    "#;

    let output = hidden_command("powershell")
        .args(&["-NoProfile", "-Command", ps_cmd])
        .output()
        .map_err(|e| format!("Failed to list DSLR cameras: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(vec![]);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&stdout.trim()).map_err(|e| format!("Parse error: {}", e))?;

    let devices_array = if parsed.is_array() {
        parsed.as_array().unwrap().clone()
    } else {
        vec![parsed]
    };

    let cameras: Vec<DslrCameraInfo> = devices_array
        .iter()
        .map(|d| DslrCameraInfo {
            name: d.get("Name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
            device_id: d.get("DeviceId").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        })
        .filter(|c| !c.name.is_empty())
        .collect();

    Ok(cameras)
}

#[tauri::command]
pub async fn get_printers() -> Result<Vec<PrinterInfo>, String> {
    // Use Win32_Printer (WMI/CIM) instead of Get-Printer cmdlet.
    // Win32_Printer reflects physical USB disconnect much faster than Get-Printer.
    // WorkOffline from Get-Printer often stays false even after USB unplug.
    //
    // We also cross-check with Get-PnpDevice for USB printers —
    // if the USB device is physically gone, mark the printer as offline
    // regardless of what WMI reports.
    let ps_cmd = r#"
        $printers = Get-CimInstance Win32_Printer | Select-Object Name,
            @{N='PrinterStatus';E={$_.PrinterState}},
            WorkOffline
        # Get list of currently connected USB printer PnP devices
        $usbPrinters = @()
        try {
            $pnp = Get-PnpDevice -Class Printer -Status OK -ErrorAction SilentlyContinue
            foreach ($d in $pnp) { $usbPrinters += $d.FriendlyName }
        } catch {}
        # Build result: mark USB printers as offline if PnP device is gone
        $result = @()
        foreach ($p in $printers) {
            $portInfo = Get-PrinterPort -Name (Get-Printer -Name $p.Name -ErrorAction SilentlyContinue).PortName -ErrorAction SilentlyContinue
            $isUsb = $false
            if ($portInfo -and $portInfo.Description -like '*USB*') { $isUsb = $true }
            # For USB printers: cross-check with PnP device list
            $pnpConnected = $true
            if ($isUsb) {
                $pnpConnected = $usbPrinters -contains $p.Name
            }
            $result += [PSCustomObject]@{
                Name = $p.Name
                PrinterStatus = $p.PrinterStatus
                WorkOffline = $p.WorkOffline
                PnpConnected = $pnpConnected
                IsUsb = $isUsb
            }
        }
        if ($result.Count -eq 0) { "[]" } else { $result | ConvertTo-Json }
    "#;

    let output = hidden_command("powershell")
        .args(&["-NoProfile", "-Command", ps_cmd])
        .output()
        .map_err(|e| format!("Failed to get printers: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(vec![]);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&stdout.trim()).map_err(|e| format!("Parse error: {}", e))?;

    let printers_array = if parsed.is_array() {
        parsed.as_array().unwrap().clone()
    } else {
        vec![parsed]
    };

    let printers: Vec<PrinterInfo> = printers_array
        .iter()
        .map(|p| {
            let name = p
                .get("Name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            let status_num = p
                .get("PrinterStatus")
                .and_then(|s| s.as_u64())
                .unwrap_or(0);
            let work_offline = p
                .get("WorkOffline")
                .and_then(|w| w.as_bool())
                .unwrap_or(false);
            let pnp_connected = p
                .get("PnpConnected")
                .and_then(|w| w.as_bool())
                .unwrap_or(true);
            let is_usb = p
                .get("IsUsb")
                .and_then(|w| w.as_bool())
                .unwrap_or(false);

            let status = match status_num {
                0 => "Normal".to_string(),
                1 => "Paused".to_string(),
                2 => "Error".to_string(),
                3 => "Deleting".to_string(),
                4 => "PaperJam".to_string(),
                5 => "PaperOut".to_string(),
                _ => format!("Unknown({})", status_num),
            };

            // Printer is online only if:
            // 1. Not marked as WorkOffline
            // 2. Status is Normal (0), Printing (1024), Processing (128), or Busy (10)
            //    (Win32_Printer.PrinterState values: 0=Idle, 1=Paused, 2=Error, 3=Deleting, 4=PaperJam, 5=PaperOut)
            //    Common active states: 1024 (Printing), 128 (Processing)
            // 3. For USB printers: PnP device must be physically present
            //
            // We treat 0 (Normal) and specific active states as "Online".
            // We treat Error(2), PaperJam(4), PaperOut(5) as "Offline/Error".
            let is_online = !work_offline
                && (status_num == 0 || status_num == 1024 || status_num == 128 || status_num == 10)
                && (!is_usb || pnp_connected);

            PrinterInfo {
                name,
                is_online,
                status,
            }
        })
        .collect();

    Ok(printers)
}

#[tauri::command]
pub async fn check_printer_status(printer_name: String) -> Result<PrinterInfo, String> {
    // Use same detection logic as get_printers: WMI + PnP cross-check
    let ps_cmd = format!(
        r#"
        $p = Get-CimInstance Win32_Printer -Filter "Name='{}'" | Select-Object Name, @{{N='PrinterStatus';E={{$_.PrinterState}}}}, WorkOffline
        if (-not $p) {{ Write-Output ''; exit }}
        $portInfo = Get-PrinterPort -Name (Get-Printer -Name '{}' -ErrorAction SilentlyContinue).PortName -ErrorAction SilentlyContinue
        $isUsb = $false
        if ($portInfo -and $portInfo.Description -like '*USB*') {{ $isUsb = $true }}
        $pnpConnected = $true
        if ($isUsb) {{
            $pnp = @()
            try {{ $pnp = Get-PnpDevice -Class Printer -Status OK -ErrorAction SilentlyContinue | ForEach-Object {{ $_.FriendlyName }} }} catch {{}}
            $pnpConnected = $pnp -contains $p.Name
        }}
        [PSCustomObject]@{{
            Name = $p.Name
            PrinterStatus = $p.PrinterStatus
            WorkOffline = $p.WorkOffline
            PnpConnected = $pnpConnected
            IsUsb = $isUsb
        }} | ConvertTo-Json
        "#,
        printer_name.replace('\'', "''"),
        printer_name.replace('\'', "''")
    );

    let output = hidden_command("powershell")
        .args(&["-NoProfile", "-Command", &ps_cmd])
        .output()
        .map_err(|e| format!("Failed to check printer: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if stdout.trim().is_empty() {
        return Err(format!("Printer '{}' not found", printer_name));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&stdout.trim()).map_err(|e| format!("Parse error: {}", e))?;

    let name = parsed
        .get("Name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let status_num = parsed
        .get("PrinterStatus")
        .and_then(|s| s.as_u64())
        .unwrap_or(0);
    let work_offline = parsed
        .get("WorkOffline")
        .and_then(|w| w.as_bool())
        .unwrap_or(false);
    let pnp_connected = parsed
        .get("PnpConnected")
        .and_then(|w| w.as_bool())
        .unwrap_or(true);
    let is_usb = parsed
        .get("IsUsb")
        .and_then(|w| w.as_bool())
        .unwrap_or(false);

    let status = match status_num {
        0 => "Normal".to_string(),
        1 => "Paused".to_string(),
        2 => "Error".to_string(),
        _ => format!("Unknown({})", status_num),
    };

    Ok(PrinterInfo {
        name,
        is_online: !work_offline && status_num == 0 && (!is_usb || pnp_connected),
        status,
    })
}

#[tauri::command]
pub async fn print_photo(
    image_path: String,
    printer_name: String,
    frame_type: String,
    scale: Option<f64>,
    vertical_offset: Option<f64>,
    horizontal_offset: Option<f64>,
    _is_landscape: Option<bool>,
) -> Result<bool, String> {
    let scale_val = scale.unwrap_or(100.0);
    let vert_val = vertical_offset.unwrap_or(0.0);
    let horiz_val = horizontal_offset.unwrap_or(0.0);

    // Load original image (auto-detect format from content, not extension)
    let img = {
        let reader = image::io::Reader::open(&image_path)
            .map_err(|e| format!("Failed to open image file: {}", e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess image format: {}", e))?;
        reader.decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?
    };

    let original_width = img.width();
    let original_height = img.height();

    // Apply scale: zoom content within fixed output dimensions
    let scale_factor = scale_val / 100.0;

    let scaled_w = (original_width as f64 * scale_factor) as u32;
    let scaled_h = (original_height as f64 * scale_factor) as u32;

    let processed: image::DynamicImage = if scale_factor < 1.0 {
        // Zoom out: shrink content, white padding
        let resized = img.resize_exact(scaled_w, scaled_h, image::imageops::FilterType::Lanczos3);

        let pad_h = ((original_width as f64 - scaled_w as f64) / 2.0) as i64;
        let pad_v = ((original_height as f64 - scaled_h as f64) / 2.0) as i64;

        let mut canvas = image::RgbaImage::from_pixel(
            original_width,
            original_height,
            image::Rgba([255, 255, 255, 255]),
        );

        let paste_x = (pad_h as f64 + horiz_val).max(0.0) as u32;
        let paste_y = (pad_v as f64 + vert_val).max(0.0) as u32;

        image::imageops::overlay(&mut canvas, &resized.to_rgba8(), paste_x as i64, paste_y as i64);
        image::DynamicImage::ImageRgba8(canvas)
    } else if scale_factor > 1.0 {
        // Zoom in: enlarge content, crop center
        let resized = img.resize_exact(scaled_w, scaled_h, image::imageops::FilterType::Lanczos3);

        let crop_x = (((scaled_w as f64 - original_width as f64) / 2.0) - horiz_val)
            .max(0.0)
            .min((scaled_w - original_width) as f64) as u32;
        let crop_y = (((scaled_h as f64 - original_height as f64) / 2.0) - vert_val)
            .max(0.0)
            .min((scaled_h - original_height) as f64) as u32;

        resized.crop_imm(crop_x, crop_y, original_width, original_height)
    } else {
        // scale = 100%, just apply offset if any
        if horiz_val.abs() > 0.1 || vert_val.abs() > 0.1 {
            let mut canvas = image::RgbaImage::from_pixel(
                original_width,
                original_height,
                image::Rgba([255, 255, 255, 255]),
            );
            image::imageops::overlay(
                &mut canvas,
                &img.to_rgba8(),
                horiz_val as i64,
                vert_val as i64,
            );
            image::DynamicImage::ImageRgba8(canvas)
        } else {
            img
        }
    };

    // For cut frames: duplicate image to fill the full 4x6 paper so the printer can cut
    // 2x6 (portrait-cut): place two copies side-by-side → 4x6 paper
    // 6x2 (landscape-cut): place two copies top-to-bottom → 6x4 paper
    let final_image: image::DynamicImage = match frame_type.as_str() {
        "2x6" => {
            let w = processed.width();
            let h = processed.height();
            let mut canvas = image::RgbaImage::from_pixel(w * 2, h, image::Rgba([255, 255, 255, 255]));
            image::imageops::overlay(&mut canvas, &processed.to_rgba8(), 0, 0);
            image::imageops::overlay(&mut canvas, &processed.to_rgba8(), w as i64, 0);
            image::DynamicImage::ImageRgba8(canvas)
        }
        "6x2" => {
            let w = processed.width();
            let h = processed.height();
            let mut canvas = image::RgbaImage::from_pixel(w, h * 2, image::Rgba([255, 255, 255, 255]));
            image::imageops::overlay(&mut canvas, &processed.to_rgba8(), 0, 0);
            image::imageops::overlay(&mut canvas, &processed.to_rgba8(), 0, h as i64);
            image::DynamicImage::ImageRgba8(canvas)
        }
        _ => processed,
    };

    // Save final image to temp PNG
    let temp_dir = std::env::temp_dir().join("bonio-booth");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_path = temp_dir.join("print-processed.png");
    final_image
        .save(&temp_path)
        .map_err(|e| format!("Failed to save processed image: {}", e))?;

    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Print using native Win32 GDI API - no PowerShell, no popup windows
    #[cfg(target_os = "windows")]
    {
        win32_gdi_print(&printer_name, &temp_path_str, &frame_type)
            .map(|_| true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = hidden_command("lpr")
            .args(&["-P", &printer_name, &temp_path_str])
            .output()
            .map_err(|e| format!("Print failed: {}", e))?;

        if output.status.success() {
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Print error: {}", stderr))
        }
    }
}

#[tauri::command]
pub async fn print_test_photo(
    app: tauri::AppHandle,
    printer_name: String,
    scale: f64,
    vertical_offset: f64,
    horizontal_offset: f64,
    frame_type: String,
) -> Result<bool, String> {
    // Find test.jpg - check multiple possible locations
    let test_image_path = {
        let mut found_path: Option<String> = None;
        let mut searched: Vec<String> = Vec::new();

        // Helper: check a path and track it
        let mut try_path = |p: std::path::PathBuf| -> bool {
            let exists = p.exists();
            searched.push(format!("{} ({})", p.to_string_lossy(), if exists { "FOUND" } else { "not found" }));
            if exists && found_path.is_none() {
                found_path = Some(p.to_string_lossy().to_string());
            }
            exists
        };

        // File name pattern: "Print test {frame_type}.png" e.g. "Print test 4x6.png"
        let test_filename = format!("Print test {}.png", frame_type);

        // 1. Resource directory (Tauri bundled)
        if let Ok(resource_dir) = app.path().resource_dir() {
            try_path(resource_dir.join(&test_filename));
        }

        // 2. Next to executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                try_path(exe_dir.join(&test_filename));
                // NSIS _up_ directory
                try_path(exe_dir.join("_up_").join(&test_filename));
                // Dev mode: walk up to project root
                let mut dir = exe_dir.to_path_buf();
                for _ in 0..5 {
                    if let Some(parent) = dir.parent() {
                        dir = parent.to_path_buf();
                        try_path(dir.join("public").join(&test_filename));
                        try_path(dir.join(&test_filename));
                    } else {
                        break;
                    }
                }
            }
        }

        // 3. CWD
        if let Ok(cwd) = std::env::current_dir() {
            try_path(cwd.join(&test_filename));
            try_path(cwd.join("public").join(&test_filename));
        }

        // Log all searched paths for debugging
        let search_log = searched.join("\n  ");
        if found_path.is_some() {
            log::info!("[Printer] test.jpg search:\n  {}", search_log);
        }

        found_path.ok_or_else(|| {
            let msg = format!("{} not found. Searched paths:\n  {}", test_filename, search_log);
            error!("[Printer] {}", msg);
            msg
        })?
    };

    let is_landscape = frame_type == "6x4" || frame_type == "6x2";

    print_photo(
        test_image_path,
        printer_name,
        frame_type,
        Some(scale),
        Some(vertical_offset),
        Some(horizontal_offset),
        Some(is_landscape),
    )
    .await
}

#[tauri::command]
pub async fn reduce_paper_level(
    state: tauri::State<'_, crate::api::AppState>,
    copies: i32,
) -> Result<crate::api::ApiResponse, String> {
    let machine_id = state.machine_id.lock().unwrap().clone();
    let machine_port = state.machine_port.lock().unwrap().clone();
    let client = &state.http_client;
    let url = format!(
        "https://api-booth.boniolabs.com/api/machines/{}",
        machine_id
    );

    let res = client
        .patch(&url)
        .header("X-Machine-Id", &machine_id)
        .header("X-Machine-Port", &machine_port)
        .json(&serde_json::json!({
            "reducePaper": copies
        }))
        .send()
        .await
        .map_err(|e| format!("Request error: {}", e))?;

    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| format!("Parse error: {}", e))?;

    Ok(crate::api::ApiResponse {
        success: status.is_success(),
        data: Some(body),
        error: if !status.is_success() {
            Some(format!("Status: {}", status))
        } else {
            None
        },
    })
}

/// Get available paper sizes for a specific printer (for debugging and UI)
#[tauri::command]
pub async fn get_printer_paper_sizes(printer_name: String) -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let paper_sizes = win32_get_paper_sizes(&printer_name)?;
        Ok(paper_sizes.iter().map(|(id, name)| format!("{} (id={})", name, id)).collect())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = printer_name;
        Ok(vec!["Paper size query not supported on this platform".to_string()])
    }
}
