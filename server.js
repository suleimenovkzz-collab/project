require("./config/loadEnv");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { createElla, EllaError } = require("./core");
const store = require("./db");
const company = require("./config/company");
const contacts = require("./config/contacts");
const { buildCatalogPdf } = require("./core/catalogPdf");
const { buildInvoicePdf } = require("./core/invoicePdf");
const logger = require("./lib/logger");
const { createRatesService, defaultCacheFile } = require("./lib/rates");
const { describeUploadError } = require("./lib/uploadErrors");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const WEAK_ADMIN_PASSWORDS = new Set(["admin", "password", "123456", "qwerty"]);
const MIN_ADMIN_PASSWORD_LENGTH = 12;

if (!ADMIN_PASSWORD) {
  console.error("Ошибка: задайте ADMIN_PASSWORD в файле .env");
  process.exit(1);
}
const adminPasswordWeak =
  WEAK_ADMIN_PASSWORDS.has(ADMIN_PASSWORD.toLowerCase()) ||
  ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH;
if (IS_PROD && adminPasswordWeak) {
  console.error(
    `Ошибка: в production ADMIN_PASSWORD должен быть не короче ${MIN_ADMIN_PASSWORD_LENGTH} символов и не из списка простых`
  );
  process.exit(1);
}
if (!IS_PROD && adminPasswordWeak) {
  console.warn(
    `Предупреждение: слабый ADMIN_PASSWORD. Для продакшена нужно ${MIN_ADMIN_PASSWORD_LENGTH}+ символов.`
  );
}

function parseTrustProxy(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function readPositiveNumber(name, fallback) {
  const n = Number(String(process.env[name] ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const CLIENT_DIST = path.join(__dirname, "client", "dist");
const CLIENT_INDEX = path.join(CLIENT_DIST, "index.html");
const MAX_ORDER_LINES = 30;
const MAX_QTY_PER_ITEM = Math.floor(readPositiveNumber("ORDER_MAX_QTY_PER_ITEM", 10));
const MAX_OPEN_ORDERS_PER_PHONE = 3;
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "1" ||
  process.env.COOKIE_SECURE === "true" ||
  IS_PROD;
const SESSION_TTL_MS = store.SESSION_TTL_MS;

// Without a reverse proxy X-Forwarded-For is client-controlled and must not be trusted.
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
app.disable("x-powered-by");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

/** Timer callbacks have no caller to catch for them — an escaped throw kills the process. */
function runSafely(scope, fn) {
  try {
    fn();
  } catch (error) {
    logger.error(scope, { error });
  }
}

process.on("unhandledRejection", (reason) => logger.error("unhandledRejection", { error: reason }));
process.on("uncaughtException", (error) => {
  logger.error("uncaughtException", { error });
  process.exit(1);
});

/** Logs the full error with request context; the client gets only a public message and requestId to quote. */
function serverError(req, res, error, publicMessage) {
  logger.error(publicMessage, { ...logger.requestMeta(req), error });
  return res.status(500).json({ error: publicMessage, requestId: req.id });
}

const db = store.openDatabase();
store.pruneSessions();
setInterval(() => runSafely("job:prune-sessions", store.pruneSessions), 60 * 60 * 1000).unref?.();

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start >= windowMs) hits.delete(key);
    }
  }, windowMs).unref?.();
  return function rateLimit(req, res, next) {
    const key = String(req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        error: message || "Слишком много запросов. Подождите немного.",
      });
    }
    next();
  };
}

const limitOrders = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Слишком много заявок. Подождите 15 минут.",
});
const limitElla = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Слишком много сообщений ELLA. Подождите немного.",
});
const limitLogin = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Слишком много попыток входа. Подождите немного.",
});
const limitPdf = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Слишком много запросов PDF. Подождите немного.",
});
const limitClientErrors = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
});

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use((req, res, next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader("X-Request-Id", req.id);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!req.path.startsWith("/api/")) {
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
  if (COOKIE_SECURE) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${safeExt}`);
  },
});

const PHOTO_LIMITS = { maxFileMb: 5, maxFiles: 1 };
const ELLA_LIMITS = { maxFileMb: 8, maxFiles: 3 };

const upload = multer({
  storage,
  limits: { fileSize: PHOTO_LIMITS.maxFileMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      const error = new Error("Можно загружать только изображения: JPG, PNG, WEBP или GIF.");
      error.code = "UNSUPPORTED_FILE_TYPE";
      return cb(error);
    }
    cb(null, true);
  },
});

const ellaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ELLA_LIMITS.maxFileMb * 1024 * 1024, files: ELLA_LIMITS.maxFiles },
});

function sendUploadError(req, res, error, limits) {
  const { status, message, internal } = describeUploadError(error, limits);
  const log = internal ? logger.error : logger.warn;
  log("upload rejected", { ...logger.requestMeta(req), status, code: error.code, error });
  return res.status(status).json({ error: message, ...(internal ? { requestId: req.id } : {}) });
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/products.html", (_req, res) => res.redirect(301, "/products"));
app.get("/cart.html", (_req, res) => res.redirect(301, "/cart"));
app.get("/admin/index.html", (_req, res) => res.redirect(301, "/admin"));

const CLIENT_PUBLIC = path.join(__dirname, "client", "public");

function sendFavicon(fileName, contentType) {
  return function faviconHandler(_req, res) {
    const candidates = [
      path.join(CLIENT_DIST, fileName),
      path.join(CLIENT_PUBLIC, fileName),
    ];
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        res.type(contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(filePath);
      }
    }
    return res.status(404).end();
  };
}

app.get("/favicon.ico", sendFavicon("favicon.ico", "image/png"));
app.get("/favicon.png", sendFavicon("favicon.png", "image/png"));
app.get("/favicon.svg", sendFavicon("favicon.svg", "image/svg+xml"));

app.use("/uploads", express.static(UPLOAD_DIR));
if (fs.existsSync(CLIENT_DIST)) {
  // index.html always goes through sendSpa so it carries the contacts <meta>.
  app.use(express.static(CLIENT_DIST, { index: false }));
}
// Fallback for favicons if dist is stale
app.use(express.static(path.join(__dirname, "public"), { index: false }));

function readServices() {
  return store.listServices();
}

const ORDER_STATUSES = new Set(["new", "contacted", "done", "cancelled"]);
const ORDER_SOURCES = new Set(["cart", "direct", "ella"]);
const ORDER_CHANNELS = new Set(["whatsapp", "telegram"]);

const fx = createRatesService({
  cacheFile: defaultCacheFile(path.dirname(process.env.SQLITE_PATH || path.join(__dirname, "data", "app.db"))),
  autoUpdate: !["0", "false"].includes(String(process.env.FX_AUTO_UPDATE || "").trim().toLowerCase()),
});
fx.start();

/** Whole tenge: order lines, totals and invoices must add up exactly. */
function priceToKzt(amount, currency) {
  const rate = fx.getRates()[String(currency || "KZT").toUpperCase()] || 1;
  return Math.round(Math.max(0, Number(amount) || 0) * rate);
}

/** KZ/RU numbers (8XXXXXXXXXX, XXXXXXXXXX, 7XXXXXXXXXX) → +7XXXXXXXXXX. */
function normalizePhone(value) {
  const raw = String(value || "").trim().replace(/[^\d+]/g, "");
  let digits = raw.replace(/\D/g, "").slice(0, 15);
  if (digits.length === 10) digits = `7${digits}`;
  else if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
  const international = raw.startsWith("+") || (digits.length === 11 && digits[0] === "7");
  return { phone: (international ? "+" : "") + digits, digits };
}

function isPlausiblePhone(digits) {
  if (digits.length < 10 || digits.length > 15) return false;
  const national = digits.length === 11 && digits[0] === "7" ? digits.slice(1) : digits;
  if (national.length === 10 && national[0] === "0") return false;
  return !/^(\d)\1+$/.test(national);
}

/** Older orders may store the same number as 8XXXXXXXXXX or XXXXXXXXXX. */
function phoneVariants(digits) {
  if (digits.length === 11 && digits[0] === "7") {
    const local = digits.slice(1);
    return [digits, `8${local}`, local];
  }
  return [digits];
}

/** null = unlimited stock; number = remaining units */
function getStockLimit(service) {
  if (
    service == null ||
    service.quantity === undefined ||
    service.quantity === null ||
    service.quantity === ""
  ) {
    return null;
  }
  const n = Number(service.quantity);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function parseQty(value) {
  return Math.max(1, Number.parseInt(String(value ?? 1), 10) || 1);
}

/**
 * Rebuilds order lines from catalog (prices/titles), merges duplicate ids,
 * enforces stock. Does not mutate catalog — createOrder applies decrements.
 */
function normalizeOrderItems(rawItems, catalog) {
  const empty = {
    items: [],
    missing: false,
    outOfStock: false,
    tooMany: false,
    tooManyUnits: false,
  };
  if (!Array.isArray(rawItems) || rawItems.length === 0) return empty;
  if (rawItems.length > MAX_ORDER_LINES) return { ...empty, tooMany: true };

  const byId = new Map(
    (Array.isArray(catalog) ? catalog : []).map((service) => [
      String(service.id),
      service,
    ])
  );

  const qtyById = new Map();
  let missing = false;

  for (const raw of rawItems) {
    const id = String(raw?.id || "").trim();
    if (!id) {
      missing = true;
      continue;
    }
    if (!byId.has(id)) {
      missing = true;
      continue;
    }
    qtyById.set(id, (qtyById.get(id) || 0) + parseQty(raw?.qty));
  }

  if (qtyById.size > MAX_ORDER_LINES) return { ...empty, tooMany: true };
  for (const qty of qtyById.values()) {
    if (qty > MAX_QTY_PER_ITEM) return { ...empty, tooManyUnits: true };
  }

  const items = [];
  let outOfStock = false;

  for (const [id, qty] of qtyById.entries()) {
    const service = byId.get(id);
    if (!service) {
      missing = true;
      continue;
    }
    const title = String(service.title || "").trim();
    if (!title) {
      missing = true;
      continue;
    }
    const stock = getStockLimit(service);
    if (stock !== null) {
      if (stock < 1 || qty > stock) {
        outOfStock = true;
        continue;
      }
    }
    items.push({
      id: String(service.id),
      title,
      qty,
      priceTenge: priceToKzt(service.priceTenge, service.currency),
    });
  }

  return { ...empty, items, missing, outOfStock };
}

function buildOrderMessage(items, customerName, customerPhone) {
  const lines = items.map(
    (item, index) =>
      `${index + 1}. ${item.title} × ${item.qty} — ${Math.round(item.priceTenge * item.qty)} ₸`
  );
  const total = items.reduce((sum, item) => sum + item.priceTenge * item.qty, 0);
  return (
    `Заявка с сайта\n` +
    `${lines.join("\n")}\n` +
    `Итого: ${Math.round(total)} ₸\n` +
    `Клиент: ${customerName}\n` +
    `Телефон: ${customerPhone}`
  );
}

function parsePriceTenge(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }

  let text = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[₸$€₽]/g, "");
  if (!text) return null;

  if (/^\d+,\d{1,2}$/.test(text)) {
    text = text.replace(",", ".");
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const amount = Number(text);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "product" || type === "товар") return "product";
  return "service";
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  if (["KZT", "USD", "EUR", "RUB"].includes(currency)) return currency;
  return "KZT";
}

/** Empty / omitted quantity → null (unlimited). Explicit 0 → out of stock. */
function parseQuantity(value, fallback) {
  const raw =
    value === undefined || value === null || value === ""
      ? fallback
      : value;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number.parseInt(String(raw).replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function parseItemFields(body, fallback = {}) {
  const title = String(body?.title ?? fallback.title ?? "").trim();
  const description = String(body?.description ?? fallback.description ?? "").trim();
  const priceTenge =
    body?.priceTenge !== undefined && body?.priceTenge !== ""
      ? parsePriceTenge(body.priceTenge)
      : fallback.priceTenge ?? parsePriceTenge(fallback.price);
  const type = normalizeType(body?.type ?? fallback.type);
  const currency = normalizeCurrency(body?.currency ?? fallback.currency);
  const quantity =
    body?.quantity !== undefined
      ? parseQuantity(body.quantity, null)
      : parseQuantity(undefined, fallback.quantity);

  return { title, description, priceTenge, type, currency, quantity };
}

/** No photo → "" (the storefront draws a neutral placeholder); never guess a stock picture by title. */
function resolveImage({ uploadedPath, providedImage }) {
  if (uploadedPath) return uploadedPath;
  const value = String(providedImage || "").trim();
  return value.startsWith("/uploads/") ? value : "";
}

const PROTECTED_UPLOADS = new Set([
  "crown.jpg",
  "veneers.jpg",
  "implant.jpg",
  "checkup.jpg",
]);

function maybeDeleteUpload(imagePath) {
  const value = String(imagePath || "").trim();
  if (!value.startsWith("/uploads/")) return;
  const fileName = path.basename(value);
  if (!fileName || PROTECTED_UPLOADS.has(fileName)) return;
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    return;
  }
  const fullPath = path.join(UPLOAD_DIR, fileName);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch {
    // ignore cleanup errors
  }
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function storeErrorStatus(error) {
  if (error?.code === "TOO_MANY_OPEN") return 429;
  if (error?.code === "STOCK_CHANGED") return 409;
  return 400;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const token = bearer || req.cookies.admin_token || "";

  if (!store.isSessionValid(token)) {
    return res.status(401).json({ error: "Нужна авторизация" });
  }
  next();
}

function getAuthToken(req) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  return bearer || req.cookies.admin_token || "";
}

const ella = createElla({ readServices });

const ELLA_PUBLIC_ERRORS = {
  bad_request: "Напишите сообщение или прикрепите файл.",
  timeout: "ELLA отвечает слишком долго. Попробуйте ещё раз или напишите врачу в WhatsApp.",
  internal: "ELLA временно недоступна. Напишите врачу в WhatsApp — он ответит сам.",
};

function companyRequisitesMissing() {
  return /^0+$/.test(company.iinBin) || /^KZ0+$/.test(company.iban);
}

app.get("/api/services", (_req, res) => {
  res.json(readServices());
});

app.get("/api/ella/status", (_req, res) => {
  res.json(ella.status());
});

app.post("/api/ella/chat", limitElla, (req, res) => {
  ellaUpload.array("files", ELLA_LIMITS.maxFiles)(req, res, async (err) => {
    if (err) return sendUploadError(req, res, err, ELLA_LIMITS);

    const clientGone = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) clientGone.abort();
    });

    try {
      const message = String(req.body?.message || "").trim();
      let history = [];
      try {
        const rawHistory = req.body?.history;
        history = typeof rawHistory === "string" ? JSON.parse(rawHistory || "[]") : rawHistory;
      } catch {
        history = [];
      }
      if (!Array.isArray(history)) history = [];

      const files = Array.isArray(req.files) ? req.files : [];
      const result = await ella.chat({ message, history, files, signal: clientGone.signal });
      res.json(result);
    } catch (error) {
      const isElla = error instanceof EllaError || error?.name === "EllaError";
      const code = isElla ? error.code : "internal";
      if (code === "cancelled") {
        logger.info("ella.chat cancelled: client disconnected", logger.requestMeta(req));
        return;
      }
      if (code !== "bad_request") {
        logger.error("ella.chat", { ...logger.requestMeta(req), code, error });
      }
      res.status(isElla ? error.status || 500 : 500).json({
        error: ELLA_PUBLIC_ERRORS[code] || ELLA_PUBLIC_ERRORS.internal,
        code,
        requestId: req.id,
      });
    }
  });
});

app.post("/api/login", limitLogin, (req, res) => {
  const password = String(req.body?.password || "");
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Неверный пароль" });
  }

  const token = createToken();
  store.createSession(token, Date.now());
  res.cookie("admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const token = getAuthToken(req);
  if (token) store.deleteSession(token);
  res.clearCookie("admin_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
  });
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const token = getAuthToken(req);
  res.json({ authenticated: store.isSessionValid(token) });
});

app.post("/api/services", requireAuth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return sendUploadError(req, res, err, PHOTO_LIMITS);

    const { title, description, priceTenge, type, currency, quantity } =
      parseItemFields(req.body);
    const image = resolveImage({
      uploadedPath: req.file ? `/uploads/${req.file.filename}` : "",
      providedImage: req.body?.image,
    });

    if (!title || priceTenge === null) {
      if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
      return res
        .status(400)
        .json({ error: !title ? "Укажите название" : "Укажите цену" });
    }

    try {
      const item = store.insertService({
        id: crypto.randomUUID(),
        title,
        description,
        priceTenge,
        type,
        currency,
        quantity,
        image,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(item);
    } catch (error) {
      if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
      serverError(req, res, error, "Не удалось сохранить позицию");
    }
  });
});

app.put("/api/services/:id", requireAuth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return sendUploadError(req, res, err, PHOTO_LIMITS);

    try {
      const current = store.getServiceById(req.params.id);
      if (!current) {
        if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
        return res.status(404).json({ error: "Не найдено" });
      }

      const { title, description, priceTenge, type, currency, quantity } =
        parseItemFields(req.body, current);

      if (!title) {
        if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({ error: "Укажите название" });
      }
      if (priceTenge === null) {
        if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
        return res.status(400).json({ error: "Укажите цену" });
      }

      const previousImage = current.image || "";
      // Field absent → keep the photo; "" → admin removed it; other non-/uploads/ values are ignored.
      let image = previousImage;
      if (req.file) {
        image = `/uploads/${req.file.filename}`;
      } else if (typeof req.body?.image === "string") {
        const value = req.body.image.trim();
        if (value === "" || value.startsWith("/uploads/")) image = value;
      }

      const expectedQuantity =
        req.body?.quantityExpected === undefined
          ? undefined
          : parseQuantity(req.body.quantityExpected, null);

      const item = store.updateService(
        req.params.id,
        {
          title,
          description,
          priceTenge,
          type,
          currency,
          quantity,
          image,
          updatedAt: new Date().toISOString(),
        },
        { expectedQuantity }
      );
      if (!item) {
        if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
        return res.status(404).json({ error: "Не найдено" });
      }
      if (req.file && previousImage && previousImage !== image) {
        maybeDeleteUpload(previousImage);
      }
      res.json(item);
    } catch (error) {
      if (req.file) maybeDeleteUpload(`/uploads/${req.file.filename}`);
      if (error instanceof store.StoreError || error?.name === "StoreError") {
        return res.status(storeErrorStatus(error)).json({ error: error.message });
      }
      serverError(req, res, error, "Не удалось обновить позицию");
    }
  });
});

app.delete("/api/services/:id", requireAuth, (req, res) => {
  try {
    const deleted = store.deleteService(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Не найдено" });
    }
    maybeDeleteUpload(deleted.image);
    res.json({ ok: true });
  } catch (error) {
    serverError(req, res, error, "Не удалось удалить позицию");
  }
});

app.post("/api/orders", limitOrders, (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) {
    return res.status(400).json({ error: "Корзина пуста" });
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    return res.status(400).json({
      error: `Слишком много позиций (макс. ${MAX_ORDER_LINES}).`,
    });
  }

  const customerName = String(req.body?.customerName || "").trim().slice(0, 120);
  const { phone: customerPhone, digits: phoneDigits } = normalizePhone(
    req.body?.customerPhone
  );

  if (!customerName) {
    return res.status(400).json({ error: "Укажите имя" });
  }
  if (!isPlausiblePhone(phoneDigits)) {
    return res.status(400).json({ error: "Укажите корректный номер телефона" });
  }

  const sourceRaw = String(req.body?.source || "cart").trim().toLowerCase();
  const source = ORDER_SOURCES.has(sourceRaw) ? sourceRaw : "cart";
  const channelRaw = String(req.body?.channel || "whatsapp").trim().toLowerCase();
  const channel = ORDER_CHANNELS.has(channelRaw) ? channelRaw : "whatsapp";
  const customerNote = String(req.body?.customerNote || "").trim().slice(0, 500);
  const idempotencyKey = String(
    req.get("Idempotency-Key") || req.body?.idempotencyKey || ""
  )
    .trim()
    .slice(0, 80);

  try {
    const catalog = readServices();
    const { items, missing, outOfStock, tooMany, tooManyUnits } =
      normalizeOrderItems(rawItems, catalog);

    if (tooMany) {
      return res.status(400).json({
        error: `Слишком много позиций (макс. ${MAX_ORDER_LINES}).`,
      });
    }
    if (tooManyUnits) {
      return res.status(400).json({
        error: `Можно заказать не больше ${MAX_QTY_PER_ITEM} шт. одной позиции. Для оптового заказа напишите нам.`,
      });
    }
    if (missing) {
      return res.status(400).json({
        error: "Одна из позиций больше недоступна. Обновите корзину.",
      });
    }
    if (outOfStock) {
      return res.status(400).json({
        error: "Недостаточно остатка по одной из позиций. Обновите корзину.",
      });
    }
    if (!items.length) {
      return res.status(400).json({ error: "Корзина пуста" });
    }

    const totalTenge = items.reduce(
      (sum, item) => sum + item.priceTenge * item.qty,
      0
    );
    const message = buildOrderMessage(items, customerName, customerPhone);

    const result = store.createOrder({
      maxOpenPerPhone: MAX_OPEN_ORDERS_PER_PHONE,
      phoneVariants: phoneVariants(phoneDigits),
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "new",
      source,
      channel,
      customerName,
      customerPhone,
      items,
      totalTenge,
      message,
      whatsappMessage: message,
      customerNote,
      idempotencyKey,
    });

    res.status(result.reused ? 200 : 201).json(result.order);
  } catch (error) {
    if (error instanceof store.StoreError || error?.name === "StoreError") {
      return res.status(storeErrorStatus(error)).json({ error: error.message });
    }
    serverError(req, res, error, "Не удалось сохранить заявку");
  }
});

app.get("/api/orders/:id/invoice.pdf", requireAuth, async (req, res) => {
  if (companyRequisitesMissing()) {
    return res.status(503).json({
      error:
        "Счёт не сформирован: не заполнены реквизиты продавца (COMPANY_IIN_BIN и COMPANY_IBAN в .env).",
    });
  }
  try {
    const order = store.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Заказ не найден" });
    }

    const { buffer, filename } = await buildInvoicePdf(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    return res.send(buffer);
  } catch (error) {
    return serverError(req, res, error, "Не удалось сформировать счёт");
  }
});
app.get("/api/orders", requireAuth, (req, res) => {
  try {
    res.json(store.listOrders());
  } catch (error) {
    serverError(req, res, error, "Не удалось загрузить заказы");
  }
});

app.patch("/api/orders/:id", requireAuth, (req, res) => {
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (!ORDER_STATUSES.has(status)) {
    return res.status(400).json({
      error: "Статус: new, contacted, done или cancelled",
    });
  }

  try {
    const order = store.updateOrderStatus(req.params.id, status);
    if (!order) {
      return res.status(404).json({ error: "Заказ не найден" });
    }
    res.json(order);
  } catch (error) {
    if (error instanceof store.StoreError || error?.name === "StoreError") {
      return res.status(storeErrorStatus(error)).json({ error: error.message });
    }
    serverError(req, res, error, "Не удалось обновить заказ");
  }
});

app.delete("/api/orders/:id", requireAuth, (req, res) => {
  try {
    if (!store.deleteOrder(req.params.id)) {
      return res.status(404).json({ error: "Заказ не найден" });
    }
    res.json({ ok: true });
  } catch (error) {
    serverError(req, res, error, "Не удалось удалить заказ");
  }
});

app.get("/api/health", (_req, res) => {
  try {
    const stats = store.getStats();
    res.json({
      ok: true,
      storage: "sqlite",
      journalMode: stats.journalMode,
      services: stats.services,
      orders: stats.orders,
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "db unavailable" });
  }
});

const catalogPdfCache = new Map();

/** Rebuilds only when the catalog or the date (printed in the PDF) changes. */
function getCatalogPdf(typeFilter) {
  const services = readServices();
  const version = crypto
    .createHash("sha1")
    .update(new Date().toDateString())
    .update(JSON.stringify(services))
    .digest("hex");
  const cached = catalogPdfCache.get(typeFilter);
  if (cached && cached.version === version) return cached.promise;

  const promise = buildCatalogPdf(services, { typeFilter, uploadsDir: UPLOAD_DIR });
  catalogPdfCache.set(typeFilter, { version, promise });
  promise.catch(() => {
    if (catalogPdfCache.get(typeFilter)?.promise === promise) {
      catalogPdfCache.delete(typeFilter);
    }
  });
  return promise;
}

app.get("/api/shop-config", (_req, res) => {
  res.json({ ratesToKzt: fx.getRates(), fx: fx.getInfo(), maxQtyPerItem: MAX_QTY_PER_ITEM });
});

const clip = (value, max) => String(value ?? "").slice(0, max);

app.post("/api/client-errors", limitClientErrors, (req, res) => {
  const body = req.body || {};
  logger.error("client error", {
    ...logger.requestMeta(req),
    source: clip(body.source, 40),
    page: clip(body.page, 300),
    userAgent: clip(req.get("user-agent"), 300),
    clientMessage: clip(body.message, 500),
    stack: clip(body.stack, 4000),
    componentStack: clip(body.componentStack, 2000),
  });
  res.status(204).end();
});

app.get("/api/export/catalog.pdf", limitPdf, async (req, res) => {
  try {
    const type = String(req.query?.type || "all")
      .trim()
      .toLowerCase();
    const typeFilter =
      type === "product" || type === "service" || type === "all" ? type : "all";

    const { buffer, filename } = await getCatalogPdf(typeFilter);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    return res.send(buffer);
  } catch (error) {
    return serverError(req, res, error, "Не удалось сформировать PDF-каталог");
  }
});

const escapeHtmlAttr = (value) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CONTACTS_META = `<meta name="site-contacts" content="${escapeHtmlAttr(JSON.stringify(contacts))}">`;
let indexCache = { mtimeMs: 0, html: "" };

/** Re-reads index.html only after a rebuild (mtime change). */
function renderIndex() {
  const { mtimeMs } = fs.statSync(CLIENT_INDEX);
  if (mtimeMs !== indexCache.mtimeMs) {
    const html = fs.readFileSync(CLIENT_INDEX, "utf8").replace("</head>", `  ${CONTACTS_META}\n  </head>`);
    indexCache = { mtimeMs, html };
  }
  return indexCache.html;
}

function sendSpa(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api")) return next();
  if (!fs.existsSync(CLIENT_INDEX)) {
    return res
      .status(503)
      .type("text")
      .send("Фронтенд не собран. Запустите: npm run build");
  }
  try {
    return res.type("html").set("Cache-Control", "no-cache").send(renderIndex());
  } catch (error) {
    return next(error);
  }
}

app.get("/admin", sendSpa);
app.get("*", sendSpa);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const isJson =
    err.type === "entity.parse.failed" ||
    (err instanceof SyntaxError &&
      Number(err.status) === 400 &&
      Object.prototype.hasOwnProperty.call(err, "body"));

  if (isJson) {
    return res.status(400).json({ error: "Некорректный запрос" });
  }

  const status = Number(err.status || err.statusCode) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  logger.error("unhandled route error", { ...logger.requestMeta(req), status: safeStatus, error: err });
  return res.status(safeStatus).json({
    error: safeStatus === 400 ? "Некорректный запрос" : "Внутренняя ошибка сервера",
    requestId: req.id,
  });
});

const server = app.listen(PORT, () => {
  console.log(`Сайт: http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
  console.log(`База данных: SQLite (data/app.db)`);
  if (db.migration && !db.migration.skipped) {
    console.log(
      `Миграция JSON → SQLite: услуг ${db.migration.services}, заказов ${db.migration.orders}`
    );
  }
  console.log(`Пароль админки берётся из файла .env (ADMIN_PASSWORD)`);
  const ellaStatus = ella.status();
  console.log(
    ellaStatus.ready
      ? `ELLA AI: подключена (${ellaStatus.model})`
      : "ELLA AI: ключ OPENAI_API_KEY не найден в .env"
  );
  if (!fs.existsSync(CLIENT_DIST)) {
    console.log("React-сборка не найдена (client/dist). Для prod: npm run build");
    console.log("Для разработки: npm run dev (API :3000 + Vite :5173)");
  }
  if (companyRequisitesMissing()) {
    console.warn(
      "Внимание: не заполнены реквизиты продавца — счета не будут формироваться. Заполните COMPANY_IIN_BIN и COMPANY_IBAN в .env"
    );
  }
  if (!app.get("trust proxy")) {
    console.log(
      "TRUST_PROXY не задан: IP клиента берётся из соединения. За nginx/Cloudflare задайте TRUST_PROXY=1"
    );
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error(`Порт ${PORT} уже занят другим процессом. Освободите его или задайте PORT в .env`, {
      code: error.code,
    });
  } else {
    logger.error("server", { error });
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`Получен ${signal}, завершаем работу…`);
  server.close(() => {
    runSafely("shutdown:db", store.closeDatabase);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
