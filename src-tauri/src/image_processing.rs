use crate::lut::{apply_shadow_fix, Lut3D};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

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

        let (nr, ng, nb) = lut.apply(r, g, b);
        let (nr, ng, nb) = apply_shadow_fix(nr, ng, nb);

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

        let (nr, ng, nb) = lut.apply(r, g, b);
        let (nr, ng, nb) = apply_shadow_fix(nr, ng, nb);

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
/// timeout ของ request เดียว (รวมเวลาโหลด body)
const FRAME_FETCH_TIMEOUT_SECS: u64 = 30;
/// เพดานเวลารวมของการโหลดกรอบ 1 ครั้ง (ทุก attempt รวมกัน)
///
/// สำคัญมาก: ลูกค้ายืนรออยู่หน้าตู้ ถ้าปล่อยให้ retry เต็ม 3 ครั้ง x timeout เต็ม
/// จะกิน 90 วิต่อการเรียก 1 ครั้ง แล้ว compose_frame + compose_frame_video ก็กิน
/// รวมกัน 3 นาที (เจอจริงในเคส 2026-09-05 ตู้ Tha Chang: 19:35:11 -> 19:38:12)
const FRAME_FETCH_BUDGET_SECS: u64 = 60;
/// จำ error ไว้นานเท่านี้ ก่อนยอมให้ลองโหลดใหม่
const FRAME_FAILURE_TTL_SECS: u64 = 60;
/// ต่อ TCP/TLS ไม่ติดภายในเวลานี้ = เน็ตตู้มีปัญหาจริง ไม่ต้องรอ
const FRAME_CONNECT_TIMEOUT_SECS: u64 = 10;
/// ถ้าโหลดอยู่แล้ว "นิ่งสนิท" นานขนาดนี้ถือว่าค้าง — ตัดแล้ว retry ดีกว่ารอ timeout รวม
const FRAME_READ_STALL_TIMEOUT_SECS: u64 = 20;

/// client ตัวเดียวใช้ซ้ำทุก attempt/ทุก transaction — reuse connection pool + TLS session
/// (เดิมสร้างใหม่ทุกครั้ง เสียเวลา handshake ซ้ำบนเน็ตตู้ที่ latency สูง)
static FRAME_HTTP_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(FRAME_FETCH_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(FRAME_CONNECT_TIMEOUT_SECS))
        .read_timeout(Duration::from_secs(FRAME_READ_STALL_TIMEOUT_SECS))
        .user_agent("BonioBooth/1.0")
        .build()
        .map_err(|e| format!("Frame client error: {}", e))
});

/// cache ไบต์ของกรอบที่โหลด "และ decode เป็นรูปได้จริง" แล้ว (key = URL)
/// ตู้ใช้กรอบเดิมซ้ำทั้งวัน — โหลดสำเร็จครั้งเดียวก็ไม่ต้องพึ่งเน็ตอีกจนกว่าจะปิดแอป
static FRAME_CACHE: LazyLock<Mutex<Vec<(String, Vec<u8>)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

/// จำ URL ที่เพิ่งโหลดพังไว้สั้นๆ (url, เวลาที่พัง, error)
///
/// compose_frame_video ถูกเรียกต่อจาก compose_frame ทันทีด้วย URL เดียวกัน —
/// ถ้าเพิ่งพังไปเมื่อกี้ก็ไม่มีเหตุผลให้ลูกค้ารออีกรอบเต็มๆ ตอบ error เดิมไปเลย
static FRAME_FAILURES: LazyLock<Mutex<Vec<(String, Instant, String)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

fn recent_failure(url: &str) -> Option<String> {
    let cache = FRAME_FAILURES.lock().ok()?;
    cache.iter().find_map(|(cached_url, at, err)| {
        if cached_url == url && at.elapsed() < Duration::from_secs(FRAME_FAILURE_TTL_SECS) {
            Some(err.clone())
        } else {
            None
        }
    })
}

fn remember_failure(url: &str, err: &str) {
    if let Ok(mut cache) = FRAME_FAILURES.lock() {
        cache.retain(|(cached_url, at, _)| {
            cached_url != url && at.elapsed() < Duration::from_secs(FRAME_FAILURE_TTL_SECS)
        });
        cache.push((url.to_string(), Instant::now(), err.to_string()));
    }
}

fn forget_failure(url: &str) {
    if let Ok(mut cache) = FRAME_FAILURES.lock() {
        cache.retain(|(cached_url, _, _)| cached_url != url);
    }
}

/// ที่เก็บกรอบถาวรบนเครื่อง (ล้อตาม C:\boniobooth\Saved_Photos ที่ใช้อยู่แล้ว)
///
/// ทำไมต้องมีทั้งที่มี cache ใน memory แล้ว: ตู้ปิดเครื่องทุกวันตามตารางเวลา
/// พอเปิดใหม่ memory cache ว่างเปล่า ลูกค้าคนแรกของวันจึงต้องแบกภาระโหลดเฟรม
/// ผ่านเน็ตเสมอ — ซึ่งเป็นจังหวะที่พังมาแล้วจริง disk cache ทำให้โหลดครั้งเดียว
/// แล้วใช้ได้ตลอดไป ไม่ต้องพึ่งเน็ตอีกเลย
const FRAME_DISK_CACHE_DIR: &str = r"C:\boniobooth\Frames";
/// เก็บกี่ไฟล์ก่อนเริ่มลบตัวเก่าสุดทิ้ง (กรอบ ~3 MB ต่อไฟล์)
const FRAME_DISK_CACHE_MAX_FILES: usize = 30;
/// ไฟล์เก่ากว่านี้ prefetch จะไปโหลดใหม่ทับ เผื่อกรอบถูกแก้โดยใช้ URL เดิม
const FRAME_DISK_REFRESH_DAYS: u64 = 7;

/// แปลง URL เป็นชื่อไฟล์ที่ปลอดภัย — ใช้ส่วนท้ายของ path (ปกติเป็น UUID.png)
/// แล้วกรองอักขระที่ใช้เป็นชื่อไฟล์บน Windows ไม่ได้ออก กัน path traversal ด้วย
fn frame_cache_filename(url: &str) -> String {
    let tail = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .unwrap_or("frame");
    let safe: String = tail
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .take(120)
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        format!("frame_{}.bin", url.len())
    } else {
        safe
    }
}

fn frame_cache_path(url: &str) -> std::path::PathBuf {
    std::path::Path::new(FRAME_DISK_CACHE_DIR).join(frame_cache_filename(url))
}

/// อ่านกรอบจากดิสก์ — decode ตรวจก่อนเสมอ ไฟล์ที่เสีย (เช่นไฟดับกลางเขียน)
/// จะถูกลบทิ้งแล้วถือว่าไม่มี cache
fn disk_cached_frame(url: &str) -> Option<Vec<u8>> {
    let path = frame_cache_path(url);
    let bytes = fs::read(&path).ok()?;
    if bytes.is_empty() || image::load_from_memory(&bytes).is_err() {
        log::warn!("[frame_disk] ไฟล์ cache เสีย ลบทิ้ง: {}", path.display());
        let _ = fs::remove_file(&path);
        return None;
    }
    Some(bytes)
}

/// เขียนแบบ atomic (เขียน .tmp แล้วค่อย rename) — ตู้ถูกสั่งปิดเครื่องได้ตลอดเวลา
/// ถ้าเขียนตรงๆ แล้วดับกลางคัน จะเหลือไฟล์ครึ่งๆ ที่พังทุกครั้งที่หยิบมาใช้
fn write_disk_cache(url: &str, bytes: &[u8]) {
    let dir = std::path::Path::new(FRAME_DISK_CACHE_DIR);
    if let Err(e) = fs::create_dir_all(dir) {
        log::warn!("[frame_disk] สร้างโฟลเดอร์ไม่ได้: {}", e);
        return;
    }
    let final_path = frame_cache_path(url);
    let tmp_path = final_path.with_extension("tmp");
    if let Err(e) = fs::write(&tmp_path, bytes) {
        log::warn!("[frame_disk] เขียน tmp ไม่ได้: {}", e);
        return;
    }
    if let Err(e) = fs::rename(&tmp_path, &final_path) {
        log::warn!("[frame_disk] rename ไม่ได้: {}", e);
        let _ = fs::remove_file(&tmp_path);
        return;
    }
    log::info!("[frame_disk] เก็บลงเครื่องแล้ว: {} ({} bytes)", final_path.display(), bytes.len());
    prune_disk_cache();
}

/// ลบไฟล์เก่าสุดทิ้งเมื่อเกินโควตา (กรอบเปลี่ยนตามอีเวนต์ ไม่งั้นดิสก์บวมเรื่อยๆ)
fn prune_disk_cache() {
    let dir = std::path::Path::new(FRAME_DISK_CACHE_DIR);
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut files: Vec<(std::path::PathBuf, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((e.path(), meta.modified().ok()?))
        })
        .collect();
    if files.len() <= FRAME_DISK_CACHE_MAX_FILES {
        return;
    }
    files.sort_by_key(|(_, modified)| *modified);
    for (path, _) in files.iter().take(files.len() - FRAME_DISK_CACHE_MAX_FILES) {
        log::info!("[frame_disk] ลบ cache เก่า: {}", path.display());
        let _ = fs::remove_file(path);
    }
}

/// ไฟล์บนดิสก์เก่าเกินกำหนดหรือยัง (ใช้ตัดสินใจว่า prefetch ควรโหลดทับไหม)
fn disk_cache_is_stale(url: &str) -> bool {
    let Ok(meta) = fs::metadata(frame_cache_path(url)) else {
        return true;
    };
    let Ok(modified) = meta.modified() else {
        return true;
    };
    modified
        .elapsed()
        .map(|age| age > Duration::from_secs(FRAME_DISK_REFRESH_DAYS * 24 * 60 * 60))
        .unwrap_or(false)
}

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
    fetch_frame_image_bytes_inner(frame_image_url, true).await
}

/// อุ่น cache ล่วงหน้าตั้งแต่ลูกค้าเลือกกรอบ (ก่อนถ่ายเป็นนาที) — พอถึงตอน compose
/// ก็หยิบจาก cache ได้เลย ไม่ต้องพึ่งเน็ต ณ วินาทีที่ลูกค้าจ่ายเงินไปแล้ว
///
/// เรียกแบบ fire-and-forget: พังก็แค่ไม่มี cache ไม่กระทบ flow และ **ไม่บันทึกลง
/// negative cache** เพราะไม่งั้น prefetch ที่พังจะไปปิดโอกาสให้ compose ลองจริงทีหลัง
#[tauri::command]
pub async fn prefetch_frame_image(frame_image_url: String) -> Result<u64, String> {
    if frame_image_url.is_empty() {
        return Ok(0);
    }

    // มีบนเครื่องแล้วและยังไม่เก่า — ไม่ต้องยิงเน็ตซ้ำทุกครั้งที่ลูกค้าเลือกกรอบ
    if !disk_cache_is_stale(&frame_image_url) {
        if let Some(bytes) = disk_cached_frame(&frame_image_url) {
            log::info!("[frame_prefetch] มีบนเครื่องแล้ว ({} bytes) — ไม่ต้องโหลด", bytes.len());
            cache_frame(&frame_image_url, &bytes);
            return Ok(bytes.len() as u64);
        }
    }

    match fetch_frame_image_bytes_inner(&frame_image_url, false).await {
        Ok(bytes) => {
            log::info!("[frame_prefetch] warmed cache: {} bytes", bytes.len());
            Ok(bytes.len() as u64)
        }
        Err(e) => {
            log::warn!("[frame_prefetch] failed (ไม่กระทบ flow): {}", e);
            Err(e)
        }
    }
}

async fn fetch_frame_image_bytes_inner(
    frame_image_url: &str,
    record_failure: bool,
) -> Result<Vec<u8>, String> {
    if frame_image_url.starts_with("data:") {
        let clean = frame_image_url.split(',').nth(1).unwrap_or("");
        return STANDARD
            .decode(clean)
            .map_err(|e| format!("Frame base64 decode: {}", e));
    }

    if let Some(bytes) = cached_frame(frame_image_url) {
        log::info!("[frame_fetch] memory cache hit ({} bytes) for {}", bytes.len(), frame_image_url);
        return Ok(bytes);
    }

    // มีอยู่บนเครื่องแล้ว = ไม่ต้องแตะเน็ตเลย (รอดแม้เน็ตตู้ตายสนิท)
    if let Some(bytes) = disk_cached_frame(frame_image_url) {
        log::info!("[frame_fetch] disk cache hit ({} bytes) for {}", bytes.len(), frame_image_url);
        cache_frame(frame_image_url, &bytes);
        return Ok(bytes);
    }

    // เพิ่งพังไปหมาดๆ (เช่น compose_frame พังแล้ว compose_frame_video ตามมาทันที)
    // — ไม่ต้องให้ลูกค้ารอซ้ำอีกรอบ
    if let Some(err) = recent_failure(frame_image_url) {
        log::warn!("[frame_fetch] skipping retry — เพิ่งพังไปเมื่อกี้: {}", err);
        return Err(format!("{} (เพิ่งลองไปเมื่อครู่ ไม่ลองซ้ำ)", err));
    }

    let client = FRAME_HTTP_CLIENT.as_ref().map_err(|e| e.clone())?;

    let started = Instant::now();
    let budget = Duration::from_secs(FRAME_FETCH_BUDGET_SECS);
    let mut last_err = String::new();
    for attempt in 1..=FRAME_FETCH_ATTEMPTS {
        // เหลือเวลาไม่พอจะลองอีกรอบก็หยุด ดีกว่าให้ลูกค้ายืนรอเปล่าๆ
        let remaining = budget.saturating_sub(started.elapsed());
        if remaining < Duration::from_secs(3) {
            log::warn!(
                "[frame_fetch] หมดเวลารวม {}s ที่ attempt {} — เลิกลอง",
                FRAME_FETCH_BUDGET_SECS,
                attempt
            );
            break;
        }

        let attempt_timeout = remaining.min(Duration::from_secs(FRAME_FETCH_TIMEOUT_SECS));
        match try_fetch_frame(client, frame_image_url, attempt_timeout).await {
            Ok(bytes) => {
                if attempt > 1 {
                    log::info!("[frame_fetch] succeeded on attempt {}", attempt);
                }
                cache_frame(frame_image_url, &bytes);
                write_disk_cache(frame_image_url, &bytes);
                forget_failure(frame_image_url);
                return Ok(bytes);
            }
            Err(e) => {
                log::warn!(
                    "[frame_fetch] attempt {}/{} failed after {:.1}s: {}",
                    attempt,
                    FRAME_FETCH_ATTEMPTS,
                    started.elapsed().as_secs_f64(),
                    e
                );
                last_err = e;
                if attempt < FRAME_FETCH_ATTEMPTS {
                    // backoff สั้นๆ ให้ CDN/เน็ตได้หายสะดุด แต่ลูกค้าไม่รอนาน
                    tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                }
            }
        }
    }

    let err = format!(
        "Frame fetch failed after {:.0}s: {}",
        started.elapsed().as_secs_f64(),
        last_err
    );
    if record_failure {
        remember_failure(frame_image_url, &err);
    }
    Err(err)
}

/// ยิง 1 ครั้ง แล้วตรวจให้ครบว่าได้ "รูป" จริงๆ ไม่ใช่ error body
async fn try_fetch_frame(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt as _;

    let res = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| format!("download error: {}", error_chain(&e)))?;

    let status = res.status();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let expected_len = res.content_length();

    // อ่านทีละ chunk เอง (แทน .bytes()) เพื่อให้ log บอกได้ว่าพังตอนได้กี่ไบต์แล้ว
    // — "0 ไบต์" คือ CDN/เน็ตตัดตั้งแต่ต้น ส่วน "ได้ครึ่งทาง" คือโหลดค้างกลางคัน
    let mut bytes: Vec<u8> = Vec::with_capacity(expected_len.unwrap_or(0).min(32 * 1024 * 1024) as usize);
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(chunk) => bytes.extend_from_slice(&chunk),
            Err(e) => {
                return Err(format!(
                    "read body error (HTTP {}, content-type: {}, got {}/{} bytes): {}",
                    status,
                    content_type,
                    bytes.len(),
                    expected_len.map(|l| l.to_string()).unwrap_or_else(|| "?".to_string()),
                    error_chain(&e)
                ))
            }
        }
    }

    if !status.is_success() {
        return Err(format!(
            "HTTP {} (content-type: {}, {} bytes): {}",
            status,
            content_type,
            bytes.len(),
            body_snippet(&bytes)
        ));
    }

    // body สั้นกว่าที่ server บอกไว้ = ไฟล์ขาด อย่าปล่อยให้ไป decode ต่อ (จะได้ retry แทน)
    if let Some(expected) = expected_len {
        if bytes.len() as u64 != expected {
            return Err(format!(
                "truncated body (HTTP {}, content-type: {}, got {}/{} bytes)",
                status,
                content_type,
                bytes.len(),
                expected
            ));
        }
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

/// reqwest ปริ๊นต์แค่ข้อความชั้นบนสุด ("error decoding response body") ซึ่งไม่บอกอะไรเลย
/// สาเหตุจริง (timed out / connection closed before message completed / ...) อยู่ใน source chain
fn error_chain(err: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![err.to_string()];
    let mut source = err.source();
    while let Some(inner) = source {
        let msg = inner.to_string();
        if !parts.iter().any(|p| p == &msg) {
            parts.push(msg);
        }
        source = inner.source();
    }
    parts.join(" <- ")
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
    log::info!("[compose_frame] frame original: {}x{}, grid target: {}x{}", orig_w, orig_h, frame_width, frame_height);

    const MIN_OUTPUT_DIMENSION: u32 = 3600;
    let max_dim = orig_w.max(orig_h);
    let frame_img = if max_dim < MIN_OUTPUT_DIMENSION {
        let scale = MIN_OUTPUT_DIMENSION as f64 / max_dim as f64;
        let new_w = (orig_w as f64 * scale).round() as u32;
        let new_h = (orig_h as f64 * scale).round() as u32;
        log::info!("[compose_frame] upscaling frame to {}x{}", new_w, new_h);
        frame_img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
    } else {
        frame_img
    };
    let (orig_w, orig_h) = frame_img.dimensions();

    let scale_x = orig_w as f64 / frame_width as f64;
    let scale_y = orig_h as f64 / frame_height as f64;

    log::info!("[compose_frame] scaleX: {}, scaleY: {}", scale_x, scale_y);

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

    // 2x6/6x2 -> 4x6 duplicate: ทำ "หลัง" จากที่วางรูปลงช่องครบแล้ว (dup ทั้งกรอบ+รูป
    // ไม่ใช่แค่กรอบเปล่า) ให้ compose_frame เป็น single-source-of-truth ของภาพ 4x6
    // ที่ทุก touchpoint ปลายทาง (preview, save, upload, GIF/video, หน้าเว็บ) ใช้ต่อ
    // โดยอัตโนมัติ. เกณฑ์ตัดสินใช้ frame_width/frame_height ที่รับเข้ามา (grid ต้นฉบับ
    // ของกรอบ) ให้สอดคล้องกับ logic ฝั่ง frontend (PhotoResult.tsx) และ printer.rs.
    let frame_ratio = frame_width as f64 / frame_height as f64;
    let canvas = if frame_ratio < 0.5 {
        // 2x6 (สูงแคบ) -> canvas กว้าง 2 เท่า วางภาพซ้ำซ้าย-ขวา
        let (cw, ch) = canvas.dimensions();
        log::info!("[compose_frame] 2x6 dup (frame ratio={:.3}): {}x{} -> {}x{}", frame_ratio, cw, ch, cw * 2, ch);
        let mut doubled: RgbaImage = ImageBuffer::new(cw * 2, ch);
        image::imageops::overlay(&mut doubled, &canvas, 0, 0);
        image::imageops::overlay(&mut doubled, &canvas, cw as i64, 0);
        doubled
    } else if frame_ratio > 2.0 {
        // 6x2 (แนวนอนแคบ) -> canvas สูง 2 เท่า วางภาพซ้ำบน-ล่าง
        let (cw, ch) = canvas.dimensions();
        log::info!("[compose_frame] 6x2 dup (frame ratio={:.3}): {}x{} -> {}x{}", frame_ratio, cw, ch, cw, ch * 2);
        let mut doubled: RgbaImage = ImageBuffer::new(cw, ch * 2);
        image::imageops::overlay(&mut doubled, &canvas, 0, 0);
        image::imageops::overlay(&mut doubled, &canvas, 0, ch as i64);
        doubled
    } else {
        canvas
    };

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