import { downloadFile } from "./downloadFile";

/**
 * Downloads invoice PDF for an order (admin session cookie / same-origin).
 * Rejects with the server's message so the caller can show why it failed.
 * @param {string} orderId
 */
export function downloadInvoice(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return Promise.resolve();
  return downloadFile(`/api/orders/${encodeURIComponent(id)}/invoice.pdf`, `invoice-${id}.pdf`);
}
