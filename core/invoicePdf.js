const path = require("path");
const pdfmake = require("pdfmake");
const robotoFonts = require("pdfmake/fonts/Roboto.js");
const company = require("../config/company");

const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

const SOURCE_LABELS = {
  cart: "Корзина",
  direct: "Быстрый заказ",
  ella: "ELLA",
};

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

/**
 * INV-YYYY-XXXXXXXX — год из createdAt + первые 8 символов UUID без дефисов.
 */
function buildInvoiceNumber(order) {
  const id = String(order?.id || "").replace(/-/g, "").toUpperCase();
  const short = (id.slice(0, 8) || "00000000").padEnd(8, "0");
  const created = order?.createdAt ? new Date(order.createdAt) : new Date();
  const year = Number.isNaN(created.getTime())
    ? new Date().getFullYear()
    : created.getFullYear();
  return `INV-${year}-${short}`;
}

function formatDisplayDate(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString("ru-RU");
  }
  return date.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatMoney(amount) {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.round(safe).toLocaleString("ru-RU")} KZT`;
}

function formatQty(qty) {
  const n = Number(qty);
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "1";
}

function sellerBlock() {
  const lines = [
    { text: company.legalName, style: "sellerName" },
    { text: `ИИН/БИН: ${company.iinBin}`, style: "sellerMeta" },
    { text: `Банк: ${company.bankName}`, style: "sellerMeta" },
    { text: `IBAN: ${company.iban}`, style: "sellerMeta" },
    { text: `БИК: ${company.bik}`, style: "sellerMeta" },
    { text: `Адрес: ${company.address}`, style: "sellerMeta" },
    { text: `Тел.: ${company.phone}`, style: "sellerMeta" },
  ];
  if (company.email) {
    lines.push({ text: `E-mail: ${company.email}`, style: "sellerMeta" });
  }
  return lines;
}

function buildItemsTable(items) {
  const header = [
    { text: "№", style: "tableHeader", alignment: "center" },
    { text: "Наименование", style: "tableHeader" },
    { text: "Кол-во", style: "tableHeader", alignment: "center" },
    { text: "Цена (KZT)", style: "tableHeader", alignment: "right" },
    { text: "Сумма (KZT)", style: "tableHeader", alignment: "right" },
  ];

  const rows = (Array.isArray(items) ? items : []).map((item, index) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const price = Number(item.priceTenge) || 0;
    const sum = price * qty;
    return [
      { text: String(index + 1), alignment: "center" },
      { text: String(item.title || "—").trim() || "—" },
      { text: formatQty(qty), alignment: "center" },
      { text: Math.round(price).toLocaleString("ru-RU"), alignment: "right" },
      { text: Math.round(sum).toLocaleString("ru-RU"), alignment: "right" },
    ];
  });

  if (!rows.length) {
    rows.push([
      { text: "—", alignment: "center", colSpan: 5 },
      {},
      {},
      {},
      {},
    ]);
  }

  return {
    table: {
      headerRows: 1,
      widths: [28, "*", 48, 72, 72],
      body: [header, ...rows],
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0.4,
      hLineColor: () => "#cccccc",
      vLineColor: () => "#dddddd",
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 8, 0, 12],
  };
}

function buildDocDefinition(order, invoiceNumber) {
  const channel =
    CHANNEL_LABELS[order.channel] || order.channel || "—";
  const source = SOURCE_LABELS[order.source] || order.source || "—";
  const note = String(order.customerNote || "").trim();
  const message = String(order.message || order.whatsappMessage || "").trim();
  const total = Number(order.totalTenge) || 0;

  const content = [
    {
      columns: [
        { width: "*", stack: sellerBlock() },
        {
          width: 200,
          alignment: "right",
          stack: [
            { text: "СЧЁТ НА ОПЛАТУ", style: "invoiceTitle" },
            { text: `№ ${invoiceNumber}`, style: "invoiceNumber", margin: [0, 6, 0, 0] },
            {
              text: `от ${formatDisplayDate(order.createdAt)}`,
              style: "invoiceDate",
              margin: [0, 4, 0, 0],
            },
          ],
        },
      ],
      columnGap: 16,
      margin: [0, 0, 0, 18],
    },
    {
      text: "Покупатель",
      style: "sectionLabel",
      margin: [0, 0, 0, 4],
    },
    {
      stack: [
        { text: `ФИО: ${order.customerName || "—"}`, style: "buyerLine" },
        { text: `Телефон: ${order.customerPhone || "—"}`, style: "buyerLine" },
        { text: `Канал: ${channel} · Источник: ${source}`, style: "buyerLine" },
      ],
      margin: [0, 0, 0, 14],
    },
    { text: "Позиции заказа", style: "sectionLabel", margin: [0, 0, 0, 2] },
    buildItemsTable(order.items),
    {
      columns: [
        { width: "*", text: "" },
        {
          width: 220,
          stack: [
            {
              text: `Итого: ${formatMoney(total)}`,
              style: "totalAmount",
              alignment: "right",
            },
            {
              text: company.taxNote || "Без НДС",
              style: "taxNote",
              alignment: "right",
              margin: [0, 4, 0, 0],
            },
          ],
        },
      ],
      margin: [0, 4, 0, 16],
    },
  ];

  if (note) {
    content.push({
      text: "Заметка",
      style: "sectionLabel",
      margin: [0, 0, 0, 4],
    });
    content.push({ text: note, style: "noteBody", margin: [0, 0, 0, 10] });
  }

  if (message) {
    content.push({
      text: "Сообщение / комментарий",
      style: "sectionLabel",
      margin: [0, 0, 0, 4],
    });
    content.push({ text: message, style: "noteBody", margin: [0, 0, 0, 10] });
  }

  content.push({
    columns: [
      {
        width: "*",
        stack: [
          { text: "Руководитель / Составил", style: "signLabel" },
          { text: "________________________ / ______________", style: "signLine", margin: [0, 18, 0, 0] },
          { text: "подпись / ФИО", style: "signHint", margin: [0, 4, 0, 0] },
        ],
      },
      {
        width: "*",
        stack: [
          { text: "М.П.", style: "signLabel", alignment: "right" },
          {
            text: "Место для печати",
            style: "signHint",
            alignment: "right",
            margin: [0, 28, 0, 0],
          },
        ],
      },
    ],
    margin: [0, 28, 0, 0],
  });

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 48],
    defaultStyle: {
      font: "Roboto",
      fontSize: 10,
      color: "#1a1a1a",
    },
    styles: {
      sellerName: { fontSize: 11, bold: true },
      sellerMeta: { fontSize: 8, color: "#444444", margin: [0, 1, 0, 0] },
      invoiceTitle: { fontSize: 16, bold: true },
      invoiceNumber: { fontSize: 11, bold: true },
      invoiceDate: { fontSize: 9, color: "#555555" },
      sectionLabel: { fontSize: 10, bold: true, color: "#222222" },
      buyerLine: { fontSize: 9, margin: [0, 1, 0, 0] },
      tableHeader: { bold: true, fontSize: 9, color: "#111111" },
      totalAmount: { fontSize: 14, bold: true, color: "#0b5fff" },
      taxNote: { fontSize: 9, color: "#555555" },
      noteBody: { fontSize: 9, color: "#333333" },
      signLabel: { fontSize: 9, bold: true },
      signLine: { fontSize: 9 },
      signHint: { fontSize: 8, color: "#888888" },
      footer: { fontSize: 8, color: "#777777" },
    },
    footer: (currentPage, pageCount) => ({
      margin: [40, 0, 40, 20],
      columns: [
        {
          text: company.legalName,
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
    content,
  };
}

/**
 * @param {object} order — заказ из store.getOrderById
 * @returns {Promise<{ buffer: Buffer, filename: string, invoiceNumber: string }>}
 */
async function buildInvoicePdf(order) {
  if (!order || !order.id) {
    const err = new Error("ORDER_NOT_FOUND");
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }

  ensurePdfmakeConfigured();
  const invoiceNumber = buildInvoiceNumber(order);
  const docDefinition = buildDocDefinition(order, invoiceNumber);
  const pdf = pdfmake.createPdf(docDefinition);
  const buffer = await pdf.getBuffer();
  const filename = `invoice-${invoiceNumber}.pdf`;
  return { buffer, filename, invoiceNumber };
}

module.exports = {
  buildInvoicePdf,
  buildInvoiceNumber,
};
