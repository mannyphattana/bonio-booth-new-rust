//! Printer status & print-job tracking ผ่าน Windows spooler (winspool)
//!
//! แยกออกมาจาก printer.rs เพราะเป็นคนละหน้าที่กัน:
//!   - printer.rs      = "ส่งงานพิมพ์" (compose ภาพ + GDI draw)
//!   - print_status.rs = "งานพิมพ์นั้นเกิดอะไรขึ้น" (อ่านสถานะกลับมา)
//!
//! ทั้งหมดใช้ Win32 API ตรง ๆ ผ่าน `windows` crate ที่มีอยู่แล้วใน Cargo.toml
//! (feature `Win32_Graphics_Printing`) — ไม่พึ่ง PowerShell/WMI และไม่ผูกกับ
//! ยี่ห้อเครื่องพิมพ์ ใช้ได้กับทุกเครื่องที่มี driver บน Windows
//!
//! L1 = สถานะเครื่องพิมพ์  (GetPrinter level 2 -> PRINTER_INFO_2W.Status)
//! L2 = สถานะงานพิมพ์รายใบ (GetJob level 1     -> JOB_INFO_1W.Status)

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// L1: Printer status bitmask
// ---------------------------------------------------------------------------

/// ตาราง PRINTER_STATUS_* ของ Win32
///
/// Status ที่ spooler คืนมาเป็น **bitmask** — เลขก้อนเดียวที่แต่ละบิตแทนคำตอบ
/// yes/no คนละข้อ เช่น 0x18 = 0x10 (กระดาษหมด) + 0x08 (กระดาษติด) พร้อมกัน
/// จึงต้องอ่านด้วย `status & BIT != 0` ห้ามใช้ `status == BIT`
///
/// tuple = (bit, ชื่อ flag, ข้อความไทย, kind) โดย kind:
///   0 = ปกติ/กำลังทำงาน   1 = error ต้องให้คนไปจัดการ   2 = ติดต่อเครื่องไม่ได้
const PRINTER_FLAGS: &[(u32, &str, &str, u8)] = &[
    (0x0000_0001, "PAUSED", "คิวพิมพ์ถูกพักไว้ (Paused)", 1),
    (0x0000_0002, "ERROR", "เครื่องพิมพ์แจ้ง error", 1),
    (0x0000_0004, "PENDING_DELETION", "กำลังลบงานพิมพ์", 0),
    (0x0000_0008, "PAPER_JAM", "กระดาษติด", 1),
    (0x0000_0010, "PAPER_OUT", "กระดาษหมด", 1),
    (0x0000_0020, "MANUAL_FEED", "รอป้อนกระดาษด้วยมือ", 1),
    (0x0000_0040, "PAPER_PROBLEM", "ปัญหาเกี่ยวกับกระดาษ", 1),
    (0x0000_0080, "OFFLINE", "เครื่องพิมพ์ offline", 2),
    (0x0000_0100, "IO_ACTIVE", "กำลังรับส่งข้อมูล", 0),
    (0x0000_0200, "BUSY", "เครื่องพิมพ์ไม่ว่าง", 0),
    (0x0000_0400, "PRINTING", "กำลังพิมพ์", 0),
    (0x0000_0800, "OUTPUT_BIN_FULL", "ถาดรับงานเต็ม", 1),
    (0x0000_1000, "NOT_AVAILABLE", "เครื่องพิมพ์ใช้งานไม่ได้", 2),
    (0x0000_2000, "WAITING", "รอคิว", 0),
    (0x0000_4000, "PROCESSING", "กำลังประมวลผลงานพิมพ์", 0),
    (0x0000_8000, "INITIALIZING", "กำลังเริ่มต้นเครื่อง", 0),
    (0x0001_0000, "WARMING_UP", "กำลังอุ่นเครื่อง", 0),
    (0x0002_0000, "TONER_LOW", "หมึก/ริบบิ้นใกล้หมด", 0),
    (0x0004_0000, "NO_TONER", "หมึก/ริบบิ้นหมด", 1),
    (0x0008_0000, "PAGE_PUNT", "เครื่องพิมพ์หน้านี้ไม่ไหว", 1),
    (
        0x0010_0000,
        "USER_INTERVENTION",
        "ต้องให้คนไปจัดการที่เครื่อง (ฝาเปิด/ริบบิ้น/กระดาษ)",
        1,
    ),
    (0x0020_0000, "OUT_OF_MEMORY", "หน่วยความจำเครื่องพิมพ์ไม่พอ", 1),
    (0x0040_0000, "DOOR_OPEN", "ฝาเครื่องพิมพ์เปิดอยู่", 1),
    (0x0080_0000, "SERVER_UNKNOWN", "print server ไม่รายงานสถานะ", 2),
    (0x0100_0000, "POWER_SAVE", "อยู่ในโหมดประหยัดพลังงาน", 0),
];

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PrinterStatusDetail {
    /// ค่า bitmask ดิบจาก spooler — เก็บไว้ debug เวลามี flag แปลก ๆ โผล่มา
    pub raw: u32,
    /// ชื่อ flag ที่ติดอยู่ เช่น ["PAPER_OUT", "DOOR_OPEN"]
    pub flags: Vec<String>,
    /// ข้อความไทยพร้อมโชว์/ส่งเข้า log
    pub message: String,
    /// มี error ที่ต้องให้คนไปจัดการที่เครื่อง
    pub is_error: bool,
    /// ติดต่อเครื่องไม่ได้
    pub is_offline: bool,
    /// กำลังทำงานอยู่ (ไม่ใช่ error — ห้ามเอาไปนับเป็น disconnect)
    pub is_busy: bool,
    /// จำนวนงานค้างในคิว
    pub jobs_in_queue: u32,
}

/// แปลง bitmask เป็นข้อมูลที่อ่านรู้เรื่อง
///
/// เป็น pure function ไม่แตะ Win32 — เทสต์ได้และคอมไพล์ได้ทุก OS
pub fn decode_printer_status(raw: u32, jobs_in_queue: u32) -> PrinterStatusDetail {
    let mut flags = Vec::new();
    let mut errors = Vec::new();
    let mut offline_msgs = Vec::new();
    let mut busy_msgs = Vec::new();

    for (bit, name, th, kind) in PRINTER_FLAGS {
        if raw & bit != 0 {
            flags.push((*name).to_string());
            match kind {
                1 => errors.push(*th),
                2 => offline_msgs.push(*th),
                _ => busy_msgs.push(*th),
            }
        }
    }

    // บิตที่เราไม่รู้จัก (driver แปลก ๆ หรือ Windows รุ่นใหม่) — อย่ากลืนหาย
    let known: u32 = PRINTER_FLAGS.iter().fold(0, |acc, (b, _, _, _)| acc | b);
    let unknown = raw & !known;
    if unknown != 0 {
        flags.push(format!("UNKNOWN(0x{:X})", unknown));
    }

    let is_error = !errors.is_empty();
    let is_offline = !offline_msgs.is_empty();
    let is_busy = !busy_msgs.is_empty();

    let message = if is_error || is_offline {
        offline_msgs
            .into_iter()
            .chain(errors.into_iter())
            .collect::<Vec<_>>()
            .join(" + ")
    } else if is_busy {
        busy_msgs.join(" + ")
    } else {
        "พร้อมใช้งาน".to_string()
    };

    PrinterStatusDetail {
        raw,
        flags,
        message,
        is_error,
        is_offline,
        is_busy,
        jobs_in_queue,
    }
}

// ---------------------------------------------------------------------------
// L2: Job status bitmask
// ---------------------------------------------------------------------------

/// ตาราง JOB_STATUS_* ของ Win32 (เป็น bitmask เหมือนกัน)
const JOB_FLAGS: &[(u32, &str, &str, u8)] = &[
    (0x0000_0001, "PAUSED", "งานพิมพ์ถูกพัก", 1),
    (0x0000_0002, "ERROR", "งานพิมพ์ error", 1),
    (0x0000_0004, "DELETING", "กำลังยกเลิกงานพิมพ์", 1),
    (0x0000_0008, "SPOOLING", "กำลังส่งข้อมูลเข้าคิว", 0),
    (0x0000_0010, "PRINTING", "กำลังพิมพ์", 0),
    (0x0000_0020, "OFFLINE", "เครื่องพิมพ์ offline", 1),
    (0x0000_0040, "PAPEROUT", "กระดาษหมด", 1),
    (0x0000_0080, "PRINTED", "พิมพ์เสร็จแล้ว", 0),
    (0x0000_0100, "DELETED", "งานพิมพ์ถูกลบ", 1),
    (0x0000_0200, "BLOCKED_DEVQ", "คิวถูกบล็อก (เครื่องไม่รับงาน)", 1),
    (0x0000_0400, "USER_INTERVENTION", "ต้องให้คนไปจัดการที่เครื่อง", 1),
    (0x0000_0800, "RESTART", "งานพิมพ์ถูกสั่งเริ่มใหม่", 0),
    (0x0000_1000, "COMPLETE", "งานพิมพ์เสร็จสมบูรณ์", 0),
    (0x0000_2000, "RETAINED", "ถูกเก็บไว้ในคิวหลังพิมพ์เสร็จ", 0),
    (0x0000_4000, "RENDERING_LOCALLY", "กำลัง render ที่เครื่องนี้", 0),
];

const JOB_SPOOLING: u32 = 0x0000_0008;
const JOB_PRINTING: u32 = 0x0000_0010;
const JOB_PRINTED: u32 = 0x0000_0080;
const JOB_COMPLETE: u32 = 0x0000_1000;
const JOB_DELETED: u32 = 0x0000_0100;
const JOB_DELETING: u32 = 0x0000_0004;

/// บิตที่แปลว่า "งานนี้ไปต่อไม่ได้จนกว่าจะมีคนมาแก้"
const JOB_BLOCKED_MASK: u32 = 0x0000_0001 // PAUSED
    | 0x0000_0002 // ERROR
    | 0x0000_0020 // OFFLINE
    | 0x0000_0040 // PAPEROUT
    | 0x0000_0200 // BLOCKED_DEVQ
    | 0x0000_0400; // USER_INTERVENTION

fn decode_job_flags(raw: u32) -> (Vec<String>, String) {
    let mut flags = Vec::new();
    let mut msgs = Vec::new();
    for (bit, name, th, kind) in JOB_FLAGS {
        if raw & bit != 0 {
            flags.push((*name).to_string());
            if *kind == 1 {
                msgs.push(*th);
            }
        }
    }
    (flags, msgs.join(" + "))
}

/// สถานะงานพิมพ์ที่ส่งขึ้น frontend ผ่าน event `print-job-update`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintJobUpdate {
    pub job_id: u32,
    pub printer: String,
    /// spooling | printing | queued | blocked | printed | error | timeout
    pub state: String,
    pub detail: String,
    pub job_flags: Vec<String>,
    pub job_status_raw: u32,
    pub pages_printed: u32,
    pub total_pages: u32,
    pub printer_status: PrinterStatusDetail,
    pub elapsed_ms: u64,
    /// true  = ยืนยันได้ว่าพิมพ์เสร็จจริง (เห็นบิต PRINTED/COMPLETE)
    /// false = งานหายจากคิวไปเฉย ๆ ซึ่ง "น่าจะ" เสร็จ แต่ยืนยันไม่ได้
    pub verified: bool,
    /// true = อัปเดตครั้งสุดท้ายของงานนี้
    pub is_final: bool,
}

// ---------------------------------------------------------------------------
// Win32 implementation
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win {
    use super::{decode_printer_status, PrinterStatusDetail};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, GetJobW, GetPrinterW, OpenPrinterW, JOB_INFO_1W, PRINTER_INFO_2W,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// RAII guard — ปิด printer handle เสมอแม้จะ early return
    struct PrinterHandle(HANDLE);

    impl PrinterHandle {
        fn open(printer_name: &str) -> Result<Self, String> {
            let wide = to_wide(printer_name);
            let mut h = HANDLE::default();
            unsafe {
                OpenPrinterW(PCWSTR(wide.as_ptr()), &mut h, None)
                    .map_err(|e| format!("OpenPrinter('{}') failed: {}", printer_name, e))?;
            }
            Ok(PrinterHandle(h))
        }
    }

    impl Drop for PrinterHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }

    /// L1 — อ่านสถานะเครื่องพิมพ์จาก PRINTER_INFO_2W
    pub fn query_printer_status(printer_name: &str) -> Result<PrinterStatusDetail, String> {
        let handle = PrinterHandle::open(printer_name)?;

        unsafe {
            // รอบแรกถามขนาด buffer — คืน Err(ERROR_INSUFFICIENT_BUFFER) เป็นเรื่องปกติ
            let mut needed: u32 = 0;
            let _ = GetPrinterW(handle.0, 2, None, &mut needed);
            if needed == 0 {
                return Err(format!("GetPrinter('{}') ไม่คืนขนาด buffer", printer_name));
            }

            let mut buf = vec![0u8; needed as usize];
            GetPrinterW(handle.0, 2, Some(&mut buf), &mut needed)
                .map_err(|e| format!("GetPrinter('{}') failed: {}", printer_name, e))?;

            let info = &*(buf.as_ptr() as *const PRINTER_INFO_2W);
            Ok(decode_printer_status(info.Status, info.cJobs))
        }
    }

    /// L2 — อ่านสถานะงานพิมพ์ 1 ใบ: คืน (status_bits, pages_printed, total_pages)
    ///
    /// คืน `Ok(None)` เมื่องานไม่อยู่ในคิวแล้ว (พิมพ์เสร็จแล้วถูก purge หรือถูกลบ)
    pub fn query_job(printer_name: &str, job_id: u32) -> Result<Option<(u32, u32, u32)>, String> {
        let handle = PrinterHandle::open(printer_name)?;

        unsafe {
            let mut needed: u32 = 0;
            let _ = GetJobW(handle.0, job_id, 1, None, &mut needed);
            // งานหายจากคิวแล้ว spooler จะไม่คืนขนาด buffer มา
            if needed == 0 {
                return Ok(None);
            }

            let mut buf = vec![0u8; needed as usize];
            if !GetJobW(handle.0, job_id, 1, Some(&mut buf), &mut needed).as_bool() {
                // แข่งกับ spooler พอดี — งานเพิ่งหายไประหว่างสองครั้งที่เรียก
                return Ok(None);
            }

            let info = &*(buf.as_ptr() as *const JOB_INFO_1W);
            Ok(Some((info.Status, info.PagesPrinted, info.TotalPages)))
        }
    }
}

#[cfg(target_os = "windows")]
pub use win::{query_job, query_printer_status};

#[cfg(not(target_os = "windows"))]
pub fn query_printer_status(_printer_name: &str) -> Result<PrinterStatusDetail, String> {
    Err("printer status รองรับเฉพาะ Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn query_job(_printer_name: &str, _job_id: u32) -> Result<Option<(u32, u32, u32)>, String> {
    Err("job status รองรับเฉพาะ Windows".to_string())
}

// ---------------------------------------------------------------------------
// Job monitor
// ---------------------------------------------------------------------------

/// ระยะห่างระหว่างการ poll สถานะงานพิมพ์
const POLL_INTERVAL_MS: u64 = 1_000;
/// เพดานเวลารองานหนึ่งใบ — dye-sub 4x6 ใช้ ~15-25 วิ เผื่อคิวซ้อนไว้ถึง 3 นาที
const JOB_TIMEOUT_MS: u64 = 180_000;

/// ติดตามงานพิมพ์ใน background thread แล้วยิง event `print-job-update` ขึ้น frontend
///
/// ไม่ block `print_photo` — UX เดิม (กดปริ้นแล้วไปหน้าถัดไปเลย) ไม่เปลี่ยน
/// แต่ตอนนี้แอพจะ "รู้" ว่าใบนั้นออกจริงไหม และถ้าไม่ออกเป็นเพราะอะไร
pub fn spawn_job_monitor(app: tauri::AppHandle, printer: String, job_id: u32) {
    std::thread::spawn(move || {
        monitor_loop(app, printer, job_id);
    });
}

fn emit_update(app: &tauri::AppHandle, update: PrintJobUpdate) {
    use tauri::Emitter;

    if update.is_final || update.state == "blocked" {
        log::warn!(
            "[PrintJob] job={} printer='{}' state={} detail='{}' printer_status='{}' flags={:?}",
            update.job_id,
            update.printer,
            update.state,
            update.detail,
            update.printer_status.message,
            update.printer_status.flags
        );
    } else {
        log::info!(
            "[PrintJob] job={} state={} ({}/{} หน้า)",
            update.job_id,
            update.state,
            update.pages_printed,
            update.total_pages
        );
    }

    if let Err(e) = app.emit("print-job-update", &update) {
        log::error!("[PrintJob] emit ล้มเหลว: {}", e);
    }
}

fn monitor_loop(app: tauri::AppHandle, printer: String, job_id: u32) {
    let started = std::time::Instant::now();
    let mut last_emitted: Option<(String, String)> = None;
    let mut ever_seen = false;
    let mut last_status: u32 = 0;
    let mut last_pages: (u32, u32) = (0, 0);

    loop {
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let printer_status = query_printer_status(&printer).unwrap_or_default();

        match query_job(&printer, job_id) {
            Ok(Some((status, pages_printed, total_pages))) => {
                ever_seen = true;
                last_status = status;
                last_pages = (pages_printed, total_pages);

                let (job_flags, blocked_msg) = decode_job_flags(status);

                // พิมพ์เสร็จจริง — ยืนยันได้
                if status & (JOB_PRINTED | JOB_COMPLETE) != 0 {
                    emit_update(
                        &app,
                        PrintJobUpdate {
                            job_id,
                            printer: printer.clone(),
                            state: "printed".into(),
                            detail: "พิมพ์เสร็จเรียบร้อย".into(),
                            job_flags,
                            job_status_raw: status,
                            pages_printed,
                            total_pages,
                            printer_status,
                            elapsed_ms,
                            verified: true,
                            is_final: true,
                        },
                    );
                    return;
                }

                // ถูกยกเลิก/ลบ — จบเลย ไม่ต้องรอ timeout
                if status & (JOB_DELETED | JOB_DELETING) != 0 {
                    emit_update(
                        &app,
                        PrintJobUpdate {
                            job_id,
                            printer: printer.clone(),
                            state: "error".into(),
                            detail: "งานพิมพ์ถูกยกเลิก/ลบออกจากคิว".into(),
                            job_flags,
                            job_status_raw: status,
                            pages_printed,
                            total_pages,
                            printer_status,
                            elapsed_ms,
                            verified: false,
                            is_final: true,
                        },
                    );
                    return;
                }

                // ยังไม่จบ — รายงานความคืบหน้า/สาเหตุที่ค้าง
                // blocked ไม่ return เพราะพอแก้แล้ว (ปิดฝา/ใส่ริบบิ้น) งานเดินต่อได้เอง
                let blocked = status & JOB_BLOCKED_MASK != 0 || printer_status.is_error;
                let state = if blocked {
                    "blocked"
                } else if status & JOB_SPOOLING != 0 {
                    "spooling"
                } else if status & JOB_PRINTING != 0 {
                    "printing"
                } else {
                    "queued"
                };

                let detail = if blocked {
                    let mut parts: Vec<String> = Vec::new();
                    if !blocked_msg.is_empty() {
                        parts.push(blocked_msg);
                    }
                    if printer_status.is_error || printer_status.is_offline {
                        parts.push(printer_status.message.clone());
                    }
                    if parts.is_empty() {
                        "งานพิมพ์ค้างในคิว".to_string()
                    } else {
                        parts.join(" | ")
                    }
                } else {
                    String::new()
                };

                // ยิงเฉพาะตอนสถานะเปลี่ยน — กัน event spam ทุกวินาที
                let key = (state.to_string(), detail.clone());
                if last_emitted.as_ref() != Some(&key) {
                    last_emitted = Some(key);
                    emit_update(
                        &app,
                        PrintJobUpdate {
                            job_id,
                            printer: printer.clone(),
                            state: state.into(),
                            detail,
                            job_flags,
                            job_status_raw: status,
                            pages_printed,
                            total_pages,
                            printer_status,
                            elapsed_ms,
                            verified: false,
                            is_final: false,
                        },
                    );
                }
            }

            // งานหายจากคิว
            Ok(None) => {
                let (job_flags, blocked_msg) = decode_job_flags(last_status);
                let had_trouble = last_status & JOB_BLOCKED_MASK != 0;

                // เคยเห็นปัญหาค้างอยู่ก่อนงานหาย = โดนลบทิ้งทั้งที่ยังไม่ได้พิมพ์
                let (state, detail, verified) = if ever_seen && had_trouble {
                    (
                        "error",
                        format!(
                            "งานหายจากคิวขณะยังติดปัญหาอยู่ ({}) — น่าจะไม่ได้พิมพ์",
                            if blocked_msg.is_empty() {
                                "ไม่ทราบสาเหตุ".to_string()
                            } else {
                                blocked_msg
                            }
                        ),
                        false,
                    )
                } else if ever_seen && last_pages.1 > 0 && last_pages.0 >= last_pages.1 {
                    ("printed", "พิมพ์ครบทุกหน้าแล้ว".to_string(), true)
                } else {
                    // spooler ลบงานที่เสร็จแล้วเร็วมากจนเราไม่ทันเห็นบิต PRINTED
                    // เป็นพฤติกรรมปกติของ Windows — รายงานว่าเสร็จ แต่ verified=false
                    (
                        "printed",
                        "งานออกจากคิวแล้ว (spooler ลบงานเร็วเกินกว่าจะยืนยันบิต PRINTED)"
                            .to_string(),
                        false,
                    )
                };

                emit_update(
                    &app,
                    PrintJobUpdate {
                        job_id,
                        printer: printer.clone(),
                        state: state.into(),
                        detail,
                        job_flags,
                        job_status_raw: last_status,
                        pages_printed: last_pages.0,
                        total_pages: last_pages.1,
                        printer_status,
                        elapsed_ms,
                        verified,
                        is_final: true,
                    },
                );
                return;
            }

            Err(e) => {
                log::warn!("[PrintJob] อ่านสถานะงาน {} ไม่ได้: {}", job_id, e);
            }
        }

        if started.elapsed().as_millis() as u64 >= JOB_TIMEOUT_MS {
            let (job_flags, blocked_msg) = decode_job_flags(last_status);
            let printer_status = query_printer_status(&printer).unwrap_or_default();
            let reason = if blocked_msg.is_empty() {
                printer_status.message.clone()
            } else {
                blocked_msg
            };

            emit_update(
                &app,
                PrintJobUpdate {
                    job_id,
                    printer: printer.clone(),
                    state: "timeout".into(),
                    detail: format!(
                        "งานค้างในคิวเกิน {} วินาทีโดยไม่พิมพ์ออกมา ({})",
                        JOB_TIMEOUT_MS / 1000,
                        reason
                    ),
                    job_flags,
                    job_status_raw: last_status,
                    pages_printed: last_pages.0,
                    total_pages: last_pages.1,
                    printer_status,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    verified: false,
                    is_final: true,
                },
            );
            return;
        }

        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// อ่านสถานะเครื่องพิมพ์แบบละเอียดตามชื่อ — ใช้ในหน้า admin/diagnostic ได้
#[tauri::command]
pub async fn get_printer_status_detail(
    printer_name: String,
) -> Result<PrinterStatusDetail, String> {
    query_printer_status(&printer_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_printer_is_ready() {
        let d = decode_printer_status(0, 0);
        assert!(!d.is_error && !d.is_offline && !d.is_busy);
        assert_eq!(d.message, "พร้อมใช้งาน");
    }

    #[test]
    fn printing_is_busy_not_error() {
        // 0x400 = PRINTING — โค้ดเดิมอ่านค่านี้ไม่ออกแล้วตัดเป็น offline
        let d = decode_printer_status(0x0000_0400, 1);
        assert!(d.is_busy);
        assert!(!d.is_error);
        assert!(!d.is_offline);
    }

    #[test]
    fn combined_bits_decode_all_flags() {
        // กระดาษหมด + กระดาษติด พร้อมกัน = 0x18 ไม่ใช่ "สถานะหมายเลข 24"
        let d = decode_printer_status(0x0000_0010 | 0x0000_0008, 0);
        assert!(d.is_error);
        assert!(d.flags.contains(&"PAPER_OUT".to_string()));
        assert!(d.flags.contains(&"PAPER_JAM".to_string()));
    }

    #[test]
    fn paper_out_while_printing_is_still_an_error() {
        // 1040 = PRINTING(1024) + PAPER_OUT(16) — เคสที่โค้ดเดิมตกเป็น Unknown(1040)
        let d = decode_printer_status(1040, 1);
        assert!(d.is_error);
        assert!(d.is_busy);
        assert!(d.message.contains("กระดาษหมด"));
    }

    #[test]
    fn offline_bit_is_not_online() {
        // 128 = 0x80 = OFFLINE — โค้ดเดิมนับค่านี้เป็น "Processing" แล้วถือว่าออนไลน์
        let d = decode_printer_status(128, 0);
        assert!(d.is_offline);
        assert!(!d.is_busy);
    }

    #[test]
    fn unknown_bits_are_reported_not_swallowed() {
        let d = decode_printer_status(0x8000_0000, 0);
        assert!(d.flags.iter().any(|f| f.starts_with("UNKNOWN(")));
    }
}
