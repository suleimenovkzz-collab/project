export const ADMIN_UNAUTHORIZED_EVENT = "admin:unauthorized";

export async function adminApi(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch {
    const error = new Error("Нет связи с сервером");
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A wrong password on the login form is also 401 — that is not an expired session.
    if (response.status === 401 && url !== "/api/login") {
      window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
    }
    const base = data.error || `Ошибка сервера (${response.status})`;
    const error = new Error(data.requestId ? `${base} (код ошибки: ${data.requestId})` : base);
    error.status = response.status;
    throw error;
  }
  return data;
}
