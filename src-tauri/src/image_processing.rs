use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

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
        let ri = (r * max_idx).min(max_idx);
        let gi = (g * max_idx).min(max_idx);
        let bi = (b * max_idx).min(max_idx);

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

    // Decode base64 image
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

    let (width, height) = img.dimensions();
    let mut output: RgbaImage = ImageBuffer::new(width, height);

    for (x, y, pixel) in img.pixels() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;
        let a = pixel[3];

        let (nr, ng, nb) = lut.apply(r, g, b);

        output.put_pixel(
            x,
            y,
            Rgba([
                (nr * 255.0) as u8,
                (ng * 255.0) as u8,
                (nb * 255.0) as u8,
                a,
            ]),
        );
    }

    // Encode back to JPEG base64 (much smaller than PNG: ~10 MB → ~1-2 MB)
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
    DynamicImage::ImageRgba8(output)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    // Patch JFIF header to set DPI to 350
    if buf.len() >= 18 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF && buf[3] == 0xE0 {
        if buf[6] == b'J' && buf[7] == b'F' && buf[8] == b'I' && buf[9] == b'F' && buf[10] == 0x00 {
            let dpi: u16 = 350;
            buf[13] = 1; // 1 = dots per inch
            buf[14] = (dpi >> 8) as u8;
            buf[15] = (dpi & 0xFF) as u8;
            buf[16] = (dpi >> 8) as u8;
            buf[17] = (dpi & 0xFF) as u8;
        }
    }

    let result = format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf));
    Ok(result)
}

/// Faster version of apply_lut_filter that resizes image first for thumbnail previews
#[tauri::command]
pub async fn apply_lut_filter_preview(
    image_data_base64: String,
    lut_file_path: String,
    max_size: Option<u32>,
) -> Result<String, String> {
    let target_size = max_size.unwrap_or(200);

    if lut_file_path.is_empty() {
        // Even for no-filter, resize for consistent thumbnail size
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

    // Resize first for much faster LUT application
    let small = img.thumbnail(target_size, target_size);
    let (width, height) = small.dimensions();
    let mut output: RgbaImage = ImageBuffer::new(width, height);

    for (x, y, pixel) in small.pixels() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;
        let a = pixel[3];

        let (nr, ng, nb) = lut.apply(r, g, b);

        output.put_pixel(
            x,
            y,
            Rgba([
                (nr * 255.0) as u8,
                (ng * 255.0) as u8,
                (nb * 255.0) as u8,
                a,
            ]),
        );
    }

    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75);
    DynamicImage::ImageRgba8(output)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&buf)))
}

#[tauri::command]
pub async fn compose_frame(
    frame_image_url: String,
    photos_base64: Vec<String>,
    slots: Vec<serde_json::Value>,
    frame_width: u32,
    frame_height: u32,
) -> Result<String, String> {
    // Load frame image
    let frame_bytes = if frame_image_url.starts_with("data:") {
        let clean = frame_image_url.split(',').nth(1).unwrap_or("");
        STANDARD
            .decode(clean)
            .map_err(|e| format!("Frame base64 decode: {}", e))?
    } else {
        // Download from URL
        let client = reqwest::Client::new();
        let res = client
            .get(&frame_image_url)
            .send()
            .await
            .map_err(|e| format!("Frame download error: {}", e))?;
        res.bytes()
            .await
            .map_err(|e| format!("Frame bytes error: {}", e))?
            .to_vec()
    };

    let frame_img = image::load_from_memory(&frame_bytes)
        .map_err(|e| format!("Frame load error: {}", e))?;

    let (orig_w, orig_h) = frame_img.dimensions();
    println!("[compose_frame] frame original: {}x{}, grid target: {}x{}", orig_w, orig_h, frame_width, frame_height);

    // Upscale frame image to at least 3600px on the longer dimension for print quality
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

    // Use the frame image's natural dimensions as canvas size (matches reference project)
    // Slots are in grid coordinates — scale them to match the actual frame image size
    let scale_x = orig_w as f64 / frame_width as f64;
    let scale_y = orig_h as f64 / frame_height as f64;

    println!("[compose_frame] scaleX: {}, scaleY: {}", scale_x, scale_y);

    let canvas_w = orig_w;
    let canvas_h = orig_h;
    let frame_img_rgba = frame_img.to_rgba8();
    let mut canvas: RgbaImage = ImageBuffer::new(canvas_w, canvas_h);

    // 1. Draw background slots (zIndex < 0) — behind the frame
    for (i, slot) in slots.iter().enumerate() {
        if i >= photos_base64.len() {
            continue;
        }
        let z_index = slot.get("zIndex").and_then(|z| z.as_f64()).unwrap_or(0.0) as i64;
        if z_index < 0 {
            draw_photo_in_slot(&mut canvas, &photos_base64[i], slot, scale_x, scale_y)?;
        }
    }

    // 2. Draw frame overlay
    image::imageops::overlay(&mut canvas, &frame_img_rgba, 0, 0);

    // 3. Draw foreground slots (zIndex >= 0) — on top of the frame
    for (i, slot) in slots.iter().enumerate() {
        if i >= photos_base64.len() {
            continue;
        }
        let z_index = slot.get("zIndex").and_then(|z| z.as_f64()).unwrap_or(0.0) as i64;
        if z_index >= 0 {
            draw_photo_in_slot(&mut canvas, &photos_base64[i], slot, scale_x, scale_y)?;
        }
    }

    // Encode result as JPEG (much smaller than PNG while retaining print quality)
    let mut buf = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 95);
    DynamicImage::ImageRgba8(canvas)
        .write_with_encoder(encoder)
        .map_err(|e| format!("Encode error: {}", e))?;

    // Patch JFIF header to set DPI to 350
    if buf.len() >= 18 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF && buf[3] == 0xE0 {
        if buf[6] == b'J' && buf[7] == b'F' && buf[8] == b'I' && buf[9] == b'F' && buf[10] == 0x00 {
            let dpi: u16 = 350;
            buf[13] = 1; // 1 = dots per inch
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
    // Slot coordinates are in grid space — scale to actual canvas (frame image) space
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

    // Apply radius (rounded corners) using alpha masking
    let mut photo_rgba = resized.to_rgba8();
    if radius > 0 {
        apply_rounded_corners(&mut photo_rgba, radius);
    }

    // Apply rotation if needed
    if rotate.abs() > 0.1 {
        let rotated = rotate_image_around_center(&photo_rgba, rotate);
        // After rotation the image is larger; we need to center it at the slot position
        let (rw, rh) = rotated.dimensions();
        let offset_x = x.round() as i64 - (rw as i64 - w as i64) / 2;
        let offset_y = y.round() as i64 - (rh as i64 - h as i64) / 2;
        image::imageops::overlay(canvas, &rotated, offset_x, offset_y);
    } else {
        image::imageops::overlay(canvas, &photo_rgba, x.round() as i64, y.round() as i64);
    }

    Ok(())
}

/// Rotate an RGBA image by arbitrary degrees around its center.
/// Returns a new image large enough to contain the rotated result.
fn rotate_image_around_center(img: &RgbaImage, degrees: f64) -> RgbaImage {
    let (w, h) = img.dimensions();
    let radians = degrees * std::f64::consts::PI / 180.0;
    let cos_a = radians.cos().abs();
    let sin_a = radians.sin().abs();

    // New dimensions to fit the rotated image
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
            // Map destination pixel back to source
            let dx = out_x as f64 - cx_dst;
            let dy = out_y as f64 - cy_dst;
            let src_x = dx * cos_neg - dy * sin_neg + cx_src;
            let src_y = dx * sin_neg + dy * cos_neg + cy_src;

            // Bilinear interpolation
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

    for y in 0..h {
        for x in 0..w {
            let corners = [
                (0.0f32, 0.0f32),           // top-left
                (w as f32 - 1.0, 0.0),      // top-right
                (0.0, h as f32 - 1.0),      // bottom-left
                (w as f32 - 1.0, h as f32 - 1.0), // bottom-right
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
        }
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
