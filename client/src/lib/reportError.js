const MAX_REPORTS_PER_PAGE = 10;
let sent = 0;

/**
 * Sends a browser-side error to the server log (POST /api/client-errors).
 * @param {unknown} error
 * @param {{ source?: string, componentStack?: string }} [extra]
 */
export function reportError(error, extra = {}) {
  if (sent >= MAX_REPORTS_PER_PAGE) return;
  sent += 1;
  const payload = {
    source: extra.source || "app",
    message: String(error?.message || error || "unknown").slice(0, 500),
    stack: String(error?.stack || "").slice(0, 4000),
    componentStack: String(extra.componentStack || "").slice(0, 2000),
    page: window.location.pathname,
  };
  fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((sendError) => {
    // Must not report its own failure — that would loop.
    console.warn("[reportError] could not send:", sendError);
  });
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (event) => {
    reportError(event.error || event.message, { source: "window.error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { source: "unhandledrejection" });
  });
}
