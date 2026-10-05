import { ADMIN_UNAUTHORIZED_EVENT } from "../api/admin";

/**
 * Downloads a file via fetch so that server errors (JSON with `error`) become a thrown
 * Error with a readable message instead of a raw JSON tab.
 * @param {string} url
 * @param {string} filename
 */
export async function downloadFile(url, filename) {
  let response;
  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new Error("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
    const data = await response.json().catch(() => ({}));
    const base = data.error || `Не удалось скачать файл (код ${response.status})`;
    throw new Error(data.requestId ? `${base} (код ошибки: ${data.requestId})` : base);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
