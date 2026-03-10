import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UseAutoUpdateOptions {
  /** Check interval in milliseconds (default: 5 minutes) */
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

/**
 * Auto-update hook. Periodically checks for updates from GitHub releases.
 * Downloads the update silently in the background, but only relaunches
 * when the app is on the home page — to avoid interrupting an active session.
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}) {
  const {
    intervalMs = 5 * 60 * 1000, // 5 minutes
    enabled = true,
    isOnHomePage = true,
    onUpdateFound,
    onUpdateReady,
    onError,
  } = options;

  const checkingRef = useRef(false);
  // Flag set to true once an update has been downloaded and is ready to apply
  const updateReadyRef = useRef(false);
  const isOnHomePageRef = useRef(isOnHomePage);

  // Keep ref in sync so the effect below can read the latest value without re-running
  useEffect(() => {
    isOnHomePageRef.current = isOnHomePage;

    // If an update was already downloaded and we just arrived at home → relaunch now
    if (isOnHomePage && updateReadyRef.current) {
      console.log("[Updater] Now on home page — applying pending update, relaunching...");
      relaunch();
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
        console.log("[Updater] Checking for updates...");
        const update = await check();

        if (update) {
          console.log(`[Updater] Update found: v${update.version} — downloading in background...`);
          if (onUpdateFound) onUpdateFound(update.version);

          // Download and install silently (no relaunch yet)
          await update.downloadAndInstall();
          console.log("[Updater] Update downloaded and installed.");
          updateReadyRef.current = true;
          if (onUpdateReady) onUpdateReady();

          // Relaunch immediately only if already on home page
          if (isOnHomePageRef.current) {
            console.log("[Updater] On home page — relaunching now.");
            await relaunch();
          } else {
            console.log("[Updater] Not on home page — relaunch deferred until home.");
          }
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
