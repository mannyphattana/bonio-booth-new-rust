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
    let output = hidden_command("powershell")
        .args(&[
            "-NoProfile",
            "-Command",
            "Get-Printer | Select-Object Name, PrinterStatus, WorkOffline | ConvertTo-Json",
        ])
        .output()
        .map_err(|e| format!("Failed to get printers: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    if stdout.trim().is_empty() {
        return Ok(vec![]);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Parse error: {}", e))?;

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

            let status = match status_num {
                0 => "Normal".to_string(),
                1 => "Paused".to_string(),
                2 => "Error".to_string(),
                3 => "Deleting".to_string(),
                4 => "PaperJam".to_string(),
                5 => "PaperOut".to_string(),
                _ => format!("Unknown({})", status_num),
            };

            PrinterInfo {
                name,
                is_online: !work_offline && status_num == 0,
                status,
            }
        })
        .collect();

    Ok(printers)
}

#[tauri::command]
pub async fn check_printer_status(printer_name: String) -> Result<PrinterInfo, String> {
    let ps_cmd = format!(
        "Get-Printer -Name '{}' | Select-Object Name, PrinterStatus, WorkOffline | ConvertTo-Json",
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
        serde_json::from_str(&stdout).map_err(|e| format!("Parse error: {}", e))?;

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

    let status = match status_num {
        0 => "Normal".to_string(),
        1 => "Paused".to_string(),
        2 => "Error".to_string(),
        _ => format!("Unknown({})", status_num),
    };

    Ok(PrinterInfo {
        name,
        is_online: !work_offline && status_num == 0,
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
    // For DNP QW-410:
    // 2x6 -> need to print on 4x6 and cut
    // 4x6 or 6x4 -> no cut needed

    let _needs_cut = frame_type == "2x6";
    let scale_val = scale.unwrap_or(100.0);
    let vert_val = vertical_offset.unwrap_or(0.0);
    let horiz_val = horizontal_offset.unwrap_or(0.0);
    let landscape = is_landscape.unwrap_or(false);

    // Build PowerShell script with position adjustments
    let ps_script = format!(
        r#"
        Add-Type -AssemblyName System.Drawing
        $img = [System.Drawing.Image]::FromFile('{image_path}')
        $pd = New-Object System.Drawing.Printing.PrintDocument
        $pd.PrinterSettings.PrinterName = '{printer_name}'
        $pd.DefaultPageSettings.Landscape = ${landscape_str}
        $pd.DocumentName = 'BonioBooth_{frame_type}'
        $pd.add_PrintPage({{
            param($sender, $e)
            $bounds = $e.MarginBounds
            $scale = {scale_val} / 100.0
            $newW = $bounds.Width * $scale
            $newH = $bounds.Height * $scale
            $offsetX = ($bounds.Width - $newW) / 2 + $bounds.X + ({horiz_val})
            $offsetY = ($bounds.Height - $newH) / 2 + $bounds.Y + ({vert_val})
            $destRect = New-Object System.Drawing.RectangleF($offsetX, $offsetY, $newW, $newH)
            $e.Graphics.DrawImage($img, $destRect)
        }})
        $pd.Print()
        $img.Dispose()
        $pd.Dispose()
        "#,
        image_path = image_path.replace('\\', "\\\\").replace('\'', "''"),
        printer_name = printer_name.replace('\'', "''"),
        landscape_str = if landscape { "true" } else { "false" },
        frame_type = frame_type,
        scale_val = scale_val,
        horiz_val = horiz_val,
        vert_val = vert_val,
    );

    let output = hidden_command("powershell")
        .args(&["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Print failed: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Print error: {}", stderr))
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

        // Check resource directory
        if let Ok(resource_dir) = app.path().resource_dir() {
            let test_path = resource_dir.join("test.jpg");
            if test_path.exists() {
                found_path = Some(test_path.to_string_lossy().to_string());
            }
        }

        // Check relative to executable
        if found_path.is_none() {
            if let Ok(exe_path) = std::env::current_exe() {
                if let Some(exe_dir) = exe_path.parent() {
                    let test_path = exe_dir.join("test.jpg");
                    if test_path.exists() {
                        found_path = Some(test_path.to_string_lossy().to_string());
                    }
                    // Dev mode: check parent directories
                    if found_path.is_none() {
                        if let Some(parent) = exe_dir.parent() {
                            if let Some(gp) = parent.parent() {
                                if let Some(ggp) = gp.parent() {
                                    let test_path = ggp.join("public").join("test.jpg");
                                    if test_path.exists() {
                                        found_path = Some(test_path.to_string_lossy().to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check CWD
        if found_path.is_none() {
            if let Ok(cwd) = std::env::current_dir() {
                let test_path = cwd.join("public").join("test.jpg");
                if test_path.exists() {
                    found_path = Some(test_path.to_string_lossy().to_string());
                }
            }
        }

        found_path.ok_or_else(|| "test.jpg not found".to_string())?
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
