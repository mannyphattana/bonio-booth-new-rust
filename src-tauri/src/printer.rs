use log::error;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
            // 2. Status is Normal (0)
            // 3. For USB printers: PnP device must be physically present
            let is_online = !work_offline
                && status_num == 0
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
    is_landscape: Option<bool>,
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

    // Save processed image to temp PNG
    let temp_dir = std::env::temp_dir().join("bonio-booth");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let temp_path = temp_dir.join("print-processed.png");
    processed
        .save(&temp_path)
        .map_err(|e| format!("Failed to save processed image: {}", e))?;

    let temp_path_str = temp_path.to_string_lossy().to_string();

    // Print using rundll32 shimgvw.dll (same as old project)
    // This delegates all fit-to-page logic to the printer driver
    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("rundll32")
            .args(&[
                "shimgvw.dll,ImageView_PrintTo",
                "/pt",
                &temp_path_str,
                &printer_name,
            ])
            .output()
            .map_err(|e| format!("Print failed: {}", e))?;

        if output.status.success() {
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Print error: {}", stderr))
        }
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
    is_landscape: bool,
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

        // 1. Resource directory (Tauri bundled)
        if let Ok(resource_dir) = app.path().resource_dir() {
            try_path(resource_dir.join("test.jpg"));
        }

        // 2. Next to executable
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                try_path(exe_dir.join("test.jpg"));
                // NSIS _up_ directory
                try_path(exe_dir.join("_up_").join("test.jpg"));
                // Dev mode: walk up to project root
                let mut dir = exe_dir.to_path_buf();
                for _ in 0..5 {
                    if let Some(parent) = dir.parent() {
                        dir = parent.to_path_buf();
                        try_path(dir.join("public").join("test.jpg"));
                        try_path(dir.join("test.jpg"));
                    } else {
                        break;
                    }
                }
            }
        }

        // 3. CWD
        if let Ok(cwd) = std::env::current_dir() {
            try_path(cwd.join("test.jpg"));
            try_path(cwd.join("public").join("test.jpg"));
        }

        // Log all searched paths for debugging
        let search_log = searched.join("\n  ");
        if found_path.is_some() {
            log::info!("[Printer] test.jpg search:\n  {}", search_log);
        }

        found_path.ok_or_else(|| {
            let msg = format!("test.jpg not found. Searched paths:\n  {}", search_log);
            error!("[Printer] {}", msg);
            msg
        })?
    };

    let frame_type = if is_landscape { "6x4" } else { "4x6" };

    print_photo(
        test_image_path,
        printer_name,
        frame_type.to_string(),
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
