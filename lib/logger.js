/**
 * Structured JSON logs (one line per event) — ready for grep/jq, Loki, ELK, Datadog.
 * Never pass req.body here: it carries the admin password and customers' phones.
 */
function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      cause: error.cause?.message || error.cause,
    };
  }
  return { message: String(error) };
}

function write(level, message, meta = {}) {
  const { error, ...rest } = meta;
  const entry = { time: new Date().toISOString(), level, message, ...rest };
  if (error !== undefined) entry.error = serializeError(error);
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function requestMeta(req) {
  return {
    requestId: req.id,
    method: req.method,
    path: String(req.originalUrl || req.url || "").split("?")[0],
    ip: req.ip,
  };
}

module.exports = {
  error: (message, meta) => write("error", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  info: (message, meta) => write("info", message, meta),
  requestMeta,
};
