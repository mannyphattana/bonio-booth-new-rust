import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { appLogger } from "../utils/appLogger";
import { sendSessionLog } from "../utils/sessionManager";

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
 * Auto-update hook. Checks for updates once when the app starts.
 * Downloads silently in the background and relaunches immediately only on the home page.
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
      // Already downloaded, no need to check again
      if (updateReadyRef.current) return;
      checkingRef.current = true;

      try {
        appLogger.info("[Updater]", "Checking for updates...");
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

    void checkForUpdate();
  }, [enabled, onUpdateFound, onUpdateReady, onError]);
}

