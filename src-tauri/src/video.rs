use base64::{engine::general_purpose::STANDARD, Engine};
use image::GenericImageView;
use std::fs;
use std::path::Path;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Create a Command that hides the console window on Windows
fn hidden_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Get the FFmpeg binary path
/// Checks: 1) next to exe (production) 2) node_modules/@ffmpeg-installer (dev) 3) system PATH
fn get_ffmpeg_path() -> String {
    let ffmpeg_bin = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };

    // 1. Check next to the executable (production bundled)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let ffmpeg = exe_dir.join(ffmpeg_bin);
            if ffmpeg.exists() {
                return ffmpeg.to_string_lossy().to_string();
            }
        }
    }

    // 2. Check node_modules/@ffmpeg-installer (installed via npm)
    let platform_dir = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") { "win32-x64" } else { "win32-ia32" }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") { "darwin-arm64" } else { "darwin-x64" }
    } else {
        if cfg!(target_arch = "x86_64") { "linux-x64" } else { "linux-ia32" }
    };
    let rel_path = format!("node_modules/@ffmpeg-installer/{}/{}", platform_dir, ffmpeg_bin);

    if let Ok(cwd) = std::env::current_dir() {
        // Check from CWD (e.g., src-tauri/)
        let check = cwd.join(&rel_path);
        if check.exists() {
            return check.to_string_lossy().to_string();
        }
        // Check from parent (project root)
        if let Some(parent) = cwd.parent() {
            let check = parent.join(&rel_path);
            if check.exists() {
                return check.to_string_lossy().to_string();
            }
        }
    }

    // 3. Fallback to system PATH
    "ffmpeg".to_string()
}

/// Copy LUT file to temp directory and return just the filename.
/// This avoids all FFmpeg filter path escaping issues by using cwd instead of absolute paths.
fn prepare_lut_in_temp(lut_path: &str, temp_dir: &Path) -> Result<String, String> {
    let lut_src = Path::new(lut_path);
    let lut_filename = lut_src
        .file_name()
        .ok_or_else(|| format!("Invalid LUT path: {}", lut_path))?
        .to_string_lossy()
        .to_string();
    let temp_lut = temp_dir.join(&lut_filename);
    fs::copy(lut_src, &temp_lut)
        .map_err(|e| format!("Failed to copy LUT to temp: {}", e))?;
    Ok(lut_filename)
}

/// Ensure FFmpeg is available (from @ffmpeg-installer/ffmpeg or system PATH)
#[tauri::command]
pub async fn ensure_ffmpeg() -> Result<bool, String> {
    let path = get_ffmpeg_path();
    if path != "ffmpeg" {
        // Found a concrete binary path
        return Ok(true);
    }
    // Check system PATH
    match hidden_command("ffmpeg").arg("-version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Check if FFmpeg is available on the system
#[tauri::command]
pub async fn check_ffmpeg_available() -> Result<bool, String> {
    let path = get_ffmpeg_path();
    if path != "ffmpeg" {
        return Ok(true);
    }
    match hidden_command("ffmpeg").arg("-version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

/// Save a video blob (base64-encoded) to a temp file
#[tauri::command]
pub async fn save_temp_video(
    video_data_base64: String,
    filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    let file_path = temp_dir.join(&filename);

    let clean = if video_data_base64.contains(",") {
        video_data_base64.split(',').nth(1).unwrap_or(&video_data_base64)
    } else {
        &video_data_base64
    };

    let bytes = STANDARD
        .decode(clean)
        .map_err(|e| format!("Decode error: {}", e))?;

    fs::write(&file_path, &bytes).map_err(|e| format!("Write error: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Loop a 3-second video to create a 9-second video using ffmpeg
/// NOTE: Kept for standalone use. For framed video output, use compose_frame_video instead.
#[tauri::command]
pub async fn create_looped_video(
    input_path: String,
    output_filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    let output_path = temp_dir.join(&output_filename);

    // Use ffmpeg to loop video 3 times (3s * 3 = 9s)
    let ffmpeg = get_ffmpeg_path();
    let status = hidden_command(&ffmpeg)
        .args(&[
            "-y",
            "-stream_loop",
            "2", // loop 2 additional times (total 3x)
            "-i",
            &input_path,
            "-t",
            "9", // force exactly 9 seconds
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("FFmpeg error: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("FFmpeg failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Apply LUT filter to video using ffmpeg
#[tauri::command]
pub async fn apply_lut_to_video(
    input_path: String,
    lut_path: String,
    output_filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    let output_path = temp_dir.join(&output_filename);

    if lut_path.is_empty() {
        // No filter - just copy
        fs::copy(&input_path, &output_path).map_err(|e| format!("Copy error: {}", e))?;
        return Ok(output_path.to_string_lossy().to_string());
    }

    // Copy LUT to temp dir and use just the filename (avoids path escaping issues)
    let lut_filename = prepare_lut_in_temp(&lut_path, &temp_dir)?;
    let lut_filter = format!("lut3d={}", lut_filename);

    let ffmpeg = get_ffmpeg_path();
    let status = hidden_command(&ffmpeg)
        .current_dir(&temp_dir)
        .args(&[
            "-y",
            "-i",
            &input_path,
            "-vf",
            &lut_filter,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("FFmpeg error: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("FFmpeg LUT failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Convert WebM to MP4 using ffmpeg
#[tauri::command]
pub async fn convert_video_to_mp4(
    input_path: String,
    output_filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    let output_path = temp_dir.join(&output_filename);

    let ffmpeg = get_ffmpeg_path();
    let status = hidden_command(&ffmpeg)
        .args(&[
            "-y",
            "-i",
            &input_path,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-movflags",
            "+faststart",
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("FFmpeg error: {}", e))?;

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("FFmpeg convert failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Process frame videos: loop to 9s, apply filter, and prepare for upload
#[tauri::command]
pub async fn process_frame_video(
    video_path: String,
    lut_path: String,
    output_filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    // Step 1: Loop to 9 seconds
    let ffmpeg = get_ffmpeg_path();
    let looped_path = temp_dir.join("looped_temp.mp4");
    let loop_status = hidden_command(&ffmpeg)
        .args(&[
            "-y",
            "-stream_loop", "2",
            "-i", &video_path,
            "-t", "9",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            &looped_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("FFmpeg loop error: {}", e))?;

    if !loop_status.status.success() {
        let stderr = String::from_utf8_lossy(&loop_status.stderr);
        return Err(format!("FFmpeg loop failed: {}", stderr));
    }

    // Step 2: Apply LUT filter if provided
    let output_path = temp_dir.join(&output_filename);

    if !lut_path.is_empty() && Path::new(&lut_path).exists() {
        // Copy LUT to temp dir and use just the filename (avoids path escaping issues)
        let lut_filename = prepare_lut_in_temp(&lut_path, &temp_dir)?;
        let lut_filter = format!("lut3d={}", lut_filename);

        let filter_status = hidden_command(&ffmpeg)
            .current_dir(&temp_dir)
            .args(&[
                "-y",
                "-i", &looped_path.to_string_lossy(),
                "-vf", &lut_filter,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-movflags", "+faststart",
                &output_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("FFmpeg filter error: {}", e))?;

        if !filter_status.status.success() {
            let stderr = String::from_utf8_lossy(&filter_status.stderr);
            return Err(format!("FFmpeg filter failed: {}", stderr));
        }

        // Clean up temp
        let _ = fs::remove_file(&looped_path);
    } else {
        fs::rename(&looped_path, &output_path)
            .map_err(|e| format!("Rename error: {}", e))?;
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Compose multiple videos into a single framed video using a SINGLE FFmpeg call.
/// Handles: loop (3s→9s), LUT filter, scale/crop to slots, overlay on frame image.
/// This replaces the old multi-pass pipeline (loop → LUT → compose) with one efficient pass.
/// Output: 9-second video at 1080p equivalent resolution.
#[tauri::command]
pub async fn compose_frame_video(
    frame_image_url: String,
    video_paths: Vec<String>,
    slots: Vec<serde_json::Value>,
    frame_width: u32,
    frame_height: u32,
    lut_path: Option<String>,
    output_filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth").join("videos");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create dir error: {}", e))?;

    // Download frame image to temp
    let frame_path = temp_dir.join("frame_overlay.png");
    let client = reqwest::Client::new();
    let frame_bytes = client.get(&frame_image_url)
        .send()
        .await
        .map_err(|e| format!("Frame download error: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Frame bytes error: {}", e))?;
    fs::write(&frame_path, &frame_bytes)
        .map_err(|e| format!("Frame write error: {}", e))?;

    // Get frame image actual dimensions for scaling
    let frame_img = image::load_from_memory(&frame_bytes)
        .map_err(|e| format!("Frame load error: {}", e))?;
    let (orig_w, orig_h) = frame_img.dimensions();

    // Scale output to 1080p equivalent (matching old project)
    let is_portrait = orig_h > orig_w;
    let (mut out_w, mut out_h) = if is_portrait {
        let tw = 1080u32;
        let th = (tw as f64 * (orig_h as f64 / orig_w as f64)).round() as u32;
        (tw, th)
    } else {
        let th = 720u32;
        let tw = (th as f64 * (orig_w as f64 / orig_h as f64)).round() as u32;
        (tw, th)
    };
    if out_w % 2 != 0 { out_w += 1; }
    if out_h % 2 != 0 { out_h += 1; }

    let scale_x = out_w as f64 / frame_width as f64;
    let scale_y = out_h as f64 / frame_height as f64;

    // Prepare LUT if provided
    let lut_filename = match &lut_path {
        Some(lp) if !lp.is_empty() && Path::new(lp).exists() => {
            Some(prepare_lut_in_temp(lp, &temp_dir)?)
        }
        _ => None,
    };

    println!("[compose_frame_video] frame: {}x{}, output: {}x{}, grid: {}x{}, scale: {:.3}/{:.3}, lut: {:?}",
        orig_w, orig_h, out_w, out_h, frame_width, frame_height, scale_x, scale_y, lut_filename);

    let num_videos = video_paths.len().min(slots.len());
    let output_path = temp_dir.join(&output_filename);

    // Build FFmpeg arguments
    let mut final_args: Vec<String> = vec!["-y".to_string()];

    // Add video inputs with -stream_loop 2 (raw 3s → 9s)
    for i in 0..num_videos {
        final_args.extend(vec![
            "-stream_loop".to_string(), "2".to_string(),
            "-i".to_string(), video_paths[i].clone(),
        ]);
    }
    // Frame image as last input
    final_args.extend(vec!["-i".to_string(), frame_path.to_string_lossy().to_string()]);

    // Build filter_complex: scale → [lut] → crop → format → overlay
    let mut filter_parts: Vec<String> = Vec::new();

    for i in 0..num_videos {
        let slot = &slots[i];
        let sw = (slot.get("width").and_then(|v| v.as_f64()).unwrap_or(100.0) * scale_x).round() as i64;
        let sh = (slot.get("height").and_then(|v| v.as_f64()).unwrap_or(100.0) * scale_y).round() as i64;

        // Chain: scale to cover → crop to exact slot → optional LUT → format → reset pts
        let mut chain = format!(
            "[{}:v]scale={}:{}:force_original_aspect_ratio=increase,crop={}:{}",
            i, sw, sh, sw, sh
        );
        if let Some(ref lut_fn) = lut_filename {
            chain.push_str(&format!(",lut3d={}", lut_fn));
        }
        chain.push_str(&format!(",format=yuv420p,setpts=PTS-STARTPTS[v{}]", i));
        filter_parts.push(chain);
    }

    // Frame image scaled to output size (with alpha)
    filter_parts.push(format!(
        "[{}:v]scale={}:{},format=yuva420p[frame_img]",
        num_videos, out_w, out_h
    ));

    // White background
    filter_parts.push(format!("color=c=white:s={}x{}:d=9:r=30[bg]", out_w, out_h));

    // Chain overlays: bg → background videos → frame → foreground videos
    let mut prev = "bg".to_string();

    // Background slots (zIndex < 0)
    for i in 0..num_videos {
        let slot = &slots[i];
        let sx = (slot.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_x).round() as i64;
        let sy = (slot.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_y).round() as i64;
        let z_index = slot.get("zIndex").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
        if z_index < 0 {
            let out = format!("b{}", i);
            filter_parts.push(format!("[{}][v{}]overlay={}:{}:eof_action=repeat[{}]", prev, i, sx, sy, out));
            prev = out;
        }
    }

    // Frame overlay (eof_action=repeat so the single-frame PNG repeats for full duration)
    filter_parts.push(format!("[{}][frame_img]overlay=0:0:eof_action=repeat[af]", prev));
    prev = "af".to_string();

    // Foreground slots (zIndex >= 0)
    for i in 0..num_videos {
        let slot = &slots[i];
        let sx = (slot.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_x).round() as i64;
        let sy = (slot.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_y).round() as i64;
        let z_index = slot.get("zIndex").and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
        if z_index >= 0 {
            let out = format!("f{}", i);
            filter_parts.push(format!("[{}][v{}]overlay={}:{}:eof_action=repeat[{}]", prev, i, sx, sy, out));
            prev = out;
        }
    }

    let filter_complex = filter_parts.join(";");
    println!("[compose_frame_video] filter: {}", filter_complex);

    final_args.extend(vec![
        "-filter_complex".to_string(), filter_complex,
        "-map".to_string(), format!("[{}]", prev),
        "-c:v".to_string(), "libx264".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-preset".to_string(), "fast".to_string(),
        "-crf".to_string(), "23".to_string(),
        "-t".to_string(), "9".to_string(),
        "-an".to_string(),
        "-movflags".to_string(), "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    println!("[compose_frame_video] running ffmpeg with {} args", final_args.len());

    let status = hidden_command(&get_ffmpeg_path())
        .current_dir(&temp_dir)
        .args(&final_args)
        .output()
        .map_err(|e| format!("FFmpeg compose error: {}", e))?;

    // Always log stderr for debugging
    let stderr_str = String::from_utf8_lossy(&status.stderr);
    if !stderr_str.is_empty() {
        let truncated = if stderr_str.len() > 5000 { &stderr_str[stderr_str.len()-3000..] } else { &stderr_str };
        println!("[compose_frame_video] ffmpeg stderr (tail): {}", truncated);
    }

    if !status.status.success() {
        return Err(format!("FFmpeg compose video failed: {}", stderr_str));
    }

    // Log output file size for validation
    if let Ok(meta) = fs::metadata(&output_path) {
        println!("[compose_frame_video] output: {} ({} bytes)", output_path.display(), meta.len());
    }

    Ok(output_path.to_string_lossy().to_string())
}

/// Clean up temp directory
#[tauri::command]
pub async fn cleanup_temp() -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|e| format!("Cleanup error: {}", e))?;
    }
    Ok(())
}
