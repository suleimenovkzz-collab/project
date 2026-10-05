export const STATUS_LABELS = {
  new: "Новый",
  contacted: "На связи",
  done: "Закрыт",
  cancelled: "Отменён",
};

export const SOURCE_LABELS = {
  cart: "Корзина",
  direct: "Быстрый заказ",
  ella: "ELLA",
};

export const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export const TAB_TITLES = {
  catalog: "Список",
  orders: "Заказы",
  clients: "Клиенты",
};

export function formatPrice(amount, currency = "KZT") {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  const symbols = { KZT: "₸", USD: "$", RUB: "₽", EUR: "€" };
  return `${new Intl.NumberFormat("ru-RU").format(value)} ${symbols[currency] || "₸"}`;
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function normalizeWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("7")) {
    return `7${digits}`;
  }
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return "";
}

export function buildClientReplyMessage(order) {
  const name = String(order.customerName || "").trim() || "клиент";
  const items = Array.isArray(order.items) ? order.items : [];
  const titles = items
    .map((item) => String(item.title || "").trim())
    .filter(Boolean);

  let orderPart = "услугу";
  if (titles.length === 1) {
    orderPart = `услугу «${titles[0]}»`;
  } else if (titles.length > 1) {
    orderPart = `услуги: ${titles.map((title) => `«${title}»`).join(", ")}`;
  }

  return (
    `Здравствуйте, ${name}!\n` +
    `Вы хотели заказать ${orderPart}.\n` +
    `Подскажите, пожалуйста, когда вам удобно записаться?`
  );
}

export function clientWhatsAppLink(order) {
  const phone = normalizeWhatsAppPhone(order.customerPhone);
  if (!phone) return "";
  const message = buildClientReplyMessage(order);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function clientPhoneKey(order) {
  return (
    normalizeWhatsAppPhone(order.customerPhone) ||
    String(order.customerPhone || "").trim() ||
    `name:${String(order.customerName || "").trim().toLowerCase() || "unknown"}`
  );
}

export function buildClients(ordersCache, { applyStatusFilter = true, orderStatusFilter = "all" } = {}) {
  const map = new Map();

  ordersCache.forEach((order) => {
    const phoneKey = clientPhoneKey(order);
    const status = order.status || "new";
    const existing = map.get(phoneKey);
    const items = Array.isArray(order.items) ? order.items : [];
    const titles = items.map((item) => item.title).filter(Boolean);
    const createdAt = order.createdAt || "";

    if (!existing) {
      map.set(phoneKey, {
        phoneKey,
        name: order.customerName || "Без имени",
        phone: order.customerPhone || "",
        ordersCount: 1,
        totalTenge: Number(order.totalTenge) || 0,
        lastOrderAt: createdAt,
        titles: [...new Set(titles)],
        lastOrder: order,
        statuses: { [status]: 1 },
      });
      return;
    }

    existing.ordersCount += 1;
    existing.totalTenge += Number(order.totalTenge) || 0;
    titles.forEach((title) => {
      if (!existing.titles.includes(title)) existing.titles.push(title);
    });
    existing.statuses[status] = (existing.statuses[status] || 0) + 1;
    if (createdAt && (!existing.lastOrderAt || createdAt > existing.lastOrderAt)) {
      existing.lastOrderAt = createdAt;
      existing.lastOrder = order;
      if (order.customerName) existing.name = order.customerName;
      if (order.customerPhone) existing.phone = order.customerPhone;
    }
  });

  let clients = [...map.values()];
  if (applyStatusFilter && orderStatusFilter !== "all") {
    clients = clients.filter((client) => (client.statuses[orderStatusFilter] || 0) > 0);
  }

  return clients.sort((a, b) => String(b.lastOrderAt).localeCompare(String(a.lastOrderAt)));
}

export function typeLabel(type) {
  return type === "service" ? "Услуга" : "Товар";
}
