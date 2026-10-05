const fs = require("fs");
const path = require("path");
const pdfmake = require("pdfmake");
const robotoFonts = require("pdfmake/fonts/Roboto.js");

const DEFAULT_UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
const PLATFORM_NAME = "Клиника доктора Сулейменова";
const IMAGE_SIZE = 80;

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Minimal 1×1 light-gray PNG used as a safe fallback. */
const PLACEHOLDER_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let fontsConfigured = false;

function ensurePdfmakeConfigured() {
  if (fontsConfigured) return;
  pdfmake.setFonts(robotoFonts);
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((filePath) => {
    const normalized = path.normalize(String(filePath || ""));
    const fontsRoot = path.normalize(
      path.join(path.dirname(require.resolve("pdfmake/package.json")), "fonts")
    );
    return normalized.startsWith(fontsRoot + path.sep) || normalized === fontsRoot;
  });
  fontsConfigured = true;
}

function formatDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(date = new Date()) {
  return date.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatPrice(amount, currency) {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = Math.round(safe).toLocaleString("ru-RU");
  return `${formatted} ${String(currency || "KZT").toUpperCase()}`;
}

function stockLabel(quantity) {
  if (quantity === null || quantity === undefined) return "В наличии";
  const n = Number(quantity);
  if (!Number.isFinite(n)) return "В наличии";
  return n > 0 ? "В наличии" : "Нет в наличии";
}

function filterByType(items, typeFilter) {
  const list = Array.isArray(items) ? items : [];
  const type = String(typeFilter || "all").trim().toLowerCase();
  if (type === "product" || type === "service") {
    return list.filter((item) => (item.type || "service") === type);
  }
  return list;
}

function typeSubtitle(typeFilter) {
  const type = String(typeFilter || "all").trim().toLowerCase();
  if (type === "product") return "Товары";
  if (type === "service") return "Услуги";
  return "Все позиции";
}

function resolveImageDataUrl(imagePath, uploadsDir) {
  const value = String(imagePath || "").trim();
  if (!value.startsWith("/uploads/")) return PLACEHOLDER_DATA_URL;

  const fileName = path.basename(value);
  if (
    !fileName ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    return PLACEHOLDER_DATA_URL;
  }

  const uploadRoot = path.resolve(uploadsDir || DEFAULT_UPLOAD_DIR);
  const fullPath = path.join(uploadRoot, fileName);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(uploadRoot + path.sep)) {
    return PLACEHOLDER_DATA_URL;
  }
  if (!fs.existsSync(resolved)) return PLACEHOLDER_DATA_URL;

  try {
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "image/jpeg";
    const buffer = fs.readFileSync(resolved);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return PLACEHOLDER_DATA_URL;
  }
}

function buildItemRow(item, uploadsDir) {
  const title = String(item.title || "Без названия").trim() || "Без названия";
  const description = String(item.description || "").trim() || "—";
  const price = formatPrice(item.priceTenge, item.currency);
  const stock = stockLabel(item.quantity);
  const image = resolveImageDataUrl(item.image, uploadsDir);

  return [
    {
      image,
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      fit: [IMAGE_SIZE, IMAGE_SIZE],
      alignment: "center",
      margin: [0, 4, 0, 4],
    },
    {
      stack: [
        { text: title, style: "itemTitle", margin: [0, 0, 0, 4] },
        { text: description, style: "itemDescription", margin: [0, 0, 0, 6] },
        {
          columns: [
            { text: price, style: "itemPrice", width: "*" },
            { text: stock, style: "itemStock", width: "auto", alignment: "right" },
          ],
        },
      ],
      margin: [8, 2, 0, 2],
    },
  ];
}

function buildDocDefinition(items, typeFilter, uploadsDir) {
  const generatedAt = new Date();
  const bodyRows =
    items.length > 0
      ? items.map((item) => buildItemRow(item, uploadsDir))
      : [
          [
            {
              text: "В каталоге пока нет позиций по выбранному фильтру.",
              colSpan: 2,
              style: "emptyState",
              margin: [0, 24, 0, 24],
            },
            {},
          ],
        ];

  return {
    pageSize: "A4",
    pageMargins: [40, 72, 40, 56],
    defaultStyle: {
      font: "Roboto",
      fontSize: 10,
      color: "#1a1a1a",
    },
    styles: {
      docTitle: { fontSize: 18, bold: true, color: "#111111" },
      company: { fontSize: 11, color: "#444444", margin: [0, 4, 0, 0] },
      meta: { fontSize: 9, color: "#666666", margin: [0, 2, 0, 0] },
      itemTitle: { fontSize: 12, bold: true, color: "#111111" },
      itemDescription: { fontSize: 9, color: "#555555", lineHeight: 1.25 },
      itemPrice: { fontSize: 11, bold: true, color: "#0b5fff" },
      itemStock: { fontSize: 9, color: "#333333" },
      emptyState: { fontSize: 11, color: "#666666", alignment: "center" },
      footer: { fontSize: 8, color: "#777777" },
    },
    header: {
      margin: [40, 24, 40, 0],
      stack: [
        { text: "Каталог товаров и услуг", style: "docTitle" },
        { text: PLATFORM_NAME, style: "company" },
        {
          text: `Дата формирования: ${formatDisplayDate(generatedAt)} · ${typeSubtitle(typeFilter)}`,
          style: "meta",
        },
      ],
    },
    footer: (currentPage, pageCount) => ({
      margin: [40, 0, 40, 24],
      columns: [
        {
          text: `Сформировано автоматически на сайте ${PLATFORM_NAME}`,
          style: "footer",
          width: "*",
        },
        {
          text: `Страница ${currentPage} из ${pageCount}`,
          style: "footer",
          alignment: "right",
          width: "auto",
        },
      ],
    }),
    content: [
      {
        table: {
          widths: [IMAGE_SIZE + 8, "*"],
          body: bodyRows,
        },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0.4),
          vLineWidth: () => 0,
          hLineColor: () => "#dddddd",
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
      },
    ],
  };
}

/**
 * @param {object[]} services
 * @param {string|{ typeFilter?: string, uploadsDir?: string }} [optionsOrType]
 * @returns {Promise<{ buffer: Buffer, filename: string, count: number }>}
 */
async function buildCatalogPdf(services, optionsOrType = "all") {
  ensurePdfmakeConfigured();

  let typeFilter = "all";
  let uploadsDir = DEFAULT_UPLOAD_DIR;
  if (typeof optionsOrType === "string") {
    typeFilter = optionsOrType;
  } else if (optionsOrType && typeof optionsOrType === "object") {
    typeFilter = optionsOrType.typeFilter || "all";
    if (optionsOrType.uploadsDir) uploadsDir = optionsOrType.uploadsDir;
  }

  const items = filterByType(services, typeFilter);
  const docDefinition = buildDocDefinition(items, typeFilter, uploadsDir);
  const pdf = pdfmake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  const filename = `catalog-${formatDateStamp()}.pdf`;
  return { buffer, filename, count: items.length };
}

module.exports = {
  buildCatalogPdf,
  filterByType,
  formatDateStamp,
  PLATFORM_NAME,
};
