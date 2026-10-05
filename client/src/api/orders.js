export async function saveOrderToServer(payload) {
  const headers = { "Content-Type": "application/json" };
  if (payload?.idempotencyKey) {
    headers["Idempotency-Key"] = String(payload.idempotencyKey);
  }
  const response = await fetch("/api/orders", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Не удалось сохранить заявку");
  }
  return data;
}
