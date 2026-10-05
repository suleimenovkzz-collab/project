const config = require("../config");

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchService(services, query) {
  const q = normalizeQuery(query);
  if (!q) return null;

  const byExact = services.find((item) => normalizeQuery(item.title) === q);
  if (byExact) return byExact;

  const byIncludes = services.find((item) => {
    const title = normalizeQuery(item.title);
    return title && (q.includes(title) || title.includes(q));
  });
  if (byIncludes) return byIncludes;

  return (
    services.find((item) => {
      const title = normalizeQuery(item.title);
      const words = title.split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => q.includes(w));
    }) || null
  );
}

function serializeService(item) {
  const currency = item.currency || "KZT";
  const symbol = config.currencySymbols[currency] || "₸";
  return {
    id: item.id,
    title: item.title,
    type: item.type === "product" ? "product" : "service",
    price: item.priceTenge,
    currency,
    priceLabel: `${item.priceTenge} ${symbol}`,
    description: item.description || "",
  };
}

const getCatalog = {
  name: "get_catalog",
  description:
    "Вернуть актуальный каталог услуг и товаров с ценами. Используй перед ответом о прайсе или списке услуг.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Сколько позиций вернуть (1–30). По умолчанию 20.",
      },
      query: {
        type: "string",
        description: "Опциональный фильтр по названию услуги.",
      },
    },
  },
  async execute(args, ctx) {
    const services = typeof ctx.readServices === "function" ? ctx.readServices() : [];
    const limit = Math.min(30, Math.max(1, Number.parseInt(String(args.limit ?? 20), 10) || 20));
    const query = normalizeQuery(args.query);

    let list = Array.isArray(services) ? services : [];
    if (query) {
      list = list.filter((item) => {
        const title = normalizeQuery(item.title);
        const desc = normalizeQuery(item.description);
        return title.includes(query) || desc.includes(query) || query.includes(title);
      });
    }

    const items = list.slice(0, limit).map(serializeService);
    return {
      count: items.length,
      items,
      note: items.length
        ? "Цены ориентировочные; точную стоимость определяет врач после осмотра."
        : "По запросу ничего не найдено. Предложи написать врачу в WhatsApp.",
    };
  },
};

const getService = {
  name: "get_service",
  description:
    "Найти одну услугу/товар по названию или ключевым словам и вернуть цену и описание из каталога.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Название или ключевые слова (виниры, имплант, чистка и т.д.).",
      },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const services = typeof ctx.readServices === "function" ? ctx.readServices() : [];
    const query = String(args.query || "").trim();
    if (!query) {
      return { found: false, error: "query is required" };
    }

    const match = matchService(services, query);
    if (!match) {
      return {
        found: false,
        query,
        message: "Услуга не найдена в каталоге. Не выдумывай цену — предложи WhatsApp.",
      };
    }

    return {
      found: true,
      service: serializeService(match),
      note: "Ориентир по цене; финальную стоимость скажет врач.",
    };
  },
};

module.exports = { getCatalog, getService, matchService, serializeService };
