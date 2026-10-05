const RATES_TO_KZT = {
  KZT: 1,
  USD: 480,
  EUR: 520,
  RUB: 5.2,
};

export function setRatesToKzt(rates) {
  for (const [code, value] of Object.entries(rates || {})) {
    const rate = Number(value);
    if (code in RATES_TO_KZT && Number.isFinite(rate) && rate > 0) {
      RATES_TO_KZT[code] = rate;
    }
  }
}

export function currencySymbol(currency) {
  return { KZT: "₸", USD: "$", EUR: "€", RUB: "₽" }[currency] || "₸";
}

export function typeLabel(type) {
  return type === "service" ? "Услуга" : "Товар";
}

export function toKzt(amount, fromCurrency = "KZT") {
  const rate = RATES_TO_KZT[fromCurrency] || 1;
  return Number(amount || 0) * rate;
}

/** Whole tenge per unit — matches what the server charges. */
export function unitPriceKzt(service) {
  return Math.max(0, Math.round(toKzt(service?.priceTenge || 0, service?.currency || "KZT")));
}

export function fromKzt(amountKzt, toCurrency = "KZT") {
  const rate = RATES_TO_KZT[toCurrency] || 1;
  return Number(amountKzt || 0) / rate;
}

export function formatMoney(amount, currency = "KZT") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  const digits = currency === "KZT" || currency === "RUB" ? 0 : 2;
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)} ${currencySymbol(currency)}`;
}

export function formatTenge(amount) {
  return formatMoney(amount, "KZT");
}

/** null = unlimited; number = remaining units */
export function getStockLimit(item) {
  if (
    item == null ||
    item.quantity === undefined ||
    item.quantity === null ||
    item.quantity === ""
  ) {
    return null;
  }
  const n = Number(item.quantity);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

export function isPurchasable(item, qty = 1) {
  const stock = getStockLimit(item);
  if (stock === null) return true;
  const need = Math.max(1, Number(qty) || 1);
  return stock >= need;
}

export function resolvePrice(service, displayCurrency = "KZT") {
  if (service.priceTenge == null || service.priceTenge === "") {
    return service.price ? String(service.price) : "";
  }
  const itemCurrency = service.currency || "KZT";
  const amountKzt = toKzt(service.priceTenge, itemCurrency);
  const converted = fromKzt(amountKzt, displayCurrency);
  return `от ${formatMoney(converted, displayCurrency)}`;
}

export function cartTotal(items) {
  return items.reduce(
    (sum, item) => sum + (item.priceTenge || 0) * (item.qty || 1),
    0
  );
}
