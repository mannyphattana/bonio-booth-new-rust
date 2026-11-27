//! ตัวเข้ารหัส H.264 ที่ใช้ทำวิดีโอเฟรม (compose_frame_video)
//!
//! การ์ดจอเข้ารหัสวิดีโอได้เร็วกว่า CPU มาก และไม่แย่ง CPU จากหน้าจอ ตอนเปิดโปรแกรม (เบื้องหลัง)
//! จะลองเข้ารหัสภาพทดสอบ 1 วินาทีทีละตัวตามลำดับ: Intel Quick Sync (การ์ดจอในตัว CPU Intel),
//! NVIDIA NVENC, AMD AMF แล้วค่อย CPU (libx264 มีเสมอ) ตัวแรกที่ใช้ได้จะถูกจำไว้ใน
//! `C:\boniobooth\video-encoder.json` และทดสอบใหม่เฉพาะตอน ffmpeg.exe หรือไดรเวอร์การ์ดจอเปลี่ยน
//! ถ้าการ์ดจอเข้ารหัสพังกลางทาง จะทำใหม่ด้วย CPU ทันที และครั้งหน้าที่เปิดโปรแกรมจะทดสอบใหม่
//!
//! ทุกตัวใช้เพดาน bitrate เดียวกัน ไฟล์จึงขนาดใกล้กันไม่ว่าตัวไหนทำ — ขนาดนี้คือสิ่งที่ตู้เน็ตช้าต้องอัปโหลด

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::video::{get_ffmpeg_path_public as get_ffmpeg_path, hidden_command};

/// วิดีโอเฟรม 9 วินาที (ด้านยาว 2160 px เช่น 1440x2160)
///
/// เดิม crf 18 เพดาน 16 Mbps: คลิปจริงที่ 1440x2160 ราว 5.7 Mbps = 6.3 MB ฉากขยับมากได้ถึง 18 MB
/// เพดาน 5 Mbps: คลิปเดียวกันเหลือ 4.3 MB (SSIM เทียบของเดิม 0.995) และไม่เกิน 5.6 MB เสมอ
/// ตู้ที่เน็ตวิ่ง 2 Mbps อัปโหลดเสร็จในราว 20 วินาที
pub const FRAME_VIDEO_BITRATE: Bitrate = Bitrate { target: "4M", max: "5M", buffer: "10M" };

#[derive(Clone, Copy, Debug)]
pub struct Bitrate {
    /// เป้าของการ์ดจอ (VBR) — libx264 ใช้ crf 18 แทน แล้วติดเพดาน `max` เท่ากัน
    pub target: &'static str,
    pub max: &'static str,
    pub buffer: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoder {
    #[serde(rename = "h264_qsv")]
    Qsv,
    #[serde(rename = "h264_nvenc")]
    Nvenc,
    #[serde(rename = "h264_amf")]
    Amf,
    #[serde(rename = "libx264")]
    X264,
}

const CANDIDATES: [Encoder; 4] = [Encoder::Qsv, Encoder::Nvenc, Encoder::Amf, Encoder::X264];

impl Encoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            Encoder::Qsv => "h264_qsv",
            Encoder::Nvenc => "h264_nvenc",
            Encoder::Amf => "h264_amf",
            Encoder::X264 => "libx264",
        }
    }

    /// อาร์กิวเมนต์ฝั่ง output: codec, การคุม bitrate, H.264 High profile level 5.1
    /// (เพดานที่ iPhone ถอดรหัสได้แน่นอน), pixel format
    pub fn args(self, rate: Bitrate) -> Vec<String> {
        let mut a: Vec<&str> = vec!["-c:v", self.ffmpeg_name()];
        match self {
            // level ของ qsv/nvenc/amf เป็นตัวเลข (51 = 5.1)
            Encoder::Qsv => a.extend(["-preset", "medium", "-profile:v", "high", "-level", "51", "-pix_fmt", "nv12", "-b:v", rate.target]),
            Encoder::Nvenc => a.extend(["-preset", "p5", "-tune", "hq", "-rc", "vbr", "-profile:v", "high", "-level", "51", "-pix_fmt", "yuv420p", "-b:v", rate.target]),
            Encoder::Amf => a.extend(["-quality", "balanced", "-rc", "vbr_peak", "-profile:v", "high", "-level", "51", "-pix_fmt", "yuv420p", "-b:v", rate.target]),
            // CPU: คุณภาพเท่าเดิม (crf 18) แค่เพดานต่ำลง
            Encoder::X264 => a.extend(["-preset", "medium", "-profile:v", "high", "-level", "5.1", "-pix_fmt", "yuv420p", "-crf", "18"]),
        }
        a.extend(["-maxrate", rate.max, "-bufsize", rate.buffer]);
        a.into_iter().map(String::from).collect()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Saved {
    /// ffmpeg.exe และไดรเวอร์การ์ดจอ ตอนที่เลือก
    key: String,
    encoder: Encoder,
    /// ชื่อการ์ดจอตามที่ Windows เรียก
    gpus: Vec<String>,
}

/// ตัวที่ใช้อยู่ เมื่อรู้แล้ว (ระหว่างยังไม่รู้ใช้ CPU)
static CHOSEN: Mutex<Option<Saved>> = Mutex::new(None);
static DETECTING: Mutex<()> = Mutex::new(());

fn saved_path() -> PathBuf {
    PathBuf::from(r"C:\boniobooth\video-encoder.json")
}

/// การ์ดจอพร้อมเวอร์ชันไดรเวอร์ (บรรทัดละ `ชื่อ|เวอร์ชัน`)
fn gpus() -> Vec<String> {
    #[cfg(windows)]
    {
        let out = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + '|' + $_.DriverVersion }",
            ])
            .output();
        if let Ok(out) = out {
            return String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        }
    }
    Vec::new()
}

/// สิ่งที่การเลือกขึ้นอยู่กับ: ffmpeg.exe (path, ขนาด, เวลา) และไดรเวอร์
fn key(gpus: &[String]) -> String {
    let ffmpeg = get_ffmpeg_path();
    let stamp = fs::metadata(&ffmpeg)
        .ok()
        .map(|m| format!("{}:{:?}", m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs())))
        .unwrap_or_default();
    format!("{ffmpeg}|{stamp}|{}", gpus.join(";"))
}

/// เข้ารหัสภาพทดสอบ 1 วินาทีขนาดเท่าวิดีโอจริงด้วย `enc` — ใช้ได้บนเครื่องนี้ไหม
fn works(enc: Encoder) -> bool {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1440x2160:rate=30", "-t", "1"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.extend(enc.args(FRAME_VIDEO_BITRATE));
    args.extend(["-f", "null", "-"].iter().map(|s| s.to_string()));
    let Ok(mut child) = hidden_command(&get_ffmpeg_path()).args(&args).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped()).spawn() else {
        return false;
    };
    // ไดรเวอร์บางตัวค้างแทนที่จะ error: ให้เวลาแต่ละตัว 20 วินาที
    for _ in 0..200 {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut e) = child.stderr.take() {
                        use std::io::Read;
                        let _ = e.read_to_string(&mut err);
                    }
                    log::info!("[encoder] {} not usable: {}", enc.ffmpeg_name(), err.lines().last().unwrap_or("").trim());
                }
                return status.success();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return false,
        }
    }
    let _ = child.kill();
    log::info!("[encoder] {} did not answer in 20 s", enc.ffmpeg_name());
    false
}

/// หาตัวเข้ารหัส (หรือใช้ตัวที่จำไว้ ถ้าสิ่งที่มันขึ้นอยู่กับไม่เปลี่ยน)
fn detect() -> Saved {
    let _one_at_a_time = DETECTING.lock().unwrap();
    let gpus = gpus();
    let key = key(&gpus);
    if let Some(saved) = fs::read(saved_path()).ok().and_then(|b| serde_json::from_slice::<Saved>(&b).ok()) {
        if saved.key == key {
            log::info!("[encoder] {} (saved)", saved.encoder.ffmpeg_name());
            return saved;
        }
    }
    let encoder = CANDIDATES.into_iter().find(|&e| e == Encoder::X264 || works(e)).unwrap_or(Encoder::X264);
    log::info!("[encoder] chose {} (graphics: {})", encoder.ffmpeg_name(), gpus.join(", "));
    let saved = Saved { key, encoder, gpus };
    if let Ok(text) = serde_json::to_vec_pretty(&saved) {
        let _ = fs::create_dir_all(r"C:\boniobooth");
        let _ = fs::write(saved_path(), text);
    }
    saved
}

/// ตอนเปิดโปรแกรม: หาตัวเข้ารหัสเบื้องหลัง (ระหว่างนั้นใช้ CPU)
pub fn detect_in_background() {
    std::thread::spawn(|| {
        let saved = detect();
        *CHOSEN.lock().unwrap() = Some(saved);
    });
}

/// เทส: เหมือน detect_in_background แต่รอจนเสร็จ
#[cfg(test)]
pub fn detect_now() {
    *CHOSEN.lock().unwrap() = Some(detect());
}

/// ตัวที่จะใช้ตอนนี้
pub fn current() -> Encoder {
    CHOSEN.lock().unwrap().as_ref().map(|s| s.encoder).unwrap_or(Encoder::X264)
}

/// การ์ดจอเข้ารหัสไม่ผ่าน: ใช้ CPU ไปจนปิดโปรแกรม แล้วครั้งหน้าทดสอบใหม่
fn hardware_failed(enc: Encoder) {
    if enc == Encoder::X264 {
        return;
    }
    log::warn!("[encoder] {} failed; using the CPU until the next start", enc.ffmpeg_name());
    if let Some(s) = CHOSEN.lock().unwrap().as_mut() {
        s.encoder = Encoder::X264;
    }
    let _ = fs::remove_file(saved_path());
}

/// เข้ารหัสด้วยตัวที่ใช้อยู่ ถ้าการ์ดจอพังก็ทำใหม่ด้วย CPU — `run` ได้อาร์กิวเมนต์ฝั่ง output ของตัวนั้น
pub fn encode_with_fallback(rate: Bitrate, mut run: impl FnMut(&[String]) -> Result<(), String>) -> Result<Encoder, String> {
    let enc = current();
    match run(&enc.args(rate)) {
        Ok(()) => Ok(enc),
        Err(e) if enc != Encoder::X264 => {
            log::warn!("[encoder] {} failed ({}); encoding on the CPU", enc.ffmpeg_name(), e.lines().last().unwrap_or(""));
            hardware_failed(enc);
            run(&Encoder::X264.args(rate)).map(|()| Encoder::X264)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_encoder_is_capped_at_the_same_bitrate() {
        for e in CANDIDATES {
            let a = e.args(FRAME_VIDEO_BITRATE).join(" ");
            assert!(a.contains("-maxrate 5M -bufsize 10M"), "{a}");
            assert!(a.starts_with(&format!("-c:v {}", e.ffmpeg_name())), "{a}");
            assert!(a.contains("-profile:v high"), "{a}");
        }
        assert!(Encoder::X264.args(FRAME_VIDEO_BITRATE).join(" ").contains("-crf 18"));
        assert!(Encoder::Nvenc.args(FRAME_VIDEO_BITRATE).join(" ").contains("-b:v 4M"));
    }

    #[test]
    fn falls_back_to_the_cpu() {
        *CHOSEN.lock().unwrap() = Some(Saved { key: String::new(), encoder: Encoder::Nvenc, gpus: vec![] });
        let mut tries = Vec::new();
        let used = encode_with_fallback(FRAME_VIDEO_BITRATE, |a| {
            tries.push(a[1].clone());
            if a[1] == "h264_nvenc" { Err("driver".into()) } else { Ok(()) }
        })
        .unwrap();
        assert_eq!(used, Encoder::X264);
        assert_eq!(tries, ["h264_nvenc", "libx264"]);
        assert_eq!(current(), Encoder::X264);
        *CHOSEN.lock().unwrap() = None;
    }

    /// `BONIO_FFMPEG=... cargo test --lib detects_on_this_pc -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn detects_on_this_pc() {
        let saved = detect();
        println!("encoder: {:?}, gpus: {:?}", saved.encoder, saved.gpus);
    }
}
