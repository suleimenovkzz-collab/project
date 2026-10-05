const config = require("./config");
const { EllaError, cancelled, timeout, upstream } = require("./errors");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503;
}

/**
 * Call OpenAI Chat Completions with timeout and one retry on 429/5xx.
 * Each attempt is capped by both requestTimeoutMs and the caller's overall deadline;
 * `signal` aborts everything (e.g. the visitor closed the tab).
 * @param {{ apiKey: string, model: string, messages: object[], tools?: object[], temperature?: number, maxTokens?: number, deadline?: number, signal?: AbortSignal }} opts
 */
async function chatCompletions({
  apiKey,
  model,
  messages,
  tools,
  temperature = config.temperature,
  maxTokens = config.maxTokens,
  deadline = Date.now() + config.replyBudgetMs,
  signal,
}) {
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const remaining = () => deadline - Date.now();
  const canRetry = (attempt) =>
    attempt < config.maxRetries && remaining() > config.retryDelayMs + config.minAttemptMs;

  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (signal?.aborted) throw cancelled(signal.reason);
    if (remaining() < config.minAttemptMs) throw timeout(lastError);

    const attemptSignal = AbortSignal.timeout(Math.min(config.requestTimeoutMs, remaining()));
    const combined = signal ? AbortSignal.any([attemptSignal, signal]) : attemptSignal;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: combined,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = payload?.error?.message || "Ошибка OpenAI API";
        if (isRetryableStatus(response.status) && canRetry(attempt)) {
          await sleep(config.retryDelayMs);
          continue;
        }
        throw upstream(detail, payload?.error);
      }

      return payload;
    } catch (error) {
      if (signal?.aborted) throw cancelled(signal.reason);
      const aborted =
        error?.name === "AbortError" ||
        error?.name === "TimeoutError" ||
        error?.code === "ABORT_ERR";
      if (aborted) {
        throw timeout(error);
      }
      if (error instanceof EllaError || error?.name === "EllaError") {
        throw error;
      }
      lastError = error;
      if (canRetry(attempt)) {
        await sleep(config.retryDelayMs);
        continue;
      }
      throw upstream(error.message || "Сбой сети OpenAI", error);
    }
  }

  throw upstream(lastError?.message || "Сбой OpenAI API", lastError);
}

module.exports = { chatCompletions };
