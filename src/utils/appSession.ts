import { invoke } from "@tauri-apps/api/core";

export type SessionCloseReason =
  | "user_exit"
  | "crash"
  | "timer"
  | "auto_update"
  | "unknown";

export interface SessionEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context?: string;
}

const SESSION_STORAGE_KEY = "bonio_app_session";
const MAX_ENTRIES = 500;

interface StoredSession {
  sessionId: string;
  machineId: string;
  startedAt: string;
}

// In-memory state for the active session
let activeSessionId: string | null = null;
let sessionStartedAt: Date | null = null;
const sessionEntries: SessionEntry[] = [];

/**
 * Check localStorage for an unfinished session from a previous run.
 * If found and belongs to this machine, PATCH it as a crash before starting fresh.
 */
export async function checkAndReportCrash(machineId: string): Promise<void> {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return;

  try {
    const stored: StoredSession = JSON.parse(raw);
    if (stored.sessionId && stored.machineId === machineId) {
      await invoke("update_app_session_log", {
        sessionId: stored.sessionId,
        endedAt: new Date().toISOString(),
        closeReason: "crash",
        durationSeconds: null,
        entries: [],
        summary: "Session ended without proper close — detected as crash on next startup",
      }).catch(() => {});
    }
  } catch {
    // malformed localStorage entry — ignore
  }

  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/**
 * Start a new app session. Call this after machine is verified.
 * Stores session info in localStorage so crash can be detected on next startup.
 */
export function initSession(
  machineId: string,
  workspaceId?: string,
  appVersion?: string,
): void {
  const sessionId = crypto.randomUUID();
  activeSessionId = sessionId;
  sessionStartedAt = new Date();
  sessionEntries.length = 0;

  // Persist for crash detection
  const stored: StoredSession = {
    sessionId,
    machineId,
    startedAt: sessionStartedAt.toISOString(),
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));

  // POST to backend (fire-and-forget)
  invoke("create_app_session_log", {
    sessionId,
    machineId,
    workspaceId: workspaceId ?? null,
    startedAt: sessionStartedAt.toISOString(),
    appVersion: appVersion ?? null,
  }).catch(() => {});
}

/**
 * Add a log entry to the in-memory buffer for this session.
 */
export function addSessionEntry(
  level: SessionEntry["level"],
  message: string,
  context?: string,
): void {
  if (!activeSessionId) return;
  sessionEntries.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  });
  // Cap to avoid unbounded memory growth
  if (sessionEntries.length > MAX_ENTRIES) {
    sessionEntries.splice(0, sessionEntries.length - MAX_ENTRIES);
  }
}

/**
 * Close the active session. Awaitable — call before exit_app.
 */
export async function closeSession(reason: SessionCloseReason): Promise<void> {
  if (!activeSessionId || !sessionStartedAt) return;

  const endedAt = new Date();
  const durationSeconds = Math.floor(
    (endedAt.getTime() - sessionStartedAt.getTime()) / 1000,
  );
  const sid = activeSessionId;

  // Clear state before await so a double-call is a no-op
  activeSessionId = null;
  sessionStartedAt = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);

  try {
    await invoke("update_app_session_log", {
      sessionId: sid,
      endedAt: endedAt.toISOString(),
      closeReason: reason,
      durationSeconds,
      entries: [...sessionEntries],
      summary: null,
    });
  } catch {
    // Fire-and-forget — never block app exit
  }
}
