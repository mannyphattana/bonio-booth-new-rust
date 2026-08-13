use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

#[derive(Debug, Clone)]
struct Lut3D {
    size: usize,
    data: Vec<[f32; 3]>,
}

impl Lut3D {
    fn parse_cube_file(path: &str) -> Result<Self, String> {
        let content = fs::read_to_string(path).map_err(|e| format!("Read LUT file error: {}", e))?;
        let mut size: usize = 0;
        let mut data: Vec<[f32; 3]> = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with("LUT_3D_SIZE") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    size = parts[1].parse().map_err(|e| format!("Parse size error: {}", e))?;
                }
                continue;
            }
            if line.starts_with("TITLE") || line.starts_with("DOMAIN_MIN") || line.starts_with("DOMAIN_MAX") {
                continue;
            }

            let values: Vec<f32> = line
                .split_whitespace()
                .filter_map(|v| v.parse::<f32>().ok())
                .collect();

            if values.len() == 3 {
                data.push([values[0], values[1], values[2]]);
            }
        }

        if size == 0 || data.is_empty() {
            return Err("Invalid LUT file".to_string());
        }

        Ok(Lut3D { size, data })
    }

    fn apply(&self, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
        let max_idx = (self.size - 1) as f32;
        
        let ri = r.clamp(0.0, 1.0) * max_idx;
        let gi = g.clamp(0.0, 1.0) * max_idx;
        let bi = b.clamp(0.0, 1.0) * max_idx;

        let r0 = ri.floor() as usize;
        let g0 = gi.floor() as usize;
        let b0 = bi.floor() as usize;
        let r1 = (r0 + 1).min(self.size - 1);
        let g1 = (g0 + 1).min(self.size - 1);
        let b1 = (b0 + 1).min(self.size - 1);

        let rf = ri - r0 as f32;
        let gf = gi - g0 as f32;
        let bf = bi - b0 as f32;

        let idx = |r: usize, g: usize, b: usize| -> usize {
            b * self.size * self.size + g * self.size + r
        };

        let c000 = self.data[idx(r0, g0, b0)];
        let c100 = self.data[idx(r1, g0, b0)];
        let c010 = self.data[idx(r0, g1, b0)];
        let c110 = self.data[idx(r1, g1, b0)];
        let c001 = self.data[idx(r0, g0, b1)];
        let c101 = self.data[idx(r1, g0, b1)];
        let c011 = self.data[idx(r0, g1, b1)];
        let c111 = self.data[idx(r1, g1, b1)];

        let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;

        let mut result = [0.0f32; 3];
        for i in 0..3 {
            let c00 = lerp(c000[i], c100[i], rf);
            let c10 = lerp(c010[i], c110[i], rf);
            let c01 = lerp(c001[i], c101[i], rf);
            let c11 = lerp(c011[i], c111[i], rf);

            let c0 = lerp(c00, c10, gf);
            let c1 = lerp(c01, c11, gf);

            result[i] = lerp(c0, c1, bf);
        }

        (
            result[0].clamp(0.0, 1.0),
            result[1].clamp(0.0, 1.0),
            result[2].clamp(0.0, 1.0),
        )
    }
}

#[derive(Serialize, Deserialize)]
pub struct FilterInfo {
    pub name: String,
    pub file_path: String,
}

#[tauri::command]
pub async fn get_available_filters(filters_dir: String) -> Result<Vec<FilterInfo>, String> {
    let path = Path::new(&filters_dir);
    if !path.exists() {
        return Err("Filters directory not found".to_string());
    }

    let mut filters = vec![FilterInfo {
        name: "No Filter".to_string(),
        file_path: String::new(),
    }];

    let entries = fs::read_dir(path).map_err(|e| format!("Read dir error: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let file_path = entry.path();
        if file_path.extension().and_then(|e| e.to_str()) == Some("cube") {
            let name = file_path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();
            filters.push(FilterInfo {
                name,
                file_path: file_path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(filters)
}

#[tauri::command]
pub async fn apply_lut_filter(
    image_data_base64: String,
    lut_file_path: String,
) -> Result<String, String> {
    if lut_file_path.is_empty() {
        return Ok(image_data_base64);
    }

    let lut = Lut3D::parse_cube_file(&lut_file_path)?;

    let clean_base64 = if image_data_base64.contains(",") {
        image_data_base64.split(',').nth(1).unwrap_or(&image_data_base64)
    } else {
        &image_data_base64
    };

    let image_bytes = STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| format!("Image load error: {}", e))?;

    let mut output = img.into_rgba8();

    for pixel in output.pixels_mut() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;

        let (mut nr, mut ng, mut nb) = lut.apply(r, g, b);

        // --- แก้ปัญหาเงาเขียว (อัปเกรดความแรง ครอบคลุมเสื้อ/ฉากหลัง) ---
        let luma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        let shadow_threshold = 0.28; // เพิ่มให้ครอบคลุมถึง 28% (ครอบคลุมเสื้อสีเข้ม/ดำ)
        
        if luma < shadow_threshold {
            let t = luma / shadow_threshold;
            let curve = t * t; // ใช้สมการ Quadratic ให้เกลี่ยสีเนียนที่สุด ไร้รอยต่อ
            
            nr = luma + (nr - luma) * curve;
            ng = luma + (ng - luma) * curve;
            nb = luma + (nb - luma) * curve;
        }

        pixel[0] = (nr * 255.0).clamp(0.0, 255.0) as u8;
        pixel[1] = (ng * 255.0).clamp(0.0, 255.0) as u8;
        pixel[2] = (nb * 255.0).clamp(0.0, 255.0) as u8;
    }

    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
    DynamicImage::ImageRgba8(output)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    if buf.len() >= 18 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF && buf[3] == 0xE0 {
        if buf[6] == b'J' && buf[7] == b'F' && buf[8] == b'I' && buf[9] == b'F' && buf[10] == 0x00 {
            let dpi: u16 = 350;
            buf[13] = 1;
            buf[14] = (dpi >> 8) as u8;
            buf[15] = (dpi & 0xFF) as u8;
            buf[16] = (dpi >> 8) as u8;
            buf[17] = (dpi & 0xFF) as u8;
        }
    }

    let result = format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf));
    Ok(result)
}

#[tauri::command]
pub async fn apply_lut_filter_preview(
    image_data_base64: String,
    lut_file_path: String,
    max_size: Option<u32>,
) -> Result<String, String> {
    let target_size = max_size.unwrap_or(200);

    if lut_file_path.is_empty() {
        let clean_base64 = if image_data_base64.contains(",") {
            image_data_base64.split(',').nth(1).unwrap_or(&image_data_base64)
        } else {
            &image_data_base64
        };
        let image_bytes = STANDARD
            .decode(clean_base64)
            .map_err(|e| format!("Base64 decode error: {}", e))?;
        let img = image::load_from_memory(&image_bytes)
            .map_err(|e| format!("Image load error: {}", e))?;
        let thumb = img.thumbnail(target_size, target_size);
        let mut buf = Vec::new();
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75);
        thumb
            .write_with_encoder(encoder)
            .map_err(|e| format!("Encode error: {}", e))?;
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf)));
    }

    let lut = Lut3D::parse_cube_file(&lut_file_path)?;

    let clean_base64 = if image_data_base64.contains(",") {
        image_data_base64.split(',').nth(1).unwrap_or(&image_data_base64)
    } else {
        &image_data_base64
    };

    let image_bytes = STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| format!("Image load error: {}", e))?;

    let small = img.thumbnail(target_size, target_size);
    let mut output = small.into_rgba8();

    for pixel in output.pixels_mut() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;

        let (mut nr, mut ng, mut nb) = lut.apply(r, g, b);

        // --- แก้ปัญหาเงาเขียว (อัปเกรดความแรง ครอบคลุมเสื้อ/ฉากหลัง) ---
        let luma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        let shadow_threshold = 0.28; 
        
        if luma < shadow_threshold {
            let t = luma / shadow_threshold;
            let curve = t * t;
            
            nr = luma + (nr - luma) * curve;
            ng = luma + (ng - luma) * curve;
            nb = luma + (nb - luma) * curve;
        }

        pixel[0] = (nr * 255.0).clamp(0.0, 255.0) as u8;
        pixel[1] = (ng * 255.0).clamp(0.0, 255.0) as u8;
        pixel[2] = (nb * 255.0).clamp(0.0, 255.0) as u8;
    }

    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75);
    DynamicImage::ImageRgba8(output)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf)))
}

/// จำนวนครั้งที่ยอมโหลดรูปกรอบใหม่ก่อนยอมแพ้
const FRAME_FETCH_ATTEMPTS: u32 = 3;
/// จำนวนกรอบที่เก็บ cache ไว้ (ตู้หนึ่งใช้กรอบไม่กี่แบบต่อวัน)
const FRAME_CACHE_CAPACITY: usize = 8;
const FRAME_FETCH_TIMEOUT_SECS: u64 = 30;

/// cache ไบต์ของกรอบที่โหลด "และ decode เป็นรูปได้จริง" แล้ว (key = URL)
/// ตู้ใช้กรอบเดิมซ้ำทั้งวัน — โหลดสำเร็จครั้งเดียวก็ไม่ต้องพึ่งเน็ตอีกจนกว่าจะปิดแอป
static FRAME_CACHE: LazyLock<Mutex<Vec<(String, Vec<u8>)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

fn cached_frame(url: &str) -> Option<Vec<u8>> {
    let cache = FRAME_CACHE.lock().ok()?;
    cache
        .iter()
        .find(|(cached_url, _)| cached_url == url)
        .map(|(_, bytes)| bytes.clone())
}

fn cache_frame(url: &str, bytes: &[u8]) {
    if let Ok(mut cache) = FRAME_CACHE.lock() {
        if cache.iter().any(|(cached_url, _)| cached_url == url) {
            return;
        }
        if cache.len() >= FRAME_CACHE_CAPACITY {
            cache.remove(0);
        }
        cache.push((url.to_string(), bytes.to_vec()));
    }
}

/// โหลดรูปกรอบเฟรมให้ได้ไบต์ที่ "decode เป็นรูปได้จริง"
///
/// เดิมโค้ดยิง request ครั้งเดียว ไม่เช็ค HTTP status และไม่ลองใหม่ — พอ CDN/S3
/// ตอบ error body (หรือเน็ตสะดุด) ไบต์ที่ได้ไม่ใช่รูป แล้ว `image::load_from_memory`
/// ล้มด้วย "The image format could not be determined" ทำให้ compose_frame คืน error
/// ทันทีและลูกค้าไม่ได้รูปพิมพ์เลย (เจอหน้างานตู้ Tha Chang Bangsaen 2026-08-12)
///
/// ตอนนี้: เช็ค status, validate ว่าเป็นรูปก่อนคืนค่า, retry พร้อม backoff และ
/// cache ไว้ให้ transaction ถัดไป
pub async fn fetch_frame_image_bytes(frame_image_url: &str) -> Result<Vec<u8>, String> {
    if frame_image_url.starts_with("data:") {
        let clean = frame_image_url.split(',').nth(1).unwrap_or("");
        return STANDARD
            .decode(clean)
            .map_err(|e| format!("Frame base64 decode: {}", e));
    }

    if let Some(bytes) = cached_frame(frame_image_url) {
        println!("[frame_fetch] cache hit ({} bytes) for {}", bytes.len(), frame_image_url);
        return Ok(bytes);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FRAME_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Frame client error: {}", e))?;

    let mut last_err = String::new();
    for attempt in 1..=FRAME_FETCH_ATTEMPTS {
        match try_fetch_frame(&client, frame_image_url).await {
            Ok(bytes) => {
                if attempt > 1 {
                    println!("[frame_fetch] succeeded on attempt {}", attempt);
                }
                cache_frame(frame_image_url, &bytes);
                return Ok(bytes);
            }
            Err(e) => {
                println!("[frame_fetch] attempt {}/{} failed: {}", attempt, FRAME_FETCH_ATTEMPTS, e);
                last_err = e;
                if attempt < FRAME_FETCH_ATTEMPTS {
                    // backoff สั้นๆ ให้ CDN/เน็ตได้หายสะดุด แต่ลูกค้าไม่รอนาน
                    tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                }
            }
        }
    }

    Err(format!(
        "Frame fetch failed after {} attempts: {}",
        FRAME_FETCH_ATTEMPTS, last_err
    ))
}

/// ยิง 1 ครั้ง แล้วตรวจให้ครบว่าได้ "รูป" จริงๆ ไม่ใช่ error body
async fn try_fetch_frame(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download error: {}", e))?;

    let status = res.status();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("read body error (HTTP {}): {}", status, e))?
        .to_vec();

    if !status.is_success() {
        return Err(format!(
            "HTTP {} (content-type: {}, {} bytes): {}",
            status,
            content_type,
            bytes.len(),
            body_snippet(&bytes)
        ));
    }

    if bytes.is_empty() {
        return Err(format!("empty body (HTTP {}, content-type: {})", status, content_type));
    }

    // decode ตรงนี้เลย เพื่อไม่ให้ไบต์เสียๆ หลุดไปถึงคนเรียก (และไม่ถูก cache)
    if let Err(e) = image::load_from_memory(&bytes) {
        return Err(format!(
            "not an image (HTTP {}, content-type: {}, {} bytes): {} — body: {}",
            status,
            content_type,
            bytes.len(),
            e,
            body_snippet(&bytes)
        ));
    }

    Ok(bytes)
}

/// ตัด body มาโชว์ใน log พอให้รู้ว่า S3/CDN ตอบอะไรกลับมา
fn body_snippet(bytes: &[u8]) -> String {
    const MAX: usize = 180;
    let end = bytes.len().min(MAX);
    let snippet = String::from_utf8_lossy(&bytes[..end])
        .replace(['\n', '\r'], " ")
        .trim()
        .to_string();
    if bytes.len() > MAX {
        format!("{}…", snippet)
    } else {
        snippet
    }
}

#[tauri::command]
pub async fn compose_frame(
    frame_image_url: String,
    photos_base64: Vec<String>,
    slots: Vec<serde_json::Value>,
    frame_width: u32,
    frame_height: u32,
) -> Result<String, String> {
    let frame_bytes = fetch_frame_image_bytes(&frame_image_url).await?;

    let frame_img = image::load_from_memory(&frame_bytes)
        .map_err(|e| format!("Frame load error: {}", e))?;

    let (orig_w, orig_h) = frame_img.dimensions();
    println!("[compose_frame] frame original: {}x{}, grid target: {}x{}", orig_w, orig_h, frame_width, frame_height);

    const MIN_OUTPUT_DIMENSION: u32 = 3600;
    let max_dim = orig_w.max(orig_h);
    let frame_img = if max_dim < MIN_OUTPUT_DIMENSION {
        let scale = MIN_OUTPUT_DIMENSION as f64 / max_dim as f64;
        let new_w = (orig_w as f64 * scale).round() as u32;
        let new_h = (orig_h as f64 * scale).round() as u32;
        println!("[compose_frame] upscaling frame to {}x{}", new_w, new_h);
        frame_img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
    } else {
        frame_img
    };
    let (orig_w, orig_h) = frame_img.dimensions();

    let scale_x = orig_w as f64 / frame_width as f64;
    let scale_y = orig_h as f64 / frame_height as f64;

    println!("[compose_frame] scaleX: {}, scaleY: {}", scale_x, scale_y);

    let canvas_w = orig_w;
    let canvas_h = orig_h;
    
    let frame_img_rgba = frame_img.into_rgba8();
    let mut canvas: RgbaImage = ImageBuffer::new(canvas_w, canvas_h);

    for (i, slot) in slots.iter().enumerate() {
        if i >= photos_base64.len() {
            continue;
        }
        let z_index = slot.get("zIndex").and_then(|z| z.as_f64()).unwrap_or(0.0) as i64;
        if z_index < 0 {
            draw_photo_in_slot(&mut canvas, &photos_base64[i], slot, scale_x, scale_y)?;
        }
    }

    image::imageops::overlay(&mut canvas, &frame_img_rgba, 0, 0);

    for (i, slot) in slots.iter().enumerate() {
        if i >= photos_base64.len() {
            continue;
        }
        let z_index = slot.get("zIndex").and_then(|z| z.as_f64()).unwrap_or(0.0) as i64;
        if z_index >= 0 {
            draw_photo_in_slot(&mut canvas, &photos_base64[i], slot, scale_x, scale_y)?;
        }
    }

    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 95);
    DynamicImage::ImageRgba8(canvas)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    if buf.len() >= 18 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF && buf[3] == 0xE0 {
        if buf[6] == b'J' && buf[7] == b'F' && buf[8] == b'I' && buf[9] == b'F' && buf[10] == 0x00 {
            let dpi: u16 = 350;
            buf[13] = 1; 
            buf[14] = (dpi >> 8) as u8;
            buf[15] = (dpi & 0xFF) as u8;
            buf[16] = (dpi >> 8) as u8;
            buf[17] = (dpi & 0xFF) as u8;
        }
    }

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf)))
}

fn draw_photo_in_slot(
    canvas: &mut RgbaImage,
    photo_base64: &str,
    slot: &serde_json::Value,
    scale_x: f64,
    scale_y: f64,
) -> Result<(), String> {
    let x = slot.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_x;
    let y = slot.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_y;
    let w = (slot.get("width").and_then(|v| v.as_f64()).unwrap_or(100.0) * scale_x).round() as u32;
    let h = (slot.get("height").and_then(|v| v.as_f64()).unwrap_or(100.0) * scale_y).round() as u32;
    let radius = (slot.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.0) * scale_x).round() as u32;
    let rotate = slot.get("rotate").and_then(|v| v.as_f64()).unwrap_or(0.0);

    let clean = if photo_base64.contains(",") {
        photo_base64.split(',').nth(1).unwrap_or(photo_base64)
    } else {
        photo_base64
    };

    let photo_bytes = STANDARD
        .decode(clean)
        .map_err(|e| format!("Photo decode error: {}", e))?;

    let photo = image::load_from_memory(&photo_bytes)
        .map_err(|e| format!("Photo load error: {}", e))?;

    let resized = photo.resize_to_fill(w, h, image::imageops::FilterType::Lanczos3);

    let mut photo_rgba = resized.into_rgba8();
    
    if radius > 0 {
        apply_rounded_corners(&mut photo_rgba, radius);
    }

    if rotate.abs() > 0.1 {
        let rotated = rotate_image_around_center(&photo_rgba, rotate);
        let (rw, rh) = rotated.dimensions();
        let offset_x = x.round() as i64 - (rw as i64 - w as i64) / 2;
        let offset_y = y.round() as i64 - (rh as i64 - h as i64) / 2;
        image::imageops::overlay(canvas, &rotated, offset_x, offset_y);
    } else {
        image::imageops::overlay(canvas, &photo_rgba, x.round() as i64, y.round() as i64);
    }

    Ok(())
}

fn rotate_image_around_center(img: &RgbaImage, degrees: f64) -> RgbaImage {
    let (w, h) = img.dimensions();
    let radians = degrees * std::f64::consts::PI / 180.0;
    let cos_a = radians.cos().abs();
    let sin_a = radians.sin().abs();

    let new_w = (w as f64 * cos_a + h as f64 * sin_a).ceil() as u32;
    let new_h = (w as f64 * sin_a + h as f64 * cos_a).ceil() as u32;

    let mut output = RgbaImage::new(new_w, new_h);

    let cx_src = w as f64 / 2.0;
    let cy_src = h as f64 / 2.0;
    let cx_dst = new_w as f64 / 2.0;
    let cy_dst = new_h as f64 / 2.0;

    let cos_neg = (-radians).cos();
    let sin_neg = (-radians).sin();

    for out_y in 0..new_h {
        for out_x in 0..new_w {
            let dx = out_x as f64 - cx_dst;
            let dy = out_y as f64 - cy_dst;
            let src_x = dx * cos_neg - dy * sin_neg + cx_src;
            let src_y = dx * sin_neg + dy * cos_neg + cy_src;

            let sx = src_x.floor() as i64;
            let sy = src_y.floor() as i64;
            let fx = src_x - sx as f64;
            let fy = src_y - sy as f64;

            if sx >= 0 && sx + 1 < w as i64 && sy >= 0 && sy + 1 < h as i64 {
                let p00 = img.get_pixel(sx as u32, sy as u32);
                let p10 = img.get_pixel((sx + 1) as u32, sy as u32);
                let p01 = img.get_pixel(sx as u32, (sy + 1) as u32);
                let p11 = img.get_pixel((sx + 1) as u32, (sy + 1) as u32);

                let mut rgba = [0u8; 4];
                for c in 0..4 {
                    let v = p00[c] as f64 * (1.0 - fx) * (1.0 - fy)
                        + p10[c] as f64 * fx * (1.0 - fy)
                        + p01[c] as f64 * (1.0 - fx) * fy
                        + p11[c] as f64 * fx * fy;
                    rgba[c] = v.round().clamp(0.0, 255.0) as u8;
                }
                output.put_pixel(out_x, out_y, Rgba(rgba));
            }
        }
    }

    output
}

fn apply_rounded_corners(img: &mut RgbaImage, radius: u32) {
    let (w, h) = img.dimensions();
    let r = radius.min(w / 2).min(h / 2) as f32;

    if r <= 0.0 { return; }

    let r_u32 = r.ceil() as u32;

    let mut process_pixel = |x: u32, y: u32| {
        let corners = [
            (0.0f32, 0.0f32),           
            (w as f32 - 1.0, 0.0),      
            (0.0, h as f32 - 1.0),      
            (w as f32 - 1.0, h as f32 - 1.0), 
        ];

        for &(cx, cy) in &corners {
            let dx = if (x as f32) < r && cx == 0.0 {
                r - x as f32
            } else if (x as f32) > (w as f32 - 1.0 - r) && cx > 0.0 {
                x as f32 - (w as f32 - 1.0 - r)
            } else {
                0.0
            };

            let dy = if (y as f32) < r && cy == 0.0 {
                r - y as f32
            } else if (y as f32) > (h as f32 - 1.0 - r) && cy > 0.0 {
                y as f32 - (h as f32 - 1.0 - r)
            } else {
                0.0
            };

            if dx > 0.0 && dy > 0.0 {
                let dist = (dx * dx + dy * dy).sqrt();
                if dist > r {
                    img.put_pixel(x, y, Rgba([0, 0, 0, 0]));
                }
            }
        }
    };

    for y in 0..r_u32 {
        for x in 0..r_u32 { process_pixel(x, y); }
    }
    for y in 0..r_u32 {
        for x in w.saturating_sub(r_u32)..w { process_pixel(x, y); }
    }
    for y in h.saturating_sub(r_u32)..h {
        for x in 0..r_u32 { process_pixel(x, y); }
    }
    for y in h.saturating_sub(r_u32)..h {
        for x in w.saturating_sub(r_u32)..w { process_pixel(x, y); }
    }
}

#[tauri::command]
pub async fn save_temp_image(
    image_data_base64: String,
    filename: String,
) -> Result<String, String> {
    let temp_dir = std::env::temp_dir().join("bonio-booth");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Create temp dir error: {}", e))?;

    let file_path = temp_dir.join(&filename);

    let clean = if image_data_base64.contains(",") {
        image_data_base64.split(',').nth(1).unwrap_or(&image_data_base64)
    } else {
        &image_data_base64
    };

    let bytes = STANDARD
        .decode(clean)
        .map_err(|e| format!("Decode error: {}", e))?;

    fs::write(&file_path, &bytes).map_err(|e| format!("Write error: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
#[derive(Serialize, Deserialize)]
pub struct LutTextureData {
    /// ขนาดกริดของ LUT (เช่น 33 = 33x33x33)
    pub size: usize,
    /// ข้อมูล RGB8 ขนาด size^3 * 3 ไบต์ เรียงแบบเดียวกับไฟล์ .cube
    /// (r เปลี่ยนเร็วสุด → g → b) พร้อมอัปเป็น 3D texture ได้เลย
    pub data_base64: String,
}

/// ส่ง LUT ออกไปให้ฝั่งหน้าเว็บเอาไปรันบน GPU (live view)
///
/// หน้าถ่ายรูปต้องโชว์ฟิลเตอร์ตัวจริงบนภาพสด ซึ่งรัน `apply_lut_filter` ทีละเฟรม
/// ไม่ไหว จึงส่งตาราง LUT ไปให้ WebGL sample เอง — ได้ภาพเดียวกับที่รูปถ่ายจะได้
#[tauri::command]
pub async fn load_lut_texture(lut_file_path: String) -> Result<LutTextureData, String> {
    let lut = Lut3D::parse_cube_file(&lut_file_path)?;
    let expected = lut.size * lut.size * lut.size;
    if lut.data.len() < expected {
        return Err(format!(
            "LUT data too small: got {} entries, need {}",
            lut.data.len(),
            expected
        ));
    }

    let mut bytes = Vec::with_capacity(expected * 3);
    for color in lut.data.iter().take(expected) {
        for channel in color.iter() {
            bytes.push((channel.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }

    Ok(LutTextureData {
        size: lut.size,
        data_base64: STANDARD.encode(&bytes),
    })
}
