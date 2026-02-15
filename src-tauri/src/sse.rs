use futures_util::StreamExt;
use log::{error, info, warn};
use reqwest::Client;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

const API_BASE_URL: &str = "https://api-booth.boniolabs.com";

/// SSE Client that runs in the Rust backend.
/// Maintains a persistent HTTP connection to the backend SSE endpoint.
/// When the connection drops (app close/crash), the backend detects it
/// and sends a Telegram notification automatically.
pub struct SseClient {
    connected: Arc<AtomicBool>,
    shutdown: Arc<Notify>,
    running: Arc<AtomicBool>,
}

impl SseClient {
    pub fn new() -> Self {
        Self {
            connected: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(Notify::new()),
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    /// Start the SSE connection in a background task.
    /// Will auto-reconnect with exponential backoff on disconnect.
    pub fn connect(&self, app: AppHandle, machine_id: String, machine_port: String) {
        // Prevent multiple connections
        if self.running.load(Ordering::Relaxed) {
            info!("[SSE] Already running, disconnecting first...");
            self.disconnect();
        }

        self.running.store(true, Ordering::Relaxed);
        let connected = self.connected.clone();
        let shutdown = self.shutdown.clone();
        let running = self.running.clone();

        tauri::async_runtime::spawn(async move {
            let client = Client::new();
            let mut reconnect_delay: u64 = 5;
            let mut reconnect_attempts: u32 = 0;
            let max_reconnect_attempts: u32 = 100; // effectively unlimited

            loop {
                if !running.load(Ordering::Relaxed) {
                    info!("[SSE] Stopped (manual disconnect)");
                    break;
                }

                let url = format!(
                    "{}/api/sse/machine/connect?machineId={}",
                    API_BASE_URL, machine_id
                );
                info!("[SSE] Connecting to: {}", url);

                match client
                    .get(&url)
                    .header("Accept", "text/event-stream")
                    .header("Cache-Control", "no-cache")
                    .header("Connection", "keep-alive")
                    .header("X-Machine-Port", &machine_port)
                    .send()
                    .await
                {
                    Ok(response) => {
                        let status = response.status();
                        if status == reqwest::StatusCode::BAD_GATEWAY
                            || status == reqwest::StatusCode::SERVICE_UNAVAILABLE
                        {
                            warn!("[SSE] Server returned {}, will retry...", status);
                            let _ = app.emit("sse-status", serde_json::json!({
                                "connected": false,
                                "status502": status.as_u16() == 502
                            }));
                        } else if !status.is_success() {
                            warn!("[SSE] Server returned {}, will retry...", status);
                        } else {
                            // Connected successfully
                            connected.store(true, Ordering::Relaxed);
                            reconnect_delay = 5;
                            reconnect_attempts = 0;
                            info!("[SSE] Connected successfully");

                            let _ = app.emit("sse-status", serde_json::json!({
                                "connected": true
                            }));

                            // Process the stream
                            let mut stream = response.bytes_stream();
                            let mut buffer = String::new();
                            let mut current_event = String::new();
                            let mut current_data = String::new();

                            loop {
                                tokio::select! {
                                    chunk = stream.next() => {
                                        match chunk {
                                            Some(Ok(bytes)) => {
                                                let text = String::from_utf8_lossy(&bytes);
                                                buffer.push_str(&text);

                                                // Process complete lines
                                                while let Some(line_end) = buffer.find('\n') {
                                                    let line = buffer[..line_end].trim_end_matches('\r').to_string();
                                                    buffer = buffer[line_end + 1..].to_string();

                                                    if line.is_empty() {
                                                        // Empty line = end of event
                                                        if !current_data.is_empty() {
                                                            process_sse_event(
                                                                &app,
                                                                &current_event,
                                                                &current_data,
                                                            );
                                                        }
                                                        current_event.clear();
                                                        current_data.clear();
                                                    } else if let Some(value) = line.strip_prefix("event:") {
                                                        current_event = value.trim().to_string();
                                                    } else if let Some(value) = line.strip_prefix("data:") {
                                                        if !current_data.is_empty() {
                                                            current_data.push('\n');
                                                        }
                                                        current_data.push_str(value.trim());
                                                    } else if line.starts_with(':') {
                                                        // Comment/heartbeat - ignore but log
                                                        // (heartbeat keeps connection alive)
                                                    }
                                                }
                                            }
                                            Some(Err(e)) => {
                                                warn!("[SSE] Stream error: {}", e);
                                                break;
                                            }
                                            None => {
                                                info!("[SSE] Stream ended");
                                                break;
                                            }
                                        }
                                    }
                                    _ = shutdown.notified() => {
                                        info!("[SSE] Shutdown signal received");
                                        connected.store(false, Ordering::Relaxed);
                                        running.store(false, Ordering::Relaxed);
                                        return;
                                    }
                                }
                            }

                            // Stream ended or errored - mark disconnected
                            connected.store(false, Ordering::Relaxed);
                            let _ = app.emit("sse-status", serde_json::json!({
                                "connected": false
                            }));
                        }
                    }
                    Err(e) => {
                        error!("[SSE] Connection error: {}", e);
                    }
                }

                // Check if we should stop
                if !running.load(Ordering::Relaxed) {
                    break;
                }

                // Reconnect with exponential backoff
                reconnect_attempts += 1;
                if reconnect_attempts >= max_reconnect_attempts {
                    error!("[SSE] Max reconnect attempts reached");
                    break;
                }

                let delay = std::cmp::min(reconnect_delay, 60);
                warn!(
                    "[SSE] Reconnecting in {}s (attempt {}/{})",
                    delay, reconnect_attempts, max_reconnect_attempts
                );

                // Wait for delay or shutdown signal
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(delay)) => {}
                    _ = shutdown.notified() => {
                        info!("[SSE] Shutdown during reconnect wait");
                        connected.store(false, Ordering::Relaxed);
                        running.store(false, Ordering::Relaxed);
                        return;
                    }
                }

                reconnect_delay = std::cmp::min(reconnect_delay * 2, 60);
            }

            connected.store(false, Ordering::Relaxed);
            running.store(false, Ordering::Relaxed);
        });
    }

    /// Disconnect the SSE connection gracefully.
    pub fn disconnect(&self) {
        info!("[SSE] Disconnecting...");
        self.running.store(false, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        self.shutdown.notify_waiters();
    }
}

/// Process a parsed SSE event and emit it to the frontend via Tauri events.
fn process_sse_event(app: &AppHandle, event_type: &str, data: &str) {
    // Try to parse data as JSON
    let parsed: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => {
            // Non-JSON data (like heartbeat)
            Value::String(data.to_string())
        }
    };

    let event_name = if event_type.is_empty() {
        // Default message event - check for "type" field in data
        if let Some(t) = parsed.get("type").and_then(|v| v.as_str()) {
            t.to_string()
        } else {
            "message".to_string()
        }
    } else {
        event_type.to_string()
    };

    info!("[SSE] Event: {} -> {:?}", event_name, parsed);

    // Emit to frontend
    let _ = app.emit(
        "sse-event",
        serde_json::json!({
            "type": event_name,
            "data": parsed
        }),
    );

    // Handle close-app directly from backend
    if event_name == "close-app" {
        info!("[SSE] Close-app event received, exiting...");
        app.exit(0);
    }
}
