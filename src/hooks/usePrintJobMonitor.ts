import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "../utils/appLogger";
import { logError } from "../utils/logger";

const CTX = "[usePrintJobMonitor]";

/** สถานะเครื่องพิมพ์ที่ decode มาจาก Win32 bitmask (ดู src-tauri/src/print_status.rs) */
export interface PrinterStatusDetail {
  raw: number;
  flags: string[];
  message: string;
  is_error: boolean;
  is_offline: boolean;
  is_busy: boolean;
  jobs_in_queue: number;
}

export type PrintJobState =
  | "spooling"
  | "printing"
  | "queued"
  | "blocked"
  | "printed"
  /** ครั้งนี้ไม่ออก — อาจมีการส่งซ้ำตามมา ยังไม่ใช่คำตอบสุดท้าย */
  | "error"
  | "timeout"
  /** ยกเลิกงานเดิมแล้ว กำลังรอเครื่องพร้อมเพื่อส่งใหม่ */
  | "retrying"
  /** คำตอบสุดท้าย: ไม่ได้รูปแน่นอน และจะไม่ส่งซ้ำอีกแล้ว */
  | "give_up";

/** payload ของ event `print-job-update` ที่ Rust ยิงขึ้นมา */
export interface PrintJobUpdate {
  job_id: number;
  printer: string;
  /** ครั้งที่เท่าไหร่ของคำสั่งพิมพ์ใบนี้ (1 = ครั้งแรก) */
  attempt: number;
  state: PrintJobState;
  detail: string;
  job_flags: string[];
  job_status_raw: number;
  pages_printed: number;
  total_pages: number;
  printer_status: PrinterStatusDetail;
  elapsed_ms: number;
  /** true = ยืนยันได้ว่าพิมพ์เสร็จจริง (เห็นบิต PRINTED/COMPLETE) */
  verified: boolean;
  is_final: boolean;
}

interface Options {
  enabled?: boolean;
  /** ยอมแพ้แล้ว: ไม่ได้รูปแน่นอนและจะไม่ส่งซ้ำอีก */
  onPrintFailed?: (update: PrintJobUpdate) => void;
  /** งานค้างอยู่เพราะเครื่องติดปัญหา (ฝาเปิด/ริบบิ้นหมด) แต่ยังแก้ทันได้ */
  onPrintBlocked?: (update: PrintJobUpdate) => void;
  /** กำลังจะส่งพิมพ์ซ้ำ — งานเดิมถูกยกเลิกไปแล้ว */
  onPrintRetrying?: (update: PrintJobUpdate) => void;
}

/**
 * ฟัง event `print-job-update` จาก Rust แล้วบันทึก/แจ้งเตือนว่างานพิมพ์แต่ละใบ
 * ออกจากเครื่องจริงหรือไม่
 *
 * ก่อนหน้านี้ `print_photo` คืน true ทันทีที่ส่งเข้า spooler สำเร็จ ซึ่งแปลว่า
 * "ส่งไปแล้ว" ไม่ใช่ "พิมพ์ออกมาแล้ว" — ตู้จึงไม่มีทางรู้เลยว่าลูกค้าไม่ได้รูป
 * hook นี้คือฝั่งรับของ L2 ที่ทำให้รู้ พร้อมสาเหตุจากสถานะเครื่อง (L1)
 */
export function usePrintJobMonitor({
  enabled = true,
  onPrintFailed,
  onPrintBlocked,
  onPrintRetrying,
}: Options = {}) {
  // เก็บ callback ไว้ใน ref เพื่อไม่ต้อง re-subscribe ทุกครั้งที่ parent re-render
  const onPrintFailedRef = useRef(onPrintFailed);
  const onPrintBlockedRef = useRef(onPrintBlocked);
  const onPrintRetryingRef = useRef(onPrintRetrying);
  onPrintFailedRef.current = onPrintFailed;
  onPrintBlockedRef.current = onPrintBlocked;
  onPrintRetryingRef.current = onPrintRetrying;

  // กัน alert ซ้ำ: งานหนึ่งใบรายงานปัญหาได้ครั้งเดียว
  const alertedJobsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    const handle = async (update: PrintJobUpdate) => {
      const { job_id, printer, state, detail, printer_status } = update;
      const where = `job=${job_id} attempt=${update.attempt} printer="${printer}"`;

      // error/timeout = ครั้งนี้ไม่ออก แต่ยังอาจมีการส่งซ้ำตามมา
      // จึง log ไว้เฉย ๆ ยังไม่ปลุกใคร — คำตอบสุดท้ายคือ give_up
      if (state === "error" || state === "timeout") {
        appLogger.error(
          CTX,
          `${CTX} งานพิมพ์ครั้งนี้ไม่ออก: ${where} state=${state} — ${detail}`,
          update
        );
        return;
      }

      if (state === "retrying") {
        appLogger.warn(CTX, `${CTX} กำลังส่งพิมพ์ซ้ำ: ${where} — ${detail}`, update);
        onPrintRetryingRef.current?.(update);
        return;
      }

      if (state === "give_up") {
        appLogger.error(
          CTX,
          `${CTX} งานพิมพ์ล้มเหลวถาวร: ${where} — ${detail}`,
          update
        );

        if (!alertedJobsRef.current.has(job_id)) {
          alertedJobsRef.current.add(job_id);

          logError(
            "print_job_failed",
            `Print job ${job_id} gave up after ${update.attempt} attempt(s) on "${printer}": ${detail} ` +
              `[printer: ${printer_status.message}; flags: ${printer_status.flags.join(",") || "none"}; ` +
              `queue: ${printer_status.jobs_in_queue}]`,
            undefined,
            "critical"
          );

          // แจ้งหลังบ้านด้วยช่องทางเดียวกับ device alert ตัวอื่น
          // เพื่อให้ dashboard เห็นว่าตู้นี้ปริ้นไม่ออก ไม่ใช่แค่ "printer หลุด"
          invoke("send_device_alert", {
            deviceType: "printer",
            deviceName: printer,
            availableDevices: [],
            deviceStatus: `give_up (attempt ${update.attempt}): ${detail}`,
          }).catch(() => {
            /* fire-and-forget — Rust log ไว้ให้แล้ว */
          });
        }

        onPrintFailedRef.current?.(update);
        return;
      }

      if (state === "blocked") {
        appLogger.warn(
          CTX,
          `${CTX} งานพิมพ์ค้าง: ${where} — ${detail}`,
          update
        );
        onPrintBlockedRef.current?.(update);
        return;
      }

      if (state === "printed") {
        if (update.verified) {
          appLogger.info(
            CTX,
            `${CTX} พิมพ์เสร็จ: ${where} (${update.elapsed_ms} ms)`
          );
        } else {
          // ไม่ใช่ error — spooler ลบงานที่เสร็จแล้วเร็วกว่าที่เรา poll ทัน
          appLogger.warn(
            CTX,
            `${CTX} พิมพ์เสร็จแต่ยืนยันไม่ได้: ${where} — ${detail}`
          );
        }
        alertedJobsRef.current.delete(job_id);
        return;
      }

      appLogger.info(
        CTX,
        `${CTX} ${where} state=${state} (${update.pages_printed}/${update.total_pages})`
      );
    };

    listen<PrintJobUpdate>("print-job-update", (event) => {
      void handle(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
          appLogger.info(CTX, `${CTX} เริ่มติดตามสถานะงานพิมพ์แล้ว`);
        }
      })
      .catch((err) => {
        appLogger.error(CTX, `${CTX} listen print-job-update ล้มเหลว:`, err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);
}
