import { TELEGRAM_USERNAME, WHATSAPP_NUMBER } from "./constants";
import { cartTotal, formatTenge, resolvePrice } from "./money";

export function buildCartMessage(items, customer = {}) {
  const lines = items.map(
    (item, index) =>
      `${index + 1}. ${item.title} × ${item.qty || 1} — ${formatTenge(
        (item.priceTenge || 0) * (item.qty || 1)
      )}`
  );
  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const contact =
    name || phone
      ? `\nКлиент: ${name || "—"}${phone ? `\nТелефон: ${phone}` : ""}\n`
      : "";

  return (
    `Здравствуйте, Алишер Галымханович! Пишу с вашего сайта.\n` +
    `Хочу заказать услуги:\n` +
    `${lines.join("\n")}\n` +
    `Итого: ${formatTenge(cartTotal(items))}.` +
    contact +
    `\nПодскажите, пожалуйста, удобное время для записи.`
  );
}

export function buildDirectMessage(service, customer = {}) {
  const priceText = resolvePrice(service);
  const pricePart = priceText ? ` (${priceText})` : "";
  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const contact =
    name || phone
      ? `\nКлиент: ${name || "—"}${phone ? `\nТелефон: ${phone}` : ""}\n`
      : "";

  return (
    `Здравствуйте, Алишер Галымханович! Пишу с вашего сайта.\n` +
    `Хочу заказать услугу: «${service.title}»${pricePart}.` +
    contact +
    `\nПодскажите, пожалуйста, удобное время для записи.`
  );
}

export function whatsappLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function telegramLink(message) {
  return `https://t.me/share/url?url=${encodeURIComponent(
    "https://t.me/" + TELEGRAM_USERNAME
  )}&text=${encodeURIComponent(message)}`;
}

export function messengerLink(channel, message) {
  return channel === "telegram" ? telegramLink(message) : whatsappLink(message);
}

export async function openMessenger(channel, message, popup) {
  const selected = channel === "telegram" ? "telegram" : "whatsapp";
  if (selected === "telegram") {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // ignore
    }
  }
  const url = messengerLink(selected, message);
  if (popup && !popup.closed) {
    popup.location.href = url;
    return;
  }
  window.location.assign(url);
}

export function normalizePhoneInput(value) {
  return String(value || "")
    .trim()
    .replace(/[^\d+]/g, "");
}
