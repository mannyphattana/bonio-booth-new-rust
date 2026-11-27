//! ทำให้แอปตู้เปิดอยู่ตลอด
//!
//! แอปที่ติดตั้งแล้วจะเริ่มเป็น supervisor ตัวเล็กๆ ไม่มีหน้าต่าง ซึ่งเปิดแอปจริง (exe ตัวเดียวกัน
//! พร้อม `BONIO_SUPERVISED=1`) และเปิดใหม่ทุกครั้งที่แอปปิดไป: crash, End task, หน้าต่างถูกปิด
//! (Alt+F4) หรือ watchdog ของแอปเองเมื่อหน้าจอค้าง (`ui_heartbeat` หายไป 60 วินาที)
//! ลูกค้าที่จ่ายเงินแล้วกลับไปทำต่อจากขั้นเดิมด้วย recovery.rs ที่มีอยู่แล้ว
//!
//! แอปปิดถาวรได้เฉพาะเมื่อบอกก่อน ([`quit_for_good`]): ปิดโปรแกรมจากเมนูแอดมิน, backend สั่งปิด
//! (close-app), ปิดตามเวลาทำการ, ติดตั้งอัปเดต — debug build (`tauri dev`) ไม่มี supervisor

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DIR: &str = r"C:\boniobooth\supervisor";
const ENV_SUPERVISED: &str = "BONIO_SUPERVISED";
const ENV_LAST_EXIT: &str = "BONIO_LAST_EXIT";
const ENV_EXIT_CODE: &str = "BONIO_EXIT_CODE";
const ENV_RESTARTS: &str = "BONIO_RESTARTS";

/// watchdog: หน้าจอไม่ตอบ
pub const HANG_EXIT_CODE: i32 = 70;

/// หน้าจอเงียบได้นานเท่านี้ก่อนจะถูกเปิดใหม่
const HANG_AFTER: Duration = Duration::from_secs(60);
/// รันสั้นกว่านี้นับเป็น crash วน — วนหลายรอบจะรอนานขึ้นก่อนเปิดใหม่
const QUICK_RUN: Duration = Duration::from_secs(30);

fn dir() -> PathBuf {
    PathBuf::from(DIR)
}

fn quit_flag() -> PathBuf {
    dir().join("quit.flag")
}

fn log_path() -> PathBuf {
    dir().join("supervisor.log")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// process นี้รันใต้ supervisor หรือไม่ (แอปที่ติดตั้งแล้ว)
pub fn supervised() -> bool {
    std::env::var_os(ENV_SUPERVISED).is_some()
}

/// เรียกเป็นอย่างแรกใน `main` — release build ที่ไม่ได้ถูก supervisor เปิด process นี้จะกลายเป็น
/// supervisor และไม่ return; นอกนั้น return แล้วแอปเริ่มตามปกติ (รวมถึงตอนตั้ง supervisor ไม่ได้:
/// แอปที่ไม่มี supervisor ดีกว่าไม่มีแอป)
pub fn run_or_supervise() {
    if cfg!(debug_assertions) || supervised() || std::env::var_os("BONIO_NO_SUPERVISOR").is_some() {
        return;
    }
    let _ = fs::create_dir_all(dir());
    let lock = match open_exclusive(&dir().join("supervisor.lock")) {
        Ok(lock) => lock,
        // ERROR_SHARING_VIOLATION: มี supervisor อีกตัวถืออยู่ (เปิดซ้ำ, ทั้ง Startup และกดเอง)
        // ตัวนั้นดูแลแอปอยู่แล้ว
        Err(e) if e.raw_os_error() == Some(32) => std::process::exit(0),
        Err(e) => {
            note(&format!("no supervisor (lock: {e}); running the app directly"));
            return;
        }
    };
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            note(&format!("no supervisor (own exe: {e}); running the app directly"));
            return;
        }
    };
    supervise(lock, exe);
}

fn note(line: &str) {
    let path = log_path();
    // log เล็กๆ: เกิน 1 MB เริ่มใหม่
    if fs::metadata(&path).map(|m| m.len() > 1024 * 1024).unwrap_or(false) {
        let _ = fs::remove_file(&path);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", utc_now());
    }
}

/// เวลา UTC แบบ `YYYY-MM-DD HH:MM:SSZ` โดยไม่ต้องเพิ่ม dependency
fn utc_now() -> String {
    let secs = now_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// จำนวนวันนับจาก 1970-01-01 → (ปี, เดือน, วัน) ตามอัลกอริทึมของ Howard Hinnant
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// แอปจบเพราะอะไร
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ended {
    /// แอปบอกว่าจะปิดถาวร: supervisor ปิดตาม
    Quit,
    /// watchdog: หน้าจอค้าง
    Hang,
    /// หน้าต่างถูกปิด (Alt+F4) โดยแอปไม่ได้บอก
    Closed,
    /// crash หรือถูก kill
    Crash,
}

fn classify(code: Option<i32>, quit_requested: bool) -> Ended {
    match code {
        _ if quit_requested => Ended::Quit,
        Some(HANG_EXIT_CODE) => Ended::Hang,
        Some(0) => Ended::Closed,
        _ => Ended::Crash,
    }
}

/// `lock`: supervisor ได้แค่ตัวเดียวต่อเครื่อง ถือเปิดไว้แบบไม่แชร์ตลอดอายุ process นี้
fn supervise(lock: File, exe: PathBuf) -> ! {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let _ = fs::remove_file(quit_flag());
    note(&format!("supervisor started ({})", exe.display()));

    let mut last: Option<(Ended, Option<i32>)> = None;
    let mut restarts: u32 = 0;
    let mut quick_runs: u32 = 0;
    loop {
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(&args).env(ENV_SUPERVISED, "1").env(ENV_RESTARTS, restarts.to_string());
        if let Some((ended, code)) = last {
            let reason = match ended {
                Ended::Hang => "hang",
                Ended::Closed => "closed",
                Ended::Crash => "crash",
                Ended::Quit => "",
            };
            if !reason.is_empty() {
                cmd.env(ENV_LAST_EXIT, reason);
            }
            if let Some(code) = code {
                cmd.env(ENV_EXIT_CODE, code.to_string());
            }
        }
        let started = Instant::now();
        let status = match cmd.spawn().and_then(|mut child| child.wait()) {
            Ok(status) => status,
            Err(e) => {
                note(&format!("could not start the app: {e}"));
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
        };
        let quit_requested = take_quit_flag();
        let code = status.code();
        let ended = classify(code, quit_requested);
        note(&format!("app ended: {ended:?} (exit code {code:?}) after {}s", started.elapsed().as_secs()));
        if ended == Ended::Quit {
            note("supervisor ends");
            drop(lock);
            std::process::exit(0);
        }
        restarts += 1;
        quick_runs = if started.elapsed() < QUICK_RUN { quick_runs + 1 } else { 0 };
        // crash วน (อัปเดตพัง, เครื่องมีปัญหา): ยังเปิดต่อ แต่ไม่ถี่จนเครื่องหนัก
        let wait = if quick_runs >= 5 { Duration::from_secs(60) } else { Duration::from_secs(2) };
        std::thread::sleep(wait);
        last = Some((ended, code));
    }
}

#[cfg(windows)]
fn open_exclusive(path: &PathBuf) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new().create(true).truncate(false).write(true).share_mode(0).open(path)
}

#[cfg(not(windows))]
fn open_exclusive(path: &PathBuf) -> std::io::Result<File> {
    OpenOptions::new().create(true).truncate(false).write(true).open(path)
}

/// true (และลบ flag) ถ้าแอปบอกว่าจะปิดถาวรภายใน 10 นาทีที่ผ่านมา
fn take_quit_flag() -> bool {
    let path = quit_flag();
    let Ok(text) = fs::read_to_string(&path) else { return false };
    let _ = fs::remove_file(&path);
    text.trim().parse::<u64>().is_ok_and(|at| now_secs().saturating_sub(at) < 600)
}

/// แอปกำลังจะปิดและไม่ต้องเปิดใหม่ (ปิดโปรแกรม, ปิดตามเวลา, ติดตั้งอัปเดต)
pub fn quit_for_good() {
    if let Err(e) = fs::create_dir_all(dir()).and_then(|_| fs::write(quit_flag(), now_secs().to_string())) {
        log::warn!("[supervisor] could not leave the quit flag: {e}");
    }
}

/// หน้าจอ: กำลังจะติดตั้งอัปเดต (ตัวติดตั้งปิดแอปเอง) — อย่าเปิดแอปเก่าขึ้นมาแย่งตัวติดตั้ง
#[tauri::command]
pub fn supervisor_quit_for_good() {
    log::info!("[supervisor] the app will close for an update");
    quit_for_good();
}

/// อัปเดตไม่ได้ติดตั้งจริง: กลับไปเปิดใหม่เมื่อแอปปิดตามเดิม
#[tauri::command]
pub fn supervisor_cancel_quit() {
    let _ = fs::remove_file(quit_flag());
}

// ---------------------------------------------------------------------------------------------
// Watchdog: หน้าจอส่ง `ui_heartbeat` ทุก 5 วินาที ถ้าเงียบไป HANG_AFTER แปลว่าแอปค้าง (หน้าเว็บค้าง,
// WebView2 พัง, main thread ติด) ปิดแอปให้ supervisor เปิดใหม่

static ARMED: AtomicBool = AtomicBool::new(false);
static LAST_BEAT: AtomicU64 = AtomicU64::new(0);
static ORIGIN: Mutex<Option<Instant>> = Mutex::new(None);

fn origin() -> Instant {
    *ORIGIN.lock().unwrap().get_or_insert_with(Instant::now)
}

fn mono_ms(origin: Instant) -> u64 {
    origin.elapsed().as_millis() as u64
}

/// `ui_heartbeat`: หน้าจอยังทำงาน
#[tauri::command]
pub fn ui_heartbeat() {
    LAST_BEAT.store(mono_ms(origin()), Ordering::Relaxed);
    ARMED.store(true, Ordering::Relaxed);
}

/// เริ่ม watchdog (เฉพาะตอนมี supervisor: ไม่มีก็ไม่มีใครเปิดแอปใหม่ให้)
pub fn start_watchdog() {
    if !supervised() {
        return;
    }
    let origin = origin();
    std::thread::spawn(move || {
        let tick = Duration::from_secs(5);
        let mut wall = SystemTime::now();
        loop {
            std::thread::sleep(tick);
            let now_wall = SystemTime::now();
            let gap = now_wall.duration_since(wall).unwrap_or_default();
            wall = now_wall;
            let now = mono_ms(origin);
            // เครื่อง sleep ไป (หรือ thread นี้ไม่ได้รัน): ให้หน้าจอเริ่มนับใหม่
            if gap > tick * 4 {
                LAST_BEAT.store(now, Ordering::Relaxed);
                continue;
            }
            if !ARMED.load(Ordering::Relaxed) {
                continue;
            }
            let silent = Duration::from_millis(now.saturating_sub(LAST_BEAT.load(Ordering::Relaxed)));
            if silent >= HANG_AFTER {
                log::error!("[watchdog] the screen has not answered for {}s; restarting the app", silent.as_secs());
                log::logger().flush();
                std::process::exit(HANG_EXIT_CODE);
            }
        }
    });
}

/// ครั้งก่อนแอปจบเพราะอะไร (ถ้าถูกเปิดใหม่หลัง crash / ค้าง / ถูกปิดหน้าต่าง)
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastExit {
    /// "crash" | "hang" | "closed"
    pub reason: String,
    pub exit_code: Option<i64>,
    /// ครั้งที่เท่าไหร่ที่ supervisor ตัวนี้เปิดใหม่
    pub restarts: u32,
}

static LAST_EXIT: Mutex<Option<LastExit>> = Mutex::new(None);

/// อ่านเหตุผลจาก supervisor ตอนเริ่มแอป — เรียกครั้งเดียวใน setup
pub fn note_startup() {
    let Some(reason) = std::env::var(ENV_LAST_EXIT).ok().filter(|r| !r.is_empty()) else { return };
    let exit_code = std::env::var(ENV_EXIT_CODE).ok().and_then(|c| c.parse::<i64>().ok());
    let restarts = std::env::var(ENV_RESTARTS).ok().and_then(|c| c.parse::<u32>().ok()).unwrap_or(0);
    log::warn!("[supervisor] started again after {reason} (exit code {exit_code:?}, restart {restarts})");
    *LAST_EXIT.lock().unwrap() = Some(LastExit { reason, exit_code, restarts });
}

/// หน้าจอ: แอปเพิ่งถูกเปิดใหม่เพราะอะไร (ครั้งเดียว) ให้ส่งเข้า error log ของ backend
#[tauri::command]
pub fn supervisor_last_exit() -> Option<LastExit> {
    LAST_EXIT.lock().unwrap().take()
}

// ---------------------------------------------------------------------------------------------
// เปิดเองตอนเปิดเครื่อง: HKCU\...\Run (ไม่ต้องใช้สิทธิ์ admin) ชี้ไปที่ exe นี้

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "BonioBooth";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Autostart {
    pub enabled: bool,
    /// ตั้งไว้ แต่ชี้ไปที่แอปตัวอื่น (โฟลเดอร์ติดตั้งเก่า)
    pub other_path: Option<String>,
}

fn reg(args: &[&str]) -> Option<std::process::Output> {
    crate::video::hidden_command("reg.exe").args(args).output().ok()
}

/// `    BonioBooth    REG_SZ    "C:\...\Bonio Booth.exe"` → `"C:\...\Bonio Booth.exe"`
fn parse_reg_sz(text: &str) -> Option<String> {
    let line = text.lines().find(|l| l.contains("REG_SZ"))?;
    let (_, value) = line.split_once("REG_SZ")?;
    Some(value.trim().to_string()).filter(|v| !v.is_empty())
}

#[tauri::command]
pub fn get_autostart() -> Autostart {
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let value = reg(&["query", RUN_KEY, "/v", RUN_VALUE])
        .filter(|out| out.status.success())
        .and_then(|out| parse_reg_sz(&String::from_utf8_lossy(&out.stdout)));
    match value {
        Some(v) if !exe.is_empty() && v.to_lowercase().contains(&exe.to_lowercase()) => Autostart { enabled: true, other_path: None },
        Some(v) => Autostart { enabled: false, other_path: Some(v) },
        None => Autostart { enabled: false, other_path: None },
    }
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<Autostart, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let data = format!("\"{}\"", exe.display());
    let args: Vec<&str> = if enabled {
        vec!["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &data, "/f"]
    } else {
        vec!["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]
    };
    let out = reg(&args).ok_or("เรียก reg.exe ไม่ได้")?;
    let now = get_autostart();
    if now.enabled != enabled {
        return Err(format!("ตั้งค่าไม่สำเร็จ: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    log::info!("[supervisor] start with Windows {}", if enabled { "on" } else { "off" });
    Ok(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_exits() {
        assert_eq!(classify(Some(0), true), Ended::Quit);
        assert_eq!(classify(Some(1), true), Ended::Quit);
        assert_eq!(classify(Some(HANG_EXIT_CODE), false), Ended::Hang);
        assert_eq!(classify(Some(0), false), Ended::Closed);
        assert_eq!(classify(Some(-1073741819), false), Ended::Crash); // 0xC0000005
        assert_eq!(classify(None, false), Ended::Crash);
    }

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_419), (2025, 11, 27));
    }

    #[test]
    fn reg_sz() {
        let out = concat!("\r\nHKEY_CURRENT_USER\\Run\r\n    BonioBooth    REG_SZ    ", r#""C:\Program Files\Bonio Booth\Bonio Booth.exe""#, "\r\n");
        assert_eq!(parse_reg_sz(out).as_deref(), Some(r#""C:\Program Files\Bonio Booth\Bonio Booth.exe""#));
        assert_eq!(parse_reg_sz("ERROR: not found"), None);
    }
}
