class EllaError extends Error {
  constructor(code, message, { status = 500, cause } = {}) {
    super(message);
    this.name = "EllaError";
    this.code = code;
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

function noKey() {
  return new EllaError("no_key", "AI-ключ не найден. Добавьте OPENAI_API_KEY в файл .env", {
    status: 503,
  });
}

function badRequest(message) {
  return new EllaError("bad_request", message || "Некорректный запрос", { status: 400 });
}

function timeout(cause) {
  return new EllaError("timeout", "Таймаут ответа AI. Попробуйте ещё раз.", {
    status: 502,
    cause,
  });
}

function cancelled(cause) {
  return new EllaError("cancelled", "Запрос отменён клиентом", { status: 499, cause });
}

function upstream(message, cause) {
  return new EllaError("upstream", message || "Ошибка OpenAI API", {
    status: 502,
    cause,
  });
}

function emptyReply(cause) {
  return new EllaError("empty_reply", "Пустой ответ от AI", {
    status: 502,
    cause,
  });
}

module.exports = {
  EllaError,
  noKey,
  badRequest,
  timeout,
  cancelled,
  upstream,
  emptyReply,
};
