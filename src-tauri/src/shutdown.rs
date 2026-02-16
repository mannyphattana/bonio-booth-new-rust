//! Shutdown Manager สำหรับ bonio-booth (Tauri/Rust)
//!
//! จัดการ shutdown countdown, transaction awareness, และ OS shutdown command
//! Port จาก shutdownManager.ts ของ Electron version

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Shutdown reason
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ShutdownReason {
    Manual,
    Timer,
}

/// Shutdown state (sent to frontend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownState {
    pub is_scheduled: bool,
    pub is_paused: bool,
    pub remaining_seconds: u32,
    pub total_seconds: u32,
    pub reason: Option<ShutdownReason>,
}

impl Default for ShutdownState {
    fn default() -> Self {
        Self {
            is_scheduled: false,
            is_paused: false,
            remaining_seconds: 0,
            total_seconds: 0,
            reason: None,
        }
    }
}

/// Default countdown minutes
const DEFAULT_COUNTDOWN_MINUTES: u32 = 2;

/// Delay after SSE destroy before executing OS shutdown (seconds)
const POST_DESTROY_DELAY_SECONDS: u64 = 3;

/// Shutdown Manager — manages shutdown countdown and OS shutdown
pub struct ShutdownManager {
    state: Arc<Mutex<ShutdownState>>,
    is_in_transaction: Arc<AtomicBool>,
    countdown_running: Arc<AtomicBool>,
    cancel_signal: Arc<tokio::sync::Notify>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl ShutdownManager {
    pub fn new() -> Self {
        info!("[ShutdownManager] Initialized");
        Self {
            state: Arc::new(Mutex::new(ShutdownState::default())),
            is_in_transaction: Arc::new(AtomicBool::new(false)),
            countdown_running: Arc::new(AtomicBool::new(false)),
            cancel_signal: Arc::new(tokio::sync::Notify::new()),
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Store app handle for emitting events
    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app);
    }

    /// Emit countdown update to frontend
    fn emit_state(&self) {
        let state = self.state.lock().unwrap().clone();
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            let _ = app.emit("shutdown-countdown", &state);
        }
    }

    /// Start countdown
    pub fn start_countdown(&self, minutes: Option<u32>, reason: ShutdownReason) {
        let minutes = minutes.unwrap_or(DEFAULT_COUNTDOWN_MINUTES);
        let total_seconds = minutes * 60;
        info!(
            "[ShutdownManager] Starting countdown: {} minutes ({}s), reason: {:?}",
            minutes, total_seconds, reason
        );

        // Cancel existing countdown
        self.cancel_countdown_timer();

        {
            let mut state = self.state.lock().unwrap();
            state.is_scheduled = true;
            state.remaining_seconds = total_seconds;
            state.total_seconds = total_seconds;
            state.reason = Some(reason);

            // Pause if in transaction
            if self.is_in_transaction.load(Ordering::Relaxed) {
                warn!("[ShutdownManager] In transaction, pausing countdown");
                state.is_paused = true;
                drop(state);
                self.emit_state();
                return;
            }
            state.is_paused = false;
        }

        self.start_countdown_timer();
        self.emit_state();
        info!("[ShutdownManager] Countdown started: {}s", total_seconds);
    }

    /// Cancel shutdown
    pub fn cancel_shutdown(&self) {
        info!("[ShutdownManager] Cancelling shutdown");
        self.cancel_countdown_timer();

        {
            let mut state = self.state.lock().unwrap();
            *state = ShutdownState::default();
        }

        self.emit_state();

        // Notify frontend
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            let _ = app.emit("shutdown-cancelled", ());
        }
        info!("[ShutdownManager] Shutdown cancelled");
    }

    /// Handle user activity — reset countdown if running
    pub fn on_user_activity(&self) {
        let mut state = self.state.lock().unwrap();
        if !state.is_scheduled || state.is_paused {
            return;
        }
        info!(
            "[ShutdownManager] User activity, resetting countdown: {}s -> {}s",
            state.remaining_seconds, state.total_seconds
        );
        state.remaining_seconds = state.total_seconds;
        drop(state);
        self.emit_state();
    }

    /// Start transaction (pause countdown)
    pub fn start_transaction(&self) {
        info!("[ShutdownManager] Transaction started");
        self.is_in_transaction.store(true, Ordering::Relaxed);

        let mut state = self.state.lock().unwrap();
        if state.is_scheduled {
            state.is_paused = true;
            self.cancel_countdown_timer();
            drop(state);
            self.emit_state();
        }
    }

    /// End transaction (resume countdown with reset)
    pub fn end_transaction(&self) {
        info!("[ShutdownManager] Transaction ended");
        self.is_in_transaction.store(false, Ordering::Relaxed);

        let mut state = self.state.lock().unwrap();
        if state.is_scheduled {
            state.is_paused = false;
            state.remaining_seconds = DEFAULT_COUNTDOWN_MINUTES * 60;
            state.total_seconds = DEFAULT_COUNTDOWN_MINUTES * 60;
            drop(state);
            self.start_countdown_timer();
            self.emit_state();
            info!("[ShutdownManager] Countdown resumed after transaction");
        }
    }

    /// Execute immediate shutdown (for timer-scheduled events)
    pub fn execute_immediate_shutdown(&self) {
        if self.is_in_transaction.load(Ordering::Relaxed) {
            warn!("[ShutdownManager] In transaction, deferring immediate shutdown");
            let mut state = self.state.lock().unwrap();
            state.is_scheduled = true;
            state.is_paused = true;
            state.remaining_seconds = 0;
            state.total_seconds = 0;
            state.reason = Some(ShutdownReason::Timer);
            return;
        }
        self.execute_shutdown();
    }

    /// Get current state
    pub fn get_state(&self) -> ShutdownState {
        self.state.lock().unwrap().clone()
    }

    /// Check if shutdown is scheduled
    pub fn is_shutdown_scheduled(&self) -> bool {
        self.state.lock().unwrap().is_scheduled
    }

    // ========== Internal ==========

    /// Cancel the countdown timer
    fn cancel_countdown_timer(&self) {
        if self.countdown_running.load(Ordering::Relaxed) {
            info!("[ShutdownManager] Cancelling countdown timer");
            self.countdown_running.store(false, Ordering::Relaxed);
            self.cancel_signal.notify_waiters();
        }
    }

    /// Start the countdown timer in a background task
    fn start_countdown_timer(&self) {
        // Signal any existing timer to stop
        self.cancel_countdown_timer();

        self.countdown_running.store(true, Ordering::Relaxed);

        let state = self.state.clone();
        let countdown_running = self.countdown_running.clone();
        let cancel_signal = self.cancel_signal.clone();
        let app_handle = self.app_handle.clone();
        let is_in_transaction = self.is_in_transaction.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                // Wait 1 second or cancel
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {}
                    _ = cancel_signal.notified() => {
                        info!("[ShutdownManager] Countdown timer cancelled");
                        return;
                    }
                }

                if !countdown_running.load(Ordering::Relaxed) {
                    return;
                }

                let should_shutdown;
                {
                    let mut s = state.lock().unwrap();

                    if !s.is_scheduled {
                        info!("[ShutdownManager] Not scheduled anymore, stopping timer");
                        countdown_running.store(false, Ordering::Relaxed);
                        return;
                    }

                    if s.is_paused {
                        continue;
                    }

                    if s.remaining_seconds > 0 {
                        s.remaining_seconds -= 1;
                    }

                    // Log every 10s or when < 10s
                    if s.remaining_seconds % 10 == 0 || s.remaining_seconds <= 10 {
                        info!("[ShutdownManager] Countdown: {}s remaining", s.remaining_seconds);
                    }

                    should_shutdown = s.remaining_seconds == 0;

                    // Emit state to frontend
                    if let Some(app) = app_handle.lock().unwrap().as_ref() {
                        let _ = app.emit("shutdown-countdown", &*s);
                    }
                }

                if should_shutdown {
                    info!("[ShutdownManager] Countdown finished, executing shutdown");
                    countdown_running.store(false, Ordering::Relaxed);

                    // Check if in transaction — defer if so
                    if is_in_transaction.load(Ordering::Relaxed) {
                        warn!("[ShutdownManager] In transaction at countdown end, deferring");
                        let mut s = state.lock().unwrap();
                        s.is_paused = true;
                        return;
                    }

                    // Execute OS shutdown
                    execute_os_shutdown(app_handle.clone()).await;
                    return;
                }
            }
        });
    }

    /// Execute shutdown (public wrapper)
    fn execute_shutdown(&self) {
        info!("[ShutdownManager] Executing shutdown");
        self.cancel_countdown_timer();

        // Notify frontend
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            let _ = app.emit("shutdown-starting", ());
        }

        let app_handle = self.app_handle.clone();
        tauri::async_runtime::spawn(async move {
            execute_os_shutdown(app_handle).await;
        });
    }
}

/// Actually execute the OS shutdown command
async fn execute_os_shutdown(app_handle: Arc<Mutex<Option<AppHandle>>>) {
    error!("[ShutdownManager] ========== EXECUTING OS SHUTDOWN ==========");

    // Notify backend (going offline) via API
    // Note: The SSE connection drop handles most of this automatically

    // Wait a bit for cleanup
    info!(
        "[ShutdownManager] Waiting {}s before shutdown...",
        POST_DESTROY_DELAY_SECONDS
    );
    tokio::time::sleep(std::time::Duration::from_secs(POST_DESTROY_DELAY_SECONDS)).await;

    // Execute OS shutdown
    #[cfg(target_os = "windows")]
    {
        info!("[ShutdownManager] Executing: shutdown /s /f /t 0");
        match tokio::process::Command::new("shutdown")
            .args(["/s", "/f", "/t", "0"])
            .output()
            .await
        {
            Ok(output) => {
                info!(
                    "[ShutdownManager] Shutdown command result: {}",
                    String::from_utf8_lossy(&output.stdout)
                );
            }
            Err(e) => {
                error!("[ShutdownManager] Shutdown failed: {}", e);
                // Reset state on failure
                if let Some(app) = app_handle.lock().unwrap().as_ref() {
                    let _ = app.emit("shutdown-countdown", &ShutdownState::default());
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        info!("[ShutdownManager] Executing: sudo shutdown -h now");
        match tokio::process::Command::new("sudo")
            .args(["shutdown", "-h", "now"])
            .output()
            .await
        {
            Ok(output) => {
                info!(
                    "[ShutdownManager] Shutdown command result: {}",
                    String::from_utf8_lossy(&output.stdout)
                );
            }
            Err(e) => {
                error!("[ShutdownManager] Shutdown failed: {}", e);
                if let Some(app) = app_handle.lock().unwrap().as_ref() {
                    let _ = app.emit("shutdown-countdown", &ShutdownState::default());
                }
            }
        }
    }
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Get current shutdown state
#[tauri::command]
pub fn get_shutdown_state(
    shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>,
) -> ShutdownState {
    shutdown_mgr.get_state()
}

/// Start shutdown countdown (called from frontend or SSE)
#[tauri::command]
pub fn start_shutdown_countdown(
    shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>,
    minutes: Option<u32>,
    reason: Option<String>,
) {
    let reason = match reason.as_deref() {
        Some("timer") => ShutdownReason::Timer,
        _ => ShutdownReason::Manual,
    };
    shutdown_mgr.start_countdown(minutes, reason);
}

/// Cancel shutdown countdown
#[tauri::command]
pub fn cancel_shutdown(shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>) {
    shutdown_mgr.cancel_shutdown();
}

/// Notify user activity (reset countdown)
#[tauri::command]
pub fn notify_user_activity(shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>) {
    shutdown_mgr.on_user_activity();
}

/// Start transaction (pause shutdown)
#[tauri::command]
pub fn start_transaction(shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>) {
    shutdown_mgr.start_transaction();
}

/// End transaction (resume shutdown)
#[tauri::command]
pub fn end_transaction(shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>) {
    shutdown_mgr.end_transaction();
}

/// Execute shutdown immediately (for testing or manual trigger)
#[tauri::command]
pub fn execute_shutdown_now(shutdown_mgr: tauri::State<'_, Arc<ShutdownManager>>) {
    shutdown_mgr.execute_immediate_shutdown();
}
