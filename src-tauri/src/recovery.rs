//! Session recovery — จำว่าลูกค้าที่จ่ายเงินแล้วไปถึงขั้นไหน เผื่อโปรแกรมค้าง/เครื่องดับกลางทาง
//!
//! เก็บที่ `C:\boniobooth\Recovery\`:
//! - `state.json`    — checkpoint ล่าสุดของ session ที่จ่ายเงินแล้ว (ฝั่ง React เป็นคนกำหนดเนื้อหา)
//! - `journal.jsonl` — บันทึกทุก step ต่อท้ายไปเรื่อยๆ (ไว้ไล่ย้อนหลังว่าเงิน/ID ไหนไปถึงไหน)
//! - `files\`        — รูปที่ถ่ายแล้ว + วิดีโอ ของ session ที่ยังไม่จบ
//!
//! ไม่ใช้ localStorage เพราะ WebView เขียนลงดิสก์แบบหน่วงเวลา — ไฟดับทันทีหลังจ่ายเงินอาจหาย
//! ที่นี่เขียนไฟล์ชั่วคราวแล้ว fsync ก่อน rename ทับ ไฟดับตอนไหนก็ได้ไฟล์เก่าหรือใหม่ครบๆ ไม่มีครึ่งๆ

use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const RECOVERY_DIR: &str = r"C:\boniobooth\Recovery";
const STATE_FILE: &str = "state.json";
const JOURNAL_FILE: &str = "journal.jsonl";
const JOURNAL_OLD_FILE: &str = "journal.old.jsonl";
const FILES_DIR: &str = "files";
/// journal ยาวเกินนี้ย้ายไปเป็น .old (เก็บไว้ 1 รุ่น) แล้วเริ่มไฟล์ใหม่
const JOURNAL_MAX_BYTES: u64 = 5 * 1024 * 1024;

fn recovery_dir() -> PathBuf {
    PathBuf::from(RECOVERY_DIR)
}

fn files_dir() -> PathBuf {
    recovery_dir().join(FILES_DIR)
}

/// ชื่อไฟล์มาจากฝั่ง JS — กันไม่ให้หลุดออกนอกโฟลเดอร์ recovery
fn safe_file_name(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        && !name.starts_with('.');
    if ok {
        Ok(name.to_string())
    } else {
        Err(format!("invalid recovery file name: {}", name))
    }
}

/// เขียนไฟล์แบบ atomic: เขียน .tmp → fsync → rename ทับของเดิม
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir error: {}", e))?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = File::create(&tmp).map_err(|e| format!("create tmp error: {}", e))?;
        f.write_all(bytes).map_err(|e| format!("write error: {}", e))?;
        f.sync_all().map_err(|e| format!("fsync error: {}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename error: {}", e)
    })
}

/// บันทึก checkpoint ล่าสุด (JSON จาก React)
#[tauri::command]
pub async fn recovery_save_state(state_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_atomic(&recovery_dir().join(STATE_FILE), state_json.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// อ่าน checkpoint — ไม่มีไฟล์ = ไม่มี session ค้าง
#[tauri::command]
pub async fn recovery_load_state() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match fs::read_to_string(recovery_dir().join(STATE_FILE)) {
            Ok(s) if !s.trim().is_empty() => Ok(Some(s)),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("read state error: {}", e)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// session จบแล้ว — ลบ checkpoint และไฟล์รูป/วิดีโอที่เก็บไว้ (journal ไม่ลบ)
#[tauri::command]
pub async fn recovery_clear() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = recovery_dir().join(STATE_FILE);
        if let Err(e) = fs::remove_file(&state) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("remove state error: {}", e));
            }
        }
        let files = files_dir();
        if files.exists() {
            let _ = fs::remove_dir_all(&files);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ต่อท้าย journal 1 บรรทัด (JSON) แล้ว fsync
#[tauri::command]
pub async fn recovery_journal(line: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = recovery_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("create dir error: {}", e))?;
        let path = dir.join(JOURNAL_FILE);
        if fs::metadata(&path).map(|m| m.len() > JOURNAL_MAX_BYTES).unwrap_or(false) {
            let _ = fs::rename(&path, dir.join(JOURNAL_OLD_FILE));
        }
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("open journal error: {}", e))?;
        let one_line = line.replace(['\r', '\n'], " ");
        f.write_all(one_line.as_bytes())
            .and_then(|_| f.write_all(b"\n"))
            .map_err(|e| format!("write journal error: {}", e))?;
        f.sync_all().map_err(|e| format!("fsync journal error: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// เก็บรูป (base64 / data URL) ลงโฟลเดอร์ recovery — คืน path เต็ม
#[tauri::command]
pub async fn recovery_save_image(
    image_data_base64: String,
    filename: String,
) -> Result<String, String> {
    let name = safe_file_name(&filename)?;
    tauri::async_runtime::spawn_blocking(move || {
        let clean = match image_data_base64.find(',') {
            Some(i) => &image_data_base64[i + 1..],
            None => image_data_base64.as_str(),
        };
        let bytes = STANDARD
            .decode(clean)
            .map_err(|e| format!("decode error: {}", e))?;
        let path = files_dir().join(&name);
        write_atomic(&path, &bytes)?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// คัดลอกไฟล์ (เช่น วิดีโอใน %TEMP%) มาเก็บในโฟลเดอร์ recovery — คืน path เต็ม
#[tauri::command]
pub async fn recovery_copy_file(source_path: String, filename: String) -> Result<String, String> {
    let name = safe_file_name(&filename)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = files_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("create dir error: {}", e))?;
        let dest = dir.join(&name);
        let tmp = dest.with_extension("tmp");
        fs::copy(&source_path, &tmp).map_err(|e| format!("copy error: {}", e))?;
        if let Ok(f) = File::open(&tmp) {
            let _ = f.sync_all();
        }
        fs::rename(&tmp, &dest).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename error: {}", e)
        })?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// อ่านรูปที่เก็บไว้กลับมาเป็น data URL (หน้าอื่นๆ ใช้รูปเป็น data URL อยู่แล้ว)
#[tauri::command]
pub async fn recovery_read_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        // อ่านได้เฉพาะไฟล์ในโฟลเดอร์ recovery
        if !p.starts_with(files_dir()) {
            return Err(format!("not a recovery file: {}", path));
        }
        let bytes = fs::read(&p).map_err(|e| format!("read error: {}", e))?;
        if bytes.is_empty() {
            return Err("empty file".into());
        }
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            "image/png"
        } else {
            "image/jpeg"
        };
        Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_escapes() {
        assert!(safe_file_name("photo_1.jpg").is_ok());
        assert!(safe_file_name("video-2.webm").is_ok());
        assert!(safe_file_name("..\\state.json").is_err());
        assert!(safe_file_name("../x").is_err());
        assert!(safe_file_name("C:\\x.jpg").is_err());
        assert!(safe_file_name(".hidden").is_err());
        assert!(safe_file_name("").is_err());
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = std::env::temp_dir().join("bonio_recovery_test");
        let path = dir.join("s.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
