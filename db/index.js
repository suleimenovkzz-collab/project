const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "app.db");
const SERVICES_JSON = path.join(__dirname, "..", "data", "services.json");
const ORDERS_JSON = path.join(__dirname, "..", "data", "orders.json");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BUSY_TIMEOUT_MS = 5000;
const OPEN_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

let db = null;

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

function mapService(row) {
  if (!row) return null;
  const item = {
    id: row.id,
    title: row.title,
    description: row.description || "",
    priceTenge: Number(row.price_tenge) || 0,
    currency: row.currency || "KZT",
    type: row.type || "service",
    image: row.image || "",
    createdAt: row.created_at,
  };
  if (row.quantity !== null && row.quantity !== undefined) {
    item.quantity = Number(row.quantity);
  } else {
    item.quantity = null;
  }
  if (row.updated_at) item.updatedAt = row.updated_at;
  return item;
}

function mapOrder(row, items = []) {
  if (!row) return null;
  const order = {
    id: row.id,
    createdAt: row.created_at,
    status: row.status || "new",
    source: row.source || "cart",
    channel: row.channel || "whatsapp",
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    items: items.map((line) => ({
      id: line.service_id,
      title: line.title,
      qty: Number(line.qty) || 1,
      priceTenge: Number(line.price_tenge) || 0,
    })),
    totalTenge: Number(row.total_tenge) || 0,
    message: row.message || "",
    whatsappMessage: row.whatsapp_message || row.message || "",
    customerNote: row.customer_note || "",
  };
  if (row.updated_at) order.updatedAt = row.updated_at;
  if (row.idempotency_key) order.idempotencyKey = row.idempotency_key;
  return order;
}

function ensureSchema(database) {
  database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("temp_store = MEMORY");

  database.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_tenge REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'KZT',
      type TEXT NOT NULL DEFAULT 'service',
      quantity INTEGER,
      image TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      CHECK (quantity IS NULL OR quantity >= 0)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT 'cart',
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      total_tenge REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      whatsapp_message TEXT NOT NULL DEFAULT '',
      customer_note TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      stock_held INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      title TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty >= 1),
      price_tenge REAL NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_service_id ON order_items(service_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_services_created_at ON services(created_at);
    CREATE INDEX IF NOT EXISTS idx_services_type ON services(type);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_sessions_created_at ON admin_sessions(created_at);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  migrateColumns(database);
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function migrateColumns(database) {
  const orderCols = tableColumns(database, "orders");
  if (!orderCols.includes("idempotency_key")) {
    database.exec("ALTER TABLE orders ADD COLUMN idempotency_key TEXT");
  }
  if (!orderCols.includes("stock_held")) {
    database.exec(
      "ALTER TABLE orders ADD COLUMN stock_held INTEGER NOT NULL DEFAULT 1"
    );
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
    ON orders(idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key != ''
  `);
}

function archiveJson(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = `${filePath}.migrated.${stamp}`;
  try {
    fs.renameSync(filePath, archived);
  } catch {
    try {
      fs.copyFileSync(filePath, archived);
      fs.unlinkSync(filePath);
    } catch {
      // keep original if archive fails
    }
  }
}

function readJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function migrateFromJson(database) {
  const serviceCount = database.prepare("SELECT COUNT(*) AS n FROM services").get().n;
  const orderCount = database.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
  const migrated = database.prepare("SELECT value FROM meta WHERE key = ?").get("json_migrated");

  if (migrated?.value === "1" && serviceCount > 0) {
    return { services: 0, orders: 0, skipped: true };
  }

  let importedServices = 0;
  let importedOrders = 0;

  const insertService = database.prepare(`
    INSERT OR IGNORE INTO services (
      id, title, description, price_tenge, currency, type, quantity, image, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @price_tenge, @currency, @type, @quantity, @image, @created_at, @updated_at
    )
  `);

  const insertOrder = database.prepare(`
    INSERT OR IGNORE INTO orders (
      id, created_at, updated_at, status, source, channel,
      customer_name, customer_phone, total_tenge, message, whatsapp_message, customer_note,
      stock_held
    ) VALUES (
      @id, @created_at, @updated_at, @status, @source, @channel,
      @customer_name, @customer_phone, @total_tenge, @message, @whatsapp_message, @customer_note,
      @stock_held
    )
  `);

  const insertItem = database.prepare(`
    INSERT INTO order_items (order_id, service_id, title, qty, price_tenge, sort_index)
    VALUES (@order_id, @service_id, @title, @qty, @price_tenge, @sort_index)
  `);

  const importAll = database.transaction(() => {
    if (serviceCount === 0) {
      const services = readJsonArray(SERVICES_JSON);
      for (const item of services) {
        if (!item?.id) continue;
        const qty =
          item.quantity === undefined || item.quantity === null || item.quantity === ""
            ? null
            : Number(item.quantity);
        insertService.run({
          id: String(item.id),
          title: String(item.title || "").trim() || "Без названия",
          description: String(item.description || ""),
          price_tenge: Number(item.priceTenge) || 0,
          currency: String(item.currency || "KZT").toUpperCase(),
          type: item.type === "product" ? "product" : "service",
          quantity: Number.isFinite(qty) ? qty : null,
          image: String(item.image || ""),
          created_at: item.createdAt || new Date().toISOString(),
          updated_at: item.updatedAt || null,
        });
        importedServices += 1;
      }
    }

    if (orderCount === 0) {
      const orders = readJsonArray(ORDERS_JSON);
      for (const order of orders) {
        if (!order?.id) continue;
        const message = String(order.message || order.whatsappMessage || "");
        const status = order.status || "new";
        insertOrder.run({
          id: String(order.id),
          created_at: order.createdAt || new Date().toISOString(),
          updated_at: order.updatedAt || null,
          status,
          source: order.source || "cart",
          channel: order.channel || "whatsapp",
          customer_name: String(order.customerName || "").trim() || "—",
          customer_phone: String(order.customerPhone || "").trim() || "—",
          total_tenge: Number(order.totalTenge) || 0,
          message,
          whatsapp_message: String(order.whatsappMessage || message),
          customer_note: String(order.customerNote || ""),
          stock_held: status === "cancelled" ? 0 : 1,
        });

        const items = Array.isArray(order.items) ? order.items : [];
        items.forEach((line, index) => {
          insertItem.run({
            order_id: String(order.id),
            service_id: String(line.id || ""),
            title: String(line.title || ""),
            qty: Math.max(1, Number(line.qty) || 1),
            price_tenge: Number(line.priceTenge) || 0,
            sort_index: index,
          });
        });
        importedOrders += 1;
      }
    }

    database
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('json_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run();
  });

  importAll();

  if (importedServices > 0) archiveJson(SERVICES_JSON);
  if (importedOrders > 0) archiveJson(ORDERS_JSON);

  return { services: importedServices, orders: importedOrders, skipped: false };
}

function openDatabase(dbPath = process.env.SQLITE_PATH || DEFAULT_DB_PATH) {
  if (db) return db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  ensureSchema(db);

  const migration = migrateFromJson(db);
  db.migration = migration;

  return db;
}

function getDb() {
  if (!db) openDatabase();
  return db;
}

function loadOrderItems(orderId) {
  return getDb()
    .prepare(
      `SELECT * FROM order_items
       WHERE order_id = ?
       ORDER BY sort_index ASC, id ASC`
    )
    .all(String(orderId));
}

function loadAllOrderItemsGrouped() {
  const rows = getDb()
    .prepare(
      `SELECT * FROM order_items
       ORDER BY order_id ASC, sort_index ASC, id ASC`
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.order_id);
    if (list) list.push(row);
    else map.set(row.order_id, [row]);
  }
  return map;
}

function getOrderById(id) {
  const row = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(String(id));
  if (!row) return null;
  return mapOrder(row, loadOrderItems(id));
}

function getOrderByIdempotencyKey(key) {
  if (!key) return null;
  const row = getDb()
    .prepare("SELECT * FROM orders WHERE idempotency_key = ?")
    .get(String(key));
  if (!row) return null;
  return mapOrder(row, loadOrderItems(row.id));
}

/** Reserve stock inside an open transaction. Throws StoreError on conflict. */
function reserveStock(orderItems) {
  const select = getDb().prepare("SELECT id, quantity FROM services WHERE id = ?");
  const update = getDb().prepare(
    `UPDATE services
     SET quantity = quantity - @qty, updated_at = @updated_at
     WHERE id = @id AND quantity IS NOT NULL AND quantity >= @qty`
  );
  const now = new Date().toISOString();

  for (const item of orderItems) {
    const row = select.get(String(item.id));
    if (!row) {
      throw new StoreError(
        "MISSING",
        "Одна из позиций больше недоступна. Обновите корзину."
      );
    }
    if (row.quantity === null || row.quantity === undefined) continue;
    const result = update.run({
      id: String(item.id),
      qty: item.qty,
      updated_at: now,
    });
    if (result.changes === 0) {
      throw new StoreError(
        "OUT_OF_STOCK",
        "Недостаточно остатка по одной из позиций. Обновите корзину."
      );
    }
  }
}

function restoreStock(orderItems) {
  const update = getDb().prepare(
    `UPDATE services
     SET quantity = quantity + @qty, updated_at = @updated_at
     WHERE id = @id AND quantity IS NOT NULL`
  );
  const now = new Date().toISOString();
  for (const item of orderItems) {
    update.run({
      id: String(item.id),
      qty: item.qty,
      updated_at: now,
    });
  }
}

/* -------------------- services -------------------- */

function listServices() {
  const rows = getDb()
    .prepare(
      `SELECT * FROM services
       ORDER BY datetime(created_at) ASC, title ASC`
    )
    .all();
  return rows.map(mapService);
}

function getServiceById(id) {
  const row = getDb().prepare("SELECT * FROM services WHERE id = ?").get(String(id));
  return mapService(row);
}

function insertService(item) {
  getDb()
    .prepare(
      `INSERT INTO services (
        id, title, description, price_tenge, currency, type, quantity, image, created_at, updated_at
      ) VALUES (
        @id, @title, @description, @price_tenge, @currency, @type, @quantity, @image, @created_at, @updated_at
      )`
    )
    .run({
      id: item.id,
      title: item.title,
      description: item.description || "",
      price_tenge: item.priceTenge,
      currency: item.currency || "KZT",
      type: item.type || "service",
      quantity: item.quantity === undefined ? null : item.quantity,
      image: item.image || "",
      created_at: item.createdAt,
      updated_at: item.updatedAt || null,
    });
  return getServiceById(item.id);
}

/**
 * expectedQuantity (optional) — quantity the admin saw when opening the form.
 * Unchanged field keeps the live stock; a changed field is rejected if stock
 * moved meanwhile (orders reserve stock concurrently).
 */
function updateService(id, item, { expectedQuantity } = {}) {
  const run = getDb().transaction(() => {
    const row = getDb()
      .prepare("SELECT quantity FROM services WHERE id = ?")
      .get(String(id));
    if (!row) return null;

    let quantity = item.quantity === undefined ? null : item.quantity;
    if (expectedQuantity !== undefined) {
      const live = row.quantity === undefined ? null : row.quantity;
      if (quantity === expectedQuantity) {
        quantity = live;
      } else if (live !== expectedQuantity) {
        throw new StoreError(
          "STOCK_CHANGED",
          `Остаток изменился, пока вы редактировали (сейчас: ${
            live === null ? "безлимит" : live
          }). Закройте форму и откройте товар заново.`
        );
      }
    }

    getDb()
      .prepare(
        `UPDATE services SET
          title = @title,
          description = @description,
          price_tenge = @price_tenge,
          currency = @currency,
          type = @type,
          quantity = @quantity,
          image = @image,
          updated_at = @updated_at
        WHERE id = @id`
      )
      .run({
        id: String(id),
        title: item.title,
        description: item.description || "",
        price_tenge: item.priceTenge,
        currency: item.currency || "KZT",
        type: item.type || "service",
        quantity,
        image: item.image || "",
        updated_at: item.updatedAt || new Date().toISOString(),
      });
    return getServiceById(id);
  });

  return run.immediate();
}

function deleteService(id) {
  const existing = getServiceById(id);
  if (!existing) return null;
  getDb().prepare("DELETE FROM services WHERE id = ?").run(String(id));
  return existing;
}

/* -------------------- orders -------------------- */

function listOrders() {
  const rows = getDb()
    .prepare(
      `SELECT * FROM orders
       ORDER BY datetime(created_at) DESC`
    )
    .all();
  const itemsByOrder = loadAllOrderItemsGrouped();
  return rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) || []));
}

/**
 * Creates order + items and reserves stock in one IMMEDIATE transaction.
 * Returns { order, reused }.
 */
function createOrder(order) {
  const insertOrder = getDb().prepare(`
    INSERT INTO orders (
      id, created_at, updated_at, status, source, channel,
      customer_name, customer_phone, total_tenge, message, whatsapp_message, customer_note,
      idempotency_key, stock_held
    ) VALUES (
      @id, @created_at, @updated_at, @status, @source, @channel,
      @customer_name, @customer_phone, @total_tenge, @message, @whatsapp_message, @customer_note,
      @idempotency_key, 1
    )
  `);
  const insertItem = getDb().prepare(`
    INSERT INTO order_items (order_id, service_id, title, qty, price_tenge, sort_index)
    VALUES (@order_id, @service_id, @title, @qty, @price_tenge, @sort_index)
  `);

  const run = getDb().transaction((payload) => {
    const key = String(payload.idempotencyKey || "").trim().slice(0, 80);
    if (key) {
      const existing = getOrderByIdempotencyKey(key);
      if (existing) return { order: existing, reused: true };
    }

    const phoneVariants = Array.isArray(payload.phoneVariants)
      ? payload.phoneVariants.filter(Boolean)
      : [];
    if (payload.maxOpenPerPhone > 0 && phoneVariants.length) {
      const placeholders = phoneVariants.map(() => "?").join(", ");
      const cutoff = new Date(Date.now() - OPEN_ORDER_WINDOW_MS).toISOString();
      const open = getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM orders
           WHERE status = 'new'
             AND created_at >= ?
             AND REPLACE(customer_phone, '+', '') IN (${placeholders})`
        )
        .get(cutoff, ...phoneVariants).n;
      if (open >= payload.maxOpenPerPhone) {
        throw new StoreError(
          "TOO_MANY_OPEN",
          "По этому номеру уже есть необработанные заявки. Мы скоро свяжемся с вами."
        );
      }
    }

    try {
      insertOrder.run({
        id: payload.id,
        created_at: payload.createdAt,
        updated_at: null,
        status: payload.status || "new",
        source: payload.source,
        channel: payload.channel,
        customer_name: payload.customerName,
        customer_phone: payload.customerPhone,
        total_tenge: payload.totalTenge,
        message: payload.message || "",
        whatsapp_message: payload.whatsappMessage || payload.message || "",
        customer_note: payload.customerNote || "",
        idempotency_key: key || null,
      });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE") && key) {
        const existing = getOrderByIdempotencyKey(key);
        if (existing) return { order: existing, reused: true };
      }
      throw error;
    }

    // Reserve after claiming idempotency row so retries never double-decrement.
    reserveStock(payload.items || []);

    (payload.items || []).forEach((line, index) => {
      insertItem.run({
        order_id: payload.id,
        service_id: String(line.id),
        title: line.title,
        qty: line.qty,
        price_tenge: line.priceTenge,
        sort_index: index,
      });
    });

    return { order: getOrderById(payload.id), reused: false };
  });

  return run.immediate(order);
}

function updateOrderStatus(id, status) {
  const run = getDb().transaction(() => {
    const row = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(String(id));
    if (!row) return null;

    const prev = row.status || "new";
    if (prev === status) {
      return mapOrder(row, loadOrderItems(id));
    }

    const items = loadOrderItems(id).map((line) => ({
      id: line.service_id,
      qty: Number(line.qty) || 1,
    }));
    let stockHeld = Number(row.stock_held) === 1 ? 1 : 0;

    if (prev !== "cancelled" && status === "cancelled" && stockHeld === 1) {
      restoreStock(items);
      stockHeld = 0;
    } else if (prev === "cancelled" && status !== "cancelled" && stockHeld === 0) {
      reserveStock(items);
      stockHeld = 1;
    }

    const updatedAt = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE orders
         SET status = ?, updated_at = ?, stock_held = ?
         WHERE id = ?`
      )
      .run(status, updatedAt, stockHeld, String(id));

    return getOrderById(id);
  });

  return run.immediate();
}

function deleteOrder(id) {
  const run = getDb().transaction(() => {
    const row = getDb().prepare("SELECT * FROM orders WHERE id = ?").get(String(id));
    if (!row) return false;

    // A completed order means the goods are gone; only open orders release stock.
    if (Number(row.stock_held) === 1 && row.status !== "done") {
      const items = loadOrderItems(id).map((line) => ({
        id: line.service_id,
        qty: Number(line.qty) || 1,
      }));
      restoreStock(items);
    }

    getDb().prepare("DELETE FROM orders WHERE id = ?").run(String(id));
    return true;
  });

  return run.immediate();
}

/* -------------------- sessions -------------------- */

function createSession(token, createdAt = Date.now()) {
  getDb()
    .prepare(
      `INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)
       ON CONFLICT(token) DO UPDATE SET created_at = excluded.created_at`
    )
    .run(token, createdAt);
}

function deleteSession(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
}

function isSessionValid(token, ttlMs = SESSION_TTL_MS) {
  if (!token) return false;
  const row = getDb()
    .prepare("SELECT created_at FROM admin_sessions WHERE token = ?")
    .get(token);
  if (!row) return false;
  if (Date.now() - Number(row.created_at) > ttlMs) {
    deleteSession(token);
    return false;
  }
  return true;
}

function pruneSessions(ttlMs = SESSION_TTL_MS) {
  const cutoff = Date.now() - ttlMs;
  getDb().prepare("DELETE FROM admin_sessions WHERE created_at < ?").run(cutoff);
}

function getStats() {
  const d = getDb();
  return {
    services: d.prepare("SELECT COUNT(*) AS n FROM services").get().n,
    orders: d.prepare("SELECT COUNT(*) AS n FROM orders").get().n,
    sessions: d.prepare("SELECT COUNT(*) AS n FROM admin_sessions").get().n,
    journalMode: d.pragma("journal_mode", { simple: true }),
  };
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  SESSION_TTL_MS,
  StoreError,
  openDatabase,
  getDb,
  closeDatabase,
  listServices,
  getServiceById,
  insertService,
  updateService,
  deleteService,
  listOrders,
  getOrderById,
  getOrderByIdempotencyKey,
  createOrder,
  updateOrderStatus,
  deleteOrder,
  createSession,
  deleteSession,
  isSessionValid,
  pruneSessions,
  getStats,
};
