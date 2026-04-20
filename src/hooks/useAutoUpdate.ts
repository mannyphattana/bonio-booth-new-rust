import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { appLogger } from "../utils/appLogger";
import { sendSessionLog } from "../utils/sessionManager";

const LAST_CHECK_KEY = "bonio_updater_last_check_date";

interface UseAutoUpdateOptions {
  /**
   * ชั่วโมง (0-23) สำหรับเช็คอัพเดทวันละครั้ง เช่น 4 = ตี 4
   * - ถ้าแอปเปิดหลังเวลานั้น (เช่น 8 โมง) และยังไม่ได้เช็ควันนี้ → เช็คทันที
   * - ถ้าแอปเปิดก่อนเวลา (เช่น 3 ทุ่ม) → รอจนถึงตี 4
   * เมื่อตั้ง scheduleHour แล้ว intervalMs จะถูกละเว้น
   */
  scheduleHour?: number;
  /** Check interval in milliseconds (ใช้เมื่อไม่ได้ตั้ง scheduleHour, default: 5 minutes) */
  intervalMs?: number;
  /** Whether auto-update is enabled */
  enabled?: boolean;
  /**
   * Whether the app is currently on the home page.
   * Update will only be applied (relaunch) when this is true.
   * The download happens silently in the background regardless.
   */
  isOnHomePage?: boolean;
  /** Callback when update is found */
  onUpdateFound?: (version: string) => void;
  /** Callback when update is downloaded and ready to apply */
  onUpdateReady?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/** คืนค่า Date ของครั้งถัดไปที่ถึงเวลา scheduleHour (วันนี้ถ้ายังไม่ผ่าน, ไม่งั้นพรุ่งนี้) */
function getNextScheduledDate(hour: number): Date {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= new Date()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/** ควรเช็คทันทีไหม: เวลาปัจจุบัน >= scheduleHour และยังไม่ได้เช็ควันนี้ */
function shouldCheckImmediately(hour: number): boolean {
  if (new Date().getHours() < hour) return false;
  return localStorage.getItem(LAST_CHECK_KEY) !== new Date().toDateString();
}

function markCheckedToday(): void {
  localStorage.setItem(LAST_CHECK_KEY, new Date().toDateString());
}

/**
 * Auto-update hook. Periodically checks for updates from GitHub releases.
 *
 * scheduleHour mode (แนะนำ):
 *   - เช็คครั้งเดียวต่อวัน ณ เวลาที่กำหนด (เช่น scheduleHour=4 = ตี 4)
 *   - ถ้าแอปเปิดหลังเวลานั้น เช่น 8 โมง → เช็คทันที
 *
 * interval mode (default):
 *   - เช็คทุก intervalMs milliseconds
 *
 * ทั้งสองโหมด: download ไฟล์เงียบๆ background, relaunch เมื่ออยู่ที่ home page เท่านั้น
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}) {
  const {
    scheduleHour,
    intervalMs = 5 * 60 * 1000, // 5 minutes
    enabled = true,
    isOnHomePage = true,
    onUpdateFound,
    onUpdateReady,
    onError,
  } = options;

  const checkingRef = useRef(false);
  const updateReadyRef = useRef(false);
  const isOnHomePageRef = useRef(isOnHomePage);

  // Keep ref in sync so the effect below can read the latest value without re-running
  useEffect(() => {
    isOnHomePageRef.current = isOnHomePage;

    // If an update was already downloaded and we just arrived at home → relaunch now
    if (isOnHomePage && updateReadyRef.current) {
      appLogger.info("[Updater]", "Now on home page — applying pending update, relaunching...");
      sendSessionLog("auto_update").finally(() => relaunch());
    }
  }, [isOnHomePage]);

  useEffect(() => {
    if (!enabled) return;

    const checkForUpdate = async () => {
      if (checkingRef.current) return;
      // Already downloaded, no need to check again
      if (updateReadyRef.current) return;
      checkingRef.current = true;

      try {
        appLogger.info("[Updater]", "Checking for updates...");
        // บันทึกว่าได้เช็ควันนี้แล้ว (เฉพาะ schedule mode)
        if (scheduleHour !== undefined) markCheckedToday();

        const update = await check();

        if (update) {
          appLogger.info("[Updater]", `Update found: v${update.version} — downloading in background...`);
          if (onUpdateFound) onUpdateFound(update.version);

          // Download and install silently (no relaunch yet)
          await update.downloadAndInstall();
          appLogger.info("[Updater]", "Update downloaded and installed.");
          updateReadyRef.current = true;
          if (onUpdateReady) onUpdateReady();

          // Relaunch immediately only if already on home page
          if (isOnHomePageRef.current) {
            appLogger.info("[Updater]", "On home page — sending session log then relaunching.");
            await sendSessionLog("auto_update");
            await relaunch();
          } else {
            appLogger.info("[Updater]", "Not on home page — relaunch deferred until home.");
          }
        } else {
          appLogger.debug("[Updater]", "No update available.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appLogger.error("[Updater]", `Error: ${msg}`);
        if (onError) onError(msg);
      } finally {
        checkingRef.current = false;
      }
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    if (scheduleHour !== undefined) {
      // === Schedule mode: วันละครั้งตาม scheduleHour ===
      if (shouldCheckImmediately(scheduleHour)) {
        // เปิดแอปหลังเวลาที่กำหนดและยังไม่ได้เช็ควันนี้ → เช็คทันที
        appLogger.info("[Updater]", `Missed today's ${scheduleHour}:00 window — checking now.`);
        checkForUpdate();
      }

      // ตั้ง timeout จนถึง scheduleHour ครั้งต่อไป
      const msUntilNext = getNextScheduledDate(scheduleHour).getTime() - Date.now();
      appLogger.info("[Updater]", `Next scheduled check in ${Math.round(msUntilNext / 60000)} minutes (at ${scheduleHour}:00).`);

      timeoutId = setTimeout(() => {
        checkForUpdate();
        // หลังจากนั้น repeat ทุก 24 ชม.
        intervalId = setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
      }, msUntilNext);
    } else {
      // === Interval mode: เช็คทันทีและ repeat ===
      checkForUpdate();
      intervalId = setInterval(checkForUpdate, intervalMs);
    }

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, [enabled, scheduleHour, intervalMs, onUpdateFound, onUpdateReady, onError]);
}

