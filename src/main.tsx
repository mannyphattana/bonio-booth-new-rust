import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { logError } from "./utils/logger";

// Global uncaught JS error handler
window.addEventListener("error", (event) => {
  logError(
    "global_js_error",
    event.message || "Unknown JS error",
    event.error?.stack,
    "critical"
  );
});

// Global unhandled promise rejection handler
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
      ? reason
      : JSON.stringify(reason);
  logError(
    "unhandled_promise",
    message,
    reason instanceof Error ? reason.stack : undefined,
    "error"
  );
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
