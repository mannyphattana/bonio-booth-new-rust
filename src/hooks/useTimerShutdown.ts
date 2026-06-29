/**
 * useTimerShutdown — Timer Auto-Shutdown Hook (นอกเวลาทำการ)
 *
 * พฤติกรรมตามสเปก:
 * - ทำงาน "เฉพาะหน้า Home" เท่านั้น — หน้าอื่นๆ ปิดการ shutdown ทั้งหมด
 *   (ถ้ามี timer countdown ค้างอยู่จากที่ไหนก็ตาม จะถูก cancel ทันทีเมื่อไม่ได้อยู่หน้า Home)
 * - บนหน้า Home + นอกเวลาทำการ: จะเริ่ม countdown ก็ต่อเมื่อ "ไม่มีการ interact ใดๆ ครบ 5 นาที"
 *   แตะหน้าจอ/กดปุ่ม/เลื่อน = รีเซ็ตนาฬิกา idle ใหม่ทันที
 * - เมื่อ countdown เริ่ม (overlay เด้ง) แตะหน้าจอจะ cancel แล้วกลับไปรอ idle 5 นาทีอีกครั้ง
 * - ถ้ากำลังพิมพ์รูป/มี transaction ค้าง countdown จะถูกหน่วงไว้ใน Rust จนพิมพ์เสร็จ
 *
 * แหล่งข้อมูลนอกเวลาทำการมาจาก init_machine (isShutdownReady / isClosedAppReady) poll ทุก 30 วิ
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "../utils/appLogger";

const CTX = "[useTimerShutdown]";
const POLL_INTERVAL_MS = 30_000; // ดึงสถานะนอกเวลาทำการจาก backend ทุก 30 วิ
const IDLE_CHECK_INTERVAL_MS = 5_000; // ประเมินเงื่อนไข idle/home ทุก 5 วิ
const IDLE_BEFORE_COUNTDOWN_MS = 5 * 60 * 1000; // ต้องไม่มี interact ครบ 5 นาทีบนหน้า Home ก่อนเริ่ม countdown
const COUNTDOWN_MINUTES = 2; // ระยะ countdown (overlay) ก่อนปิดเครื่องจริง
const ACTIVITY_EVENTS = [
  "pointerdown",
  "mousedown",
  "touchstart",
  "keydown",
] as const;

interface UseTimerShutdownOptions {
  /** Only enable when app is verified and has machine data */
  enabled: boolean;
  /** ทำงานเฉพาะหน้า Home เท่านั้น */
  isOnHomePage?: boolean;
  /** Callback when machine data is refreshed from poll */
  onMachineDataRefreshed?: (data: any) => void;
  /** Callback when backend unreachable (init_machine failed / network error) */
  onConnectionLost?: () => void;
}

export function useTimerShutdown({
  enabled,
  isOnHomePage = true,
  onMachineDataRefreshed,
  onConnectionLost,
}: UseTimerShutdownOptions) {
  const isAnyReadyRef = useRef(false); // นอกเวลาทำการอยู่ไหม (shutdown หรือ close-app)
  const shutdownTypeRef = useRef<"shutdown" | "close-app" | null>(null);
  const lastActivityRef = useRef(Date.now());
  const countdownArmedRef = useRef(false); // เราสั่ง Rust เริ่ม timer countdown ไปแล้วหรือยัง
  const isOnHomeRef = useRef(isOnHomePage);

  // เก็บ callbacks ไว้ใน ref เพื่อไม่ให้ interval ถูกสร้างใหม่ทุกครั้งที่ parent re-render
  const onMachineDataRefreshedRef = useRef(onMachineDataRefreshed);
  const onConnectionLostRef = useRef(onConnectionLost);
  useEffect(() => {
    onMachineDataRefreshedRef.current = onMachineDataRefreshed;
  }, [onMachineDataRefreshed]);
  useEffect(() => {
    onConnectionLostRef.current = onConnectionLost;
  }, [onConnectionLost]);

  // sync isOnHomePage เข้า ref ให้ closure ใน interval/listener อ่านค่าล่าสุดได้
  useEffect(() => {
    isOnHomeRef.current = isOnHomePage;
  }, [isOnHomePage]);

  // ออกจากหน้า Home → ยกเลิก timer shutdown ทันที (ไม่ต้องรอ idle tick)
  // และรีเซ็ตนาฬิกา idle เพราะการ navigate คือการ interact ของผู้ใช้
  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (enabled && !isOnHomePage && countdownArmedRef.current) {
      appLogger.info(CTX, "Left home page — cancelling timer shutdown");
      invoke("cancel_timer_shutdown").catch(() => {});
      countdownArmedRef.current = false;
    }
  }, [enabled, isOnHomePage]);

  useEffect(() => {
    if (!enabled) {
      if (countdownArmedRef.current) {
        invoke("cancel_timer_shutdown").catch(() => {});
        countdownArmedRef.current = false;
      }
      return;
    }

    // ยกเลิก timer countdown (เฉพาะ reason=timer — ไม่แตะ manual/dashboard shutdown)
    const cancelTimer = () => {
      invoke("cancel_timer_shutdown").catch(() => {});
      countdownArmedRef.current = false;
    };

    // มีการ interact ใดๆ → รีเซ็ตนาฬิกา idle, ถ้า countdown กำลังเดินอยู่ให้ยกเลิก (หยุด flow ทันที)
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      if (countdownArmedRef.current) {
        appLogger.info(CTX, "User activity — cancelling timer countdown");
        cancelTimer();
      }
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );

    // poll สถานะนอกเวลาทำการจาก backend
    const checkStatus = async () => {
      try {
        const result: any = await invoke("init_machine");
        if (!result?.success || !result?.data) {
          appLogger.warn(CTX, "init_machine failed or no data");
          onConnectionLostRef.current?.();
          return;
        }

        if (result.data.machine) {
          onMachineDataRefreshedRef.current?.(result.data);
        }

        const isShutdownReady = result.data.isShutdownReady || false;
        const isClosedAppReady = result.data.isClosedAppReady || false;
        isAnyReadyRef.current = isShutdownReady || isClosedAppReady;
        shutdownTypeRef.current = isClosedAppReady
          ? "close-app"
          : isShutdownReady
            ? "shutdown"
            : null;

        // กลับเข้าเวลาทำการ → ยกเลิก countdown ที่ค้างอยู่
        if (!isAnyReadyRef.current && countdownArmedRef.current) {
          appLogger.info(CTX, "Back in operating hours — cancelling countdown");
          cancelTimer();
        }
      } catch (err) {
        appLogger.error(CTX, "Status check failed:", err);
        onConnectionLostRef.current?.();
      }
    };

    // ประเมินเงื่อนไขเริ่ม/ยกเลิก countdown ทุก 5 วิ
    const idleCheck = () => {
      // หน้าอื่น (ไม่ใช่ Home) → ปิดการ shutdown ทั้งหมด
      if (!isOnHomeRef.current) {
        if (countdownArmedRef.current || isAnyReadyRef.current) cancelTimer();
        return;
      }

      // อยู่ในเวลาทำการ → ไม่ต้องทำอะไร (เผื่อมี countdown ค้างก็ยกเลิก)
      if (!isAnyReadyRef.current) {
        if (countdownArmedRef.current) cancelTimer();
        return;
      }

      // หน้า Home + นอกเวลาทำการ → เริ่ม countdown เมื่อ idle ครบ 5 นาที
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_BEFORE_COUNTDOWN_MS) {
        if (!countdownArmedRef.current) {
          appLogger.info(
            CTX,
            `Idle ${Math.round(idleMs / 1000)}s on home (off-hours) — starting countdown (type: ${shutdownTypeRef.current})`,
          );
        }
        countdownArmedRef.current = true;
        // idempotent ใน Rust — จะไม่ restart ถ้า countdown เดินอยู่แล้ว
        invoke("ensure_shutdown_countdown", {
          minutes: COUNTDOWN_MINUTES,
          reason: "timer",
          shutdownType: shutdownTypeRef.current,
        }).catch(() => {});
      }
      // ยังไม่ครบ 5 นาที → ไม่เริ่ม countdown
    };

    // เช็คทันทีรอบแรก
    checkStatus();
    const pollId = setInterval(checkStatus, POLL_INTERVAL_MS);
    const idleId = setInterval(idleCheck, IDLE_CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(pollId);
      clearInterval(idleId);
    };
  }, [enabled]);
}
