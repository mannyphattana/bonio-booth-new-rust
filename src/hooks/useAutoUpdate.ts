import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { appLogger } from "../utils/appLogger";
import { sendSessionLog } from "../utils/sessionManager";

const UPDATE_ATTEMPT_KEY = "bonio_update_attempt";
// ถ้า relaunch แล้วเวอร์ชั่นยังเหมือนเดิมภายใน 10 นาที = update ล้มเหลว
const UPDATE_ATTEMPT_TTL_MS = 10 * 60 * 1000;
// หน่วงก่อน relaunch เพื่อให้ NSIS installer มีเวลาทำงานเสร็จ
const RELAUNCH_DELAY_MS = 4000;

interface UpdateAttempt {
  fromVersion: string;
  toVersion: string;
  timestamp: number;
}

interface UseAutoUpdateOptions {
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

/**
 * ตรวจสอบว่า relaunch ครั้งก่อนล้มเหลวหรือไม่ (เวอร์ชั่นยังเหมือนเดิม)
 * ถ้าล้มเหลว → return true เพื่อ skip การเช็คอัพเดท (ป้องกัน infinite loop)
 */
async function isStuckInUpdateLoop(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(UPDATE_ATTEMPT_KEY);
    if (!raw) return false;

    const attempt: UpdateAttempt = JSON.parse(raw);
    const ageMs = Date.now() - attempt.timestamp;

    // หมดอายุแล้ว → clear แล้วไม่ถือว่า loop
    if (ageMs > UPDATE_ATTEMPT_TTL_MS) {
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      return false;
    }

    const currentVersion = await getVersion();

    if (currentVersion === attempt.fromVersion) {
      // relaunch แล้วแต่เวอร์ชั่นยังเหมือนเดิม = update ล้มเหลว
      appLogger.warn(
        "[Updater]",
        `Update to v${attempt.toVersion} failed — still on v${currentVersion} after relaunch. Skipping update check to prevent loop.`
      );
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      return true;
    }

    // อัพเดทสำเร็จ → clear flag
    appLogger.info("[Updater]", `Successfully updated from v${attempt.fromVersion} to v${currentVersion}.`);
    localStorage.removeItem(UPDATE_ATTEMPT_KEY);
    return false;
  } catch {
    localStorage.removeItem(UPDATE_ATTEMPT_KEY);
    return false;
  }
}

/**
 * Auto-update hook. Checks for updates once when the app starts.
 * Downloads silently in the background and relaunches immediately only on the home page.
 * Protected against infinite update loops caused by failed NSIS installs.
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}) {
  const {
    enabled = true,
    isOnHomePage = true,
    onUpdateFound,
    onUpdateReady,
    onError,
  } = options;

  const hasCheckedOnLaunchRef = useRef(false);
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
    if (!enabled || hasCheckedOnLaunchRef.current) return;

    hasCheckedOnLaunchRef.current = true;

    const checkForUpdate = async () => {
      if (checkingRef.current) return;
      if (updateReadyRef.current) return;
      checkingRef.current = true;

      try {
        // ตรวจสอบ infinite loop guard ก่อน
        const stuck = await isStuckInUpdateLoop();
        if (stuck) return;

        appLogger.info("[Updater]", "Checking for updates...");
        const update = await check();

        if (update) {
          appLogger.info("[Updater]", `Update found: v${update.version} — downloading in background...`);
          if (onUpdateFound) onUpdateFound(update.version);

          // บันทึก attempt ก่อน install เพื่อตรวจจับ loop หากล้มเหลว
          const currentVersion = await getVersion();
          localStorage.setItem(
            UPDATE_ATTEMPT_KEY,
            JSON.stringify({
              fromVersion: currentVersion,
              toVersion: update.version,
              timestamp: Date.now(),
            } satisfies UpdateAttempt)
          );

          // Download and install silently (no relaunch yet)
          await update.downloadAndInstall();
          appLogger.info("[Updater]", "Update downloaded and installed.");
          updateReadyRef.current = true;
          if (onUpdateReady) onUpdateReady();

          // Relaunch immediately only if already on home page
          if (isOnHomePageRef.current) {
            appLogger.info("[Updater]", `On home page — waiting ${RELAUNCH_DELAY_MS}ms for installer to finish, then relaunching.`);
            await sendSessionLog("auto_update");
            // หน่วงให้ NSIS installer มีเวลาเขียน binary ใหม่ก่อน relaunch
            await new Promise((resolve) => setTimeout(resolve, RELAUNCH_DELAY_MS));
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
        // ถ้า error เกิดขึ้นระหว่าง install → clear attempt flag เพื่อไม่ให้ block ครั้งหน้า
        localStorage.removeItem(UPDATE_ATTEMPT_KEY);
        if (onError) onError(msg);
      } finally {
        checkingRef.current = false;
      }
    };

    void checkForUpdate();
  }, [enabled, onUpdateFound, onUpdateReady, onError]);
}

