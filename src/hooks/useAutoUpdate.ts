import { useCallback, useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { appLogger } from "../utils/appLogger";
import { sendSessionLog } from "../utils/sessionManager";

const UPDATE_ATTEMPT_KEY = "bonio_update_attempt";
// ถ้า relaunch แล้วเวอร์ชั่นยังเหมือนเดิมภายใน 10 นาที = update ล้มเหลว
const UPDATE_ATTEMPT_TTL_MS = 10 * 60 * 1000;

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
   * The update is only installed while this is true, because installing closes the app.
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
 *
 * Download and install are two separate steps on purpose. On Windows, install() starts the
 * NSIS installer and exits the app on the spot (tauri-plugin-updater calls
 * std::process::exit), so whatever screen is open is gone. The old downloadAndInstall()
 * therefore closed the app the moment the download finished — mid-shoot if a customer had
 * already paid. Now the download runs in the background and install() is only called on
 * the home page: straight away if the download finishes there, otherwise as soon as the
 * customer's session brings the app back home. The installer relaunches the app itself.
 *
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
  /** Downloaded and waiting for the home page to be installed. */
  const pendingUpdateRef = useRef<Update | null>(null);
  const installingRef = useRef(false);
  const isOnHomePageRef = useRef(isOnHomePage);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const installPendingUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update || installingRef.current) return;
    installingRef.current = true;

    try {
      appLogger.info("[Updater]", `On home page — installing v${update.version}, the app will close and reopen.`);
      await sendSessionLog("auto_update");

      // บันทึก attempt ตอนจะติดตั้งจริง (ไม่ใช่ตอนเริ่มโหลด) — การโหลดกับการรอกลับหน้า Home
      // อาจนานเกิน TTL ได้ ถ้าบันทึกไว้ก่อน guard จะหมดอายุก่อนได้ใช้
      const currentVersion = await getVersion();
      localStorage.setItem(
        UPDATE_ATTEMPT_KEY,
        JSON.stringify({
          fromVersion: currentVersion,
          toVersion: update.version,
          timestamp: Date.now(),
        } satisfies UpdateAttempt)
      );

      // Windows: เปิดตัวติดตั้งแล้วปิดแอปทันที ไม่กลับมาที่บรรทัดถัดไป — ตัวติดตั้งเปิดแอปใหม่ให้เอง
      await update.install();
      // ถึงตรงนี้ได้เฉพาะ OS ที่ install แล้วไม่ปิดแอปให้
      await relaunch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appLogger.error("[Updater]", `Install failed: ${msg}`);
      // ถ้า error เกิดขึ้นระหว่าง install → clear attempt flag เพื่อไม่ให้ block ครั้งหน้า
      localStorage.removeItem(UPDATE_ATTEMPT_KEY);
      pendingUpdateRef.current = null;
      installingRef.current = false;
      if (onErrorRef.current) onErrorRef.current(msg);
    }
  }, []);

  // Keep ref in sync so the effect below can read the latest value without re-running
  useEffect(() => {
    isOnHomePageRef.current = isOnHomePage;

    // If an update was already downloaded and we just arrived at home → install now
    if (isOnHomePage && pendingUpdateRef.current) {
      void installPendingUpdate();
    }
  }, [isOnHomePage, installPendingUpdate]);

  useEffect(() => {
    if (!enabled || hasCheckedOnLaunchRef.current) return;

    hasCheckedOnLaunchRef.current = true;

    const checkForUpdate = async () => {
      if (checkingRef.current) return;
      if (pendingUpdateRef.current) return;
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

          // Download only. Installing closes the app, so that waits for the home page.
          await update.download();
          appLogger.info("[Updater]", `Update v${update.version} downloaded.`);
          pendingUpdateRef.current = update;
          if (onUpdateReady) onUpdateReady();

          if (isOnHomePageRef.current) {
            void installPendingUpdate();
          } else {
            appLogger.info("[Updater]", "Not on home page — install deferred until the session returns home.");
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

    void checkForUpdate();
  }, [enabled, onUpdateFound, onUpdateReady, onError, installPendingUpdate]);
}
