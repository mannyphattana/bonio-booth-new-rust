import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UseAutoUpdateOptions {
  /** Check interval in milliseconds (default: 5 minutes) */
  intervalMs?: number;
  /** Whether auto-update is enabled */
  enabled?: boolean;
  /** Callback when update is found */
  onUpdateFound?: (version: string) => void;
  /** Callback when update is downloaded and ready */
  onUpdateReady?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
}

/**
 * Auto-update hook. Periodically checks for updates from GitHub releases.
 * When an update is found, downloads and installs it, then relaunches the app.
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}) {
  const {
    intervalMs = 5 * 60 * 1000, // 5 minutes
    enabled = true,
    onUpdateFound,
    onUpdateReady,
    onError,
  } = options;

  const checkingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const checkForUpdate = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;

      try {
        console.log("[Updater] Checking for updates...");
        const update = await check();

        if (update) {
          console.log(`[Updater] Update found: v${update.version}`);
          if (onUpdateFound) onUpdateFound(update.version);

          // Download and install
          await update.downloadAndInstall();
          console.log("[Updater] Update installed, relaunching...");
          if (onUpdateReady) onUpdateReady();

          await relaunch();
        } else {
          console.log("[Updater] No update available");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Updater] Error:", msg);
        if (onError) onError(msg);
      } finally {
        checkingRef.current = false;
      }
    };

    // Check immediately on mount
    checkForUpdate();

    // Then check periodically
    const timer = setInterval(checkForUpdate, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, onUpdateFound, onUpdateReady, onError]);
}
