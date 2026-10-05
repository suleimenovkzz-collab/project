/**
 * Регрессионная проверка заказов/остатков/безопасности на временной БД.
 * Запуск: npm run verify:shop (рабочая data/app.db не затрагивается).
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PROJECT = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-shop-"));
const results = [];
const check = (name, ok, details) => results.push({ name, ok, details });

async function startServer(port, extraEnv) {
  const dbPath = path.join(dir, `verify-${port}.db`);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT,
    env: {
      ...process.env,
      NODE_ENV: "",
      TRUST_PROXY: "",
      PORT: String(port),
      SQLITE_PATH: dbPath,
      ADMIN_PASSWORD: "audit-pass-123456",
      OPENAI_API_KEY: "",
      FX_AUTO_UPDATE: "0",
      COMPANY_IIN_BIN: "",
      COMPANY_IBAN: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base + "/api/health");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return {
    base,
    getLog: () => log,
    stop: () => new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill();
    }),
  };
}

const randPhone = () => "+7700" + String(Math.floor(1e6 + Math.random() * 8e6));

async function quietly(fn) {
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
}

async function unitChecks() {
  const rates = require("../lib/rates");
  const nbrkXml = `<rates><item><title>USD</title><description>448.83</description><quant>1</quant></item>
    <item><title>EUR</title><description>505.1</description><quant>1</quant></item>
    <item><title>RUB</title><description>53.6</description><quant>10</quant></item>
    <item><title>AUD</title><description>310.5</description><quant>1</quant></item></rates>`;
  const parsed = rates.parseNbrkXml(nbrkXml);
  check("Курсы НБ РК: парсинг с учётом номинала", parsed.USD === 448.83 && parsed.EUR === 505.1 && parsed.RUB === 5.36, JSON.stringify(parsed));
  const er = rates.parseOpenErApi({ result: "success", rates: { KZT: 450, EUR: 0.9, RUB: 90 } });
  check("Курсы open.er-api: пересчёт через USD", er.USD === 450 && er.EUR === 500 && er.RUB === 5, JSON.stringify(er));
  check("Абсурдные курсы отбрасываются", !rates.isSane({ USD: 1, EUR: 500, RUB: 5 }) && !rates.isSane({ USD: 450, EUR: 500 }), "");

  const cacheFile = path.join(dir, "fx.json");
  const fakeFetch = (url) => url.includes("nationalbank")
    ? Promise.resolve(new Response("down", { status: 503 }))
    : Promise.resolve(Response.json({ result: "success", rates: { KZT: 450, EUR: 0.9, RUB: 90 } }));
  const fx1 = rates.createRatesService({ cacheFile, env: {}, fetchImpl: fakeFetch });
  await quietly(() => fx1.refresh());
  check("Курсы: при сбое НБ РК берётся запасной источник", fx1.getRates().USD === 450 && fx1.getInfo().source === "open.er-api", JSON.stringify(fx1.getInfo()));
  const fx2 = await quietly(() => rates.createRatesService({ cacheFile, env: { FX_USD_KZT: "470" }, fetchImpl: () => Promise.reject(new Error("offline")) }));
  await quietly(() => fx2.refresh());
  const r2 = fx2.getRates();
  check("Курсы: без интернета — сохранённые, ручной FX_* важнее", r2.USD === 470 && r2.EUR === 500 && fx2.getInfo().source === "cache:open.er-api", JSON.stringify(r2));

  const { chatCompletions } = require("../core/llm");
  const realFetch = global.fetch;
  // AbortSignal.timeout is unref'd; a fake fetch holds no socket, so without this Node would just exit.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    global.fetch = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    let t = Date.now();
    const hang = await chatCompletions({ apiKey: "k", model: "m", messages: [], deadline: Date.now() + 3500 }).catch((e) => e);
    const waited = Date.now() - t;
    check("ИИ: зависший OpenAI обрывается по общему дедлайну", hang.code === "timeout" && waited >= 3300 && waited < 4500, `код ${hang.code}, ${waited} мс (бюджет 3500)`);

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    t = Date.now();
    const gone = await chatCompletions({ apiKey: "k", model: "m", messages: [], signal: ac.signal }).catch((e) => e);
    check("ИИ: уход посетителя отменяет запрос к OpenAI", gone.code === "cancelled" && Date.now() - t < 1000, `код ${gone.code}, ${Date.now() - t} мс`);

    let calls = 0;
    global.fetch = () => { calls++; return Promise.resolve(Response.json({ error: { message: "busy" } }, { status: 503 })); };
    const noTime = await chatCompletions({ apiKey: "k", model: "m", messages: [], deadline: Date.now() + 3200 }).catch((e) => e);
    check("ИИ: повтор не запускается, если времени не осталось", noTime.code === "upstream" && calls === 1, `вызовов ${calls}`);
  } finally {
    global.fetch = realFetch;
    clearInterval(keepAlive);
  }
}

async function main() {
  await unitChecks();
  const srv = await startServer(3998, {
    TRUST_PROXY: "1",
    COMPANY_IIN_BIN: "900101300123",
    COMPANY_IBAN: "KZ86125KZT5004100100",
  });
  const B = srv.base;
  let ip = 1;
  const api = async (method, url, body, headers = {}) => {
    const res = await fetch(B + url, {
      method,
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.1.0.${ip++}`, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  };

  try {
    const login = await api("POST", "/api/login", { password: "audit-pass-123456" });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const auth = { Cookie: cookie };
    check("Вход: токен не отдаётся в JSON", login.status === 200 && !login.data.token, `ответ: ${JSON.stringify(login.data)}`);
    const me = await api("GET", "/api/me", null, auth);
    check("Вход: сессия работает через cookie", me.data.authenticated === true, `authenticated=${me.data.authenticated}`);

    const form = (f) => { const fd = new FormData(); for (const [k, v] of Object.entries(f)) fd.append(k, String(v)); return fd; };
    const create = async (f) => (await fetch(B + "/api/services", { method: "POST", headers: auth, body: form(f) })).json();
    const update = async (id, f) => { const r = await fetch(B + `/api/services/${id}`, { method: "PUT", headers: auth, body: form(f) }); return { status: r.status, data: await r.json() }; };
    const qtyOf = async (id) => (await api("GET", "/api/services")).data.find((s) => s.id === id)?.quantity;
    const order = (items, extra = {}) => api("POST", "/api/orders", { customerName: "Тест", customerPhone: randPhone(), items, ...extra });

    const photoForm = (blob, name) => { const fd = form({ title: "Фото", description: "d", priceTenge: 1, quantity: "" }); fd.append("image", blob, name); return fd; };
    const big = await fetch(B + "/api/services", { method: "POST", headers: auth, body: photoForm(new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }), "big.jpg") });
    const bigData = await big.json();
    check("Фото больше 5 МБ: понятная ошибка", big.status === 413 && /5 МБ/.test(bigData.error), `статус ${big.status}: ${bigData.error}`);
    const txt = await fetch(B + "/api/services", { method: "POST", headers: auth, body: photoForm(new Blob(["hello"], { type: "text/plain" }), "a.txt") });
    const txtData = await txt.json();
    check("Не картинка вместо фото: понятная ошибка", txt.status === 415 && /изображения/.test(txtData.error), `статус ${txt.status}: ${txtData.error}`);

    const p1 = await create({ title: "Щётка", description: "d", priceTenge: 1000, quantity: 10, type: "product" });
    const pImg = await create({ title: "Имплант Osstem", description: "d", priceTenge: 1000, quantity: "", type: "product" });
    check("Без фото товар не получает стоковую картинку", p1.image === "" && pImg.image === "", `щётка: «${p1.image}», имплант: «${pImg.image}»`);
    const keep = await update(pImg.id, { title: "Имплант Osstem", description: "d", priceTenge: 1000, quantity: "", type: "product", image: "/uploads/implant.jpg" });
    const keep2 = await update(pImg.id, { title: "Имплант Straumann", description: "d", priceTenge: 1000, quantity: "", type: "product" });
    const cleared = await update(pImg.id, { title: "Имплант Straumann", description: "d", priceTenge: 1000, quantity: "", type: "product", image: "" });
    check(
      "Фото: без поля сохраняется, пустое значение удаляет",
      keep.data.image === "/uploads/implant.jpg" && keep2.data.image === "/uploads/implant.jpg" && cleared.data.image === "",
      `${keep.data.image} → ${keep2.data.image} → «${cleared.data.image}»`
    );
    const o1 = await order([{ id: p1.id, qty: 3 }]);
    await api("PATCH", `/api/orders/${o1.data.id}`, { status: "done" }, auth);
    await api("DELETE", `/api/orders/${o1.data.id}`, null, auth);
    const q1 = await qtyOf(p1.id);
    check("Удаление закрытого заказа не возвращает товар", q1 === 7, `остаток после удаления: ${q1} (ожидалось 7)`);
    const o1b = await order([{ id: p1.id, qty: 2 }]);
    await api("DELETE", `/api/orders/${o1b.data.id}`, null, auth);
    const q1b = await qtyOf(p1.id);
    check("Удаление нового заказа по-прежнему возвращает товар", q1b === 7, `остаток: ${q1b} (ожидалось 7)`);

    const p2 = await create({ title: "Паста", description: "d", priceTenge: 2000, quantity: 10, type: "product" });
    await order([{ id: p2.id, qty: 4 }]);
    const u2 = await update(p2.id, { title: "Паста", description: "новое", priceTenge: 2000, quantity: 10, quantityExpected: 10, type: "product" });
    check("Правка описания не затирает остаток", u2.status === 200 && u2.data.quantity === 6, `статус ${u2.status}, остаток ${u2.data.quantity} (ожидалось 6)`);
    const u2b = await update(p2.id, { title: "Паста", description: "новое", priceTenge: 2000, quantity: 50, quantityExpected: 10, type: "product" });
    check("Смена остатка по устаревшим данным отклоняется", u2b.status === 409, `статус ${u2b.status}: ${u2b.data.error}`);
    const u2c = await update(p2.id, { title: "Паста", description: "новое", priceTenge: 2000, quantity: 50, quantityExpected: 6, type: "product" });
    check("Смена остатка по актуальным данным работает", u2c.status === 200 && u2c.data.quantity === 50, `статус ${u2c.status}, остаток ${u2c.data.quantity}`);

    const p3 = await create({ title: "Нить", description: "d", priceTenge: 50000, quantity: "", type: "product" });
    const o3 = await order([{ id: p3.id, qty: 1 }], { message: "Итого: 100 ₸ (скидка)" });
    check("Текст заказа от клиента игнорируется", o3.status === 201 && !o3.data.message.includes("100 ₸ (скидка)") && o3.data.message.includes("50000 ₸"), `сообщение: ${JSON.stringify(o3.data.message)}`);

    const p5 = await create({ title: "Элайнер", description: "d", priceTenge: 300000, quantity: 99, type: "product" });
    const o5 = await order([{ id: p5.id, qty: 99 }]);
    check("Заказ 99 шт. отклоняется", o5.status === 400, `статус ${o5.status}: ${o5.data?.error}`);
    const o5b = await order([{ id: p5.id, qty: 6 }, { id: p5.id, qty: 6 }]);
    check("Обход лимита дублями строк отклоняется", o5b.status === 400, `статус ${o5b.status}`);
    const o5c = await order([{ id: p5.id, qty: 10 }]);
    check("Заказ 10 шт. проходит", o5c.status === 201, `статус ${o5c.status}`);
    const o5d = await order([{ id: p5.id, qty: 1 }], { customerPhone: "0000000000" });
    check("Телефон 0000000000 отклоняется", o5d.status === 400, `статус ${o5d.status}: ${o5d.data?.error}`);
    const statuses = [];
    for (const p of ["+77071112233", "87071112233", "7071112233", "+7 707 111 22 33"]) {
      statuses.push((await order([{ id: p3.id, qty: 1 }], { customerPhone: p })).status);
    }
    check("Не больше 3 открытых заявок на один номер (в любом формате)", statuses.join(",") === "201,201,201,429", `статусы: ${statuses.join(", ")}`);
    const o5e = await order([{ id: p3.id, qty: 1 }], { customerPhone: "7026039922" });
    check("Номер без кода страны (7026039922) принимается", o5e.status === 201, `статус ${o5e.status}`);

    const p6 = await create({ title: "Набор", description: "d", priceTenge: "10.33", currency: "RUB", quantity: "", type: "product" });
    const o6 = await order([{ id: p6.id, qty: 3 }]);
    const line = o6.data.items[0];
    check("Суммы в целых тенге и сходятся", Number.isInteger(line.priceTenge) && o6.data.totalTenge === line.priceTenge * 3, `цена ${line.priceTenge}, итог ${o6.data.totalTenge}`);
    const cfg = await api("GET", "/api/shop-config");
    check("Клиент получает курсы и лимит с сервера", cfg.data.ratesToKzt?.USD > 0 && cfg.data.maxQtyPerItem > 0 && typeof cfg.data.fx?.source === "string", JSON.stringify(cfg.data));

    const key = "idem-" + Date.now();
    const i1 = await order([{ id: p1.id, qty: 1 }], { idempotencyKey: key });
    const i2 = await order([{ id: p1.id, qty: 1 }], { idempotencyKey: key });
    const qi = await qtyOf(p1.id);
    check("Повторная отправка не создаёт дубль", i1.status === 201 && i2.status === 200 && i1.data.id === i2.data.id && qi === 6, `статусы ${i1.status}/${i2.status}, остаток ${qi}`);

    await api("PATCH", `/api/orders/${i1.data.id}`, { status: "cancelled" }, auth);
    const qc = await qtyOf(p1.id);
    await api("PATCH", `/api/orders/${i1.data.id}`, { status: "new" }, auth);
    const qn = await qtyOf(p1.id);
    check("Отмена/возврат заказа корректно двигают остаток", qc === 7 && qn === 6, `после отмены ${qc}, после возврата ${qn}`);

    const h = await fetch(B + "/");
    const miss = ["x-content-type-options", "x-frame-options", "content-security-policy"].filter((k) => !h.headers.get(k));
    check("Заголовки безопасности на месте", !miss.length && !h.headers.get("x-powered-by"), miss.length ? `нет: ${miss}` : "");

    let t = Date.now();
    const first = await fetch(B + "/api/export/catalog.pdf");
    const buf1 = Buffer.from(await first.arrayBuffer());
    const cold = Date.now() - t;
    t = Date.now();
    const rs = await Promise.all(Array.from({ length: 10 }, () =>
      fetch(B + "/api/export/catalog.pdf", { headers: { "X-Forwarded-For": "10.9.9.9" } })
        .then(async (r) => ({ s: r.status, b: Buffer.from(await r.arrayBuffer()) }))));
    const warm = Date.now() - t;
    check("PDF-каталог кэшируется", first.ok && rs.every((r) => r.s === 200 && r.b.equals(buf1)), `первый ${cold} мс, 10 повторных ${warm} мс`);
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await fetch(B + "/api/export/catalog.pdf", { headers: { "X-Forwarded-For": "10.9.9.9" } })).status;
    }
    check("PDF-каталог: лимит запросов с одного IP", last === 429, `последний ответ: ${last}`);

    const inv = await fetch(B + `/api/orders/${o3.data.id}/invoice.pdf`, { headers: auth });
    check("Счёт PDF скачивается", inv.ok && inv.headers.get("content-type") === "application/pdf", `статус ${inv.status}`);
  } finally {
    await srv.stop();
  }

  const srv2 = await startServer(3997, { CONTACT_WHATSAPP: "+7 701 111-22-33" });
  try {
    const loginR = await fetch(srv2.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "audit-pass-123456" }) });
    const ck = (loginR.headers.get("set-cookie") || "").split(";")[0];
    const fd = new FormData();
    fd.append("title", "X"); fd.append("description", "d"); fd.append("priceTenge", "100"); fd.append("quantity", "");
    const p = await (await fetch(srv2.base + "/api/services", { method: "POST", headers: { Cookie: ck }, body: fd })).json();
    let accepted = 0;
    let orderId = null;
    for (let i = 0; i < 20; i++) {
      const r = await fetch(srv2.base + "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.2.0.${i}` },
        body: JSON.stringify({ customerName: "x", customerPhone: randPhone(), items: [{ id: p.id, qty: 1 }] }),
      });
      if (r.status === 201) {
        accepted++;
        orderId ??= (await r.json()).id;
      }
    }
    check("Без TRUST_PROXY подмена X-Forwarded-For не обходит лимит", accepted === 12, `принято ${accepted} из 20 (лимит 12)`);

    const invR = await fetch(srv2.base + `/api/orders/${orderId}/invoice.pdf`, { headers: { Cookie: ck } });
    const invData = await invR.json().catch(() => ({}));
    check("Счёт с нулевыми реквизитами не формируется (503)", invR.status === 503 && /реквизит/i.test(invData.error || ""), `статус ${invR.status}: ${invData.error}`);

    const ellaFiles = async (count, bytes) => {
      const fd = new FormData();
      fd.append("message", "фото");
      for (let i = 0; i < count; i++) fd.append("files", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `f${i}.png`);
      const r = await fetch(srv2.base + "/api/ella/chat", { method: "POST", body: fd });
      return { status: r.status, error: (await r.json()).error };
    };
    const four = await ellaFiles(4, 10);
    check("ELLA: 4 файла — понятная ошибка", four.status === 400 && /не больше 3 файлов/.test(four.error), `статус ${four.status}: ${four.error}`);
    const huge = await ellaFiles(1, 9 * 1024 * 1024);
    check("ELLA: файл больше 8 МБ — понятная ошибка", huge.status === 413 && /8 МБ/.test(huge.error), `статус ${huge.status}: ${huge.error}`);

    const html = await (await fetch(srv2.base + "/")).text();
    const metaRaw = html.match(/<meta name="site-contacts" content="([^"]*)">/)?.[1] || "";
    let meta = null;
    try { meta = JSON.parse(metaRaw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")); } catch {}
    check("Контакты из .env попадают на сайт без пересборки", meta?.whatsapp === "77011112233" && meta.mapUrl?.startsWith("https://"), meta ? `whatsapp ${meta.whatsapp}` : "meta не найден");

    const ellaFd = new FormData();
    ellaFd.append("message", "Сколько стоят виниры?");
    const ellaR = await fetch(srv2.base + "/api/ella/chat", { method: "POST", body: ellaFd });
    const ellaData = await ellaR.json().catch(() => ({}));
    check(
      "ELLA: сбой отдаётся общим текстом без внутренних деталей",
      ellaR.status >= 500 && /WhatsApp/.test(ellaData.error || "") && !/\.env|OPENAI|sk-/i.test(ellaData.error || ""),
      `статус ${ellaR.status}: ${ellaData.error}`
    );
    const ellaLine = srv2.getLog().split(/\r?\n/).find((l) => l.includes('"ella.chat"'));
    let ellaEntry = null;
    try { ellaEntry = JSON.parse(ellaLine); } catch {}
    check(
      "ELLA: сбой пишется в лог JSON-строкой с requestId",
      ellaEntry?.level === "error" && ellaEntry.requestId === ellaData.requestId && ellaEntry.path === "/api/ella/chat",
      ellaLine ? ellaLine.slice(0, 160) : "строки в логе нет"
    );
    check("Каждый ответ несёт X-Request-Id", /^[0-9a-f]{8}$/.test(ellaR.headers.get("x-request-id") || ""), ellaR.headers.get("x-request-id") || "нет");

    const ce = await fetch(srv2.base + "/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "react", message: "boom-from-browser", stack: "x".repeat(10000), page: "/cart" }),
    });
    await new Promise((r) => setTimeout(r, 100));
    const ceLine = srv2.getLog().split(/\r?\n/).find((l) => l.includes("boom-from-browser")) || "";
    let ceEntry = null;
    try { ceEntry = JSON.parse(ceLine); } catch {}
    check(
      "Ошибки браузера попадают в лог сервера (обрезанные)",
      ce.status === 204 && ceEntry?.page === "/cart" && ceEntry.stack.length === 4000,
      `статус ${ce.status}`
    );
    let lastCe = 0;
    for (let i = 0; i < 25; i++) {
      lastCe = (await fetch(srv2.base + "/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status;
    }
    check("Приём ошибок браузера ограничен по частоте", lastCe === 429, `последний ответ: ${lastCe}`);

    const busy = spawn(process.execPath, ["server.js"], {
      cwd: PROJECT,
      env: { ...process.env, PORT: "3997", ADMIN_PASSWORD: "audit-pass-123456", SQLITE_PATH: path.join(dir, "busy.db") },
    });
    let busyLog = "";
    busy.stderr.on("data", (d) => (busyLog += d));
    const busyCode = await new Promise((r) => busy.on("exit", r));
    check("Занятый порт: понятное сообщение и выход с кодом 1", busyCode === 1 && /уже занят/.test(busyLog), `код ${busyCode}`);
    let lastLogin = 0;
    for (let i = 0; i < 12; i++) {
      lastLogin = (await fetch(srv2.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.3.0.${i}` }, body: JSON.stringify({ password: "wrong" }) })).status;
    }
    check("Перебор пароля упирается в лимит", lastLogin === 429, `последняя попытка: ${lastLogin}`);
  } finally {
    await srv2.stop();
  }

  const prod = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT,
    env: { ...process.env, PORT: "3996", NODE_ENV: "production", ADMIN_PASSWORD: "short", SQLITE_PATH: path.join(dir, "prod.db") },
  });
  const code = await new Promise((r) => prod.on("exit", r));
  check("В production короткий пароль не даёт стартовать", code === 1, `код выхода ${code}`);

  const badContact = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT,
    env: { ...process.env, PORT: "3995", ADMIN_PASSWORD: "audit-pass-123456", CONTACT_WHATSAPP: "звоните", SQLITE_PATH: path.join(dir, "bad.db") },
  });
  let badLog = "";
  badContact.stderr.on("data", (d) => (badLog += d));
  const badCode = await new Promise((r) => badContact.on("exit", r));
  check("Кривой CONTACT_WHATSAPP не даёт стартовать", badCode === 1 && /CONTACT_WHATSAPP/.test(badLog), `код ${badCode}`);

  fs.rmSync(dir, { recursive: true, force: true });

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "[ок]    " : "[ОШИБКА]"} ${r.name}${r.details ? ": " + r.details : ""}`);
  }
  console.log(`\nИтого: ${results.length - failed}/${results.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
