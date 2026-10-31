/**
 * Offline + live verification for ELLA core and HTTP contract.
 * Usage: node scripts/verify-ella-core.js
 */
const fs = require("fs");
const path = require("path");
const { createElla, EllaError, createDefaultRegistry, config } = require("../core");
const { buildAttachmentParts } = require("../core/attachments");
const { buildHandoffMessage, buildWhatsAppHandoffUrl } = require("../core/handoff");
const { buildSystemPrompt } = require("../core/prompts");
const contacts = require("../config/contacts");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const services = [
  {
    id: "1",
    title: "Виниры",
    priceTenge: 150000,
    currency: "KZT",
    type: "service",
    description: "Эстетика улыбки",
  },
  {
    id: "2",
    title: "Имплант",
    priceTenge: 250000,
    currency: "KZT",
    type: "service",
    description: "Установка импланта",
  },
];

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

async function main() {
  console.log("--- unit: factory & tools ---");
  try {
    createElla({});
    assert(false, "createElla without readServices should throw");
  } catch (e) {
    assert(/readServices/.test(e.message), "createElla requires readServices");
  }

  const ella = createElla({ readServices: () => services });
  const status = ella.status();
  assert(typeof status.ready === "boolean", "status.ready is boolean");
  assert(typeof status.model === "string" && status.model.length > 0, "status.model present");
  assert(status.ready === Boolean(process.env.OPENAI_API_KEY), "status.ready matches env key");

  const names = ella.registry.list().map((t) => t.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify(["get_catalog", "get_clinic_info", "get_service"]),
    `tools registered: ${names.join(",")}`
  );

  const openaiTools = ella.registry.asOpenAiTools();
  assert(
    openaiTools.every((t) => t.type === "function" && t.function?.name && t.function?.parameters),
    "OpenAI tool schema shape"
  );

  const catalog = await ella.registry.execute("get_catalog", { limit: 10 }, { readServices: () => services });
  assert(catalog.count === 2 && catalog.items[0].priceLabel.includes("₸"), "get_catalog returns prices");

  const filtered = await ella.registry.execute(
    "get_catalog",
    { query: "винир" },
    { readServices: () => services }
  );
  assert(filtered.count === 1 && filtered.items[0].title === "Виниры", "get_catalog filter");

  const svc = await ella.registry.execute("get_service", { query: "имплант" }, { readServices: () => services });
  assert(svc.found && svc.service.title === "Имплант", "get_service match");

  const missing = await ella.registry.execute(
    "get_service",
    { query: "космолёт" },
    { readServices: () => services }
  );
  assert(missing.found === false, "get_service miss");

  const clinic = await ella.registry.execute("get_clinic_info", { topic: "contacts" }, {});
  assert(clinic.contacts.whatsappNumber === contacts.whatsapp, "clinic whatsapp");
  assert(clinic.contacts.instagram.includes("instagram.com"), "clinic instagram");

  const unknown = await ella.registry.execute("nope", {}, {});
  assert(unknown.error && /Unknown/.test(unknown.error), "unknown tool safe error");

  console.log("--- unit: attachments / prompts / handoff ---");
  const img = buildAttachmentParts([
    {
      originalname: "smile.jpg",
      mimetype: "image/jpeg",
      size: 12,
      buffer: Buffer.from("fake"),
    },
  ]);
  assert(img.labels[0] === "smile.jpg", "attachment label");
  assert(img.parts.some((p) => p.type === "image_url"), "image_url part");

  const pdf = buildAttachmentParts([
    {
      originalname: "doc.pdf",
      mimetype: "application/pdf",
      size: 10,
      buffer: Buffer.from("%PDF"),
    },
  ]);
  assert(pdf.parts.some((p) => p.type === "file"), "pdf file part");

  const prompt = buildSystemPrompt(services);
  assert(/ELLA/.test(prompt) && /Виниры/.test(prompt), "system prompt includes catalog");
  assert(/get_catalog/.test(prompt) && /get_clinic_info/.test(prompt), "system prompt mentions tools");

  const handoff = buildHandoffMessage([{ role: "user", content: "Хочу виниры" }]);
  assert(handoff.startsWith("Здравствуйте, Алишер Галымханович!"), "handoff greeting matches old contract");
  assert(/Хочу виниры/.test(handoff), "handoff includes request");
  const url = buildWhatsAppHandoffUrl([{ role: "user", content: "Хочу виниры" }]);
  assert(url.startsWith(`https://wa.me/${contacts.whatsapp}?text=`), "whatsapp url prefix");

  console.log("--- unit: errors ---");
  try {
    await ella.chat({ message: "" });
    assert(false, "empty chat should throw");
  } catch (e) {
    assert(e instanceof EllaError && e.status === 400, "empty -> 400 bad_request");
  }

  const noKeyElla = createElla({
    readServices: () => services,
    registry: createDefaultRegistry(),
  });
  const prevKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await noKeyElla.chat({ message: "привет" });
    assert(false, "no key should throw");
  } catch (e) {
    assert(e instanceof EllaError && e.status === 503 && e.code === "no_key", "no key -> 503");
  } finally {
    if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
  }

  console.log("--- live: OpenAI chat (if key) ---");
  if (!config.getOpenAiApiKey()) {
    console.log("SKIP: no OPENAI_API_KEY");
  } else {
    const live = createElla({ readServices: () => services });
    const result = await live.chat({
      message: "Сколько примерно стоят виниры? Коротко.",
      history: [],
    });
    assert(typeof result.reply === "string" && result.reply.length > 5, "live reply text");
    assert(
      result.handoff &&
        typeof result.handoff.whatsappUrl === "string" &&
        result.handoff.whatsappUrl.startsWith("https://wa.me/"),
      "live handoff.whatsappUrl"
    );
    console.log("SAMPLE REPLY:", result.reply.slice(0, 180).replace(/\n/g, " "));
  }

  const port = process.env.VERIFY_PORT || process.env.PORT || "3000";
  console.log(`--- http contract (running server on :${port}) ---`);
  try {
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/ella/status`);
    const statusJson = await statusRes.json();
    assert(statusRes.ok, `GET /api/ella/status ${statusRes.status}`);
    assert(typeof statusJson.ready === "boolean" && typeof statusJson.model === "string", "status body shape");

    const emptyRes = await fetch(`http://127.0.0.1:${port}/api/ella/chat`, {
      method: "POST",
      body: (() => {
        const fd = new FormData();
        fd.set("message", "");
        fd.set("history", "[]");
        return fd;
      })(),
    });
    const emptyJson = await emptyRes.json().catch(() => ({}));
    assert(emptyRes.status === 400, `empty chat HTTP 400 got ${emptyRes.status}`);
    assert(typeof emptyJson.error === "string", "empty chat error string");

    if (statusJson.ready) {
      const chatRes = await fetch(`http://127.0.0.1:${port}/api/ella/chat`, {
        method: "POST",
        body: (() => {
          const fd = new FormData();
          fd.set("message", "Привет, подскажи адрес приёма");
          fd.set("history", "[]");
          return fd;
        })(),
      });
      const chatJson = await chatRes.json().catch(() => ({}));
      assert(chatRes.ok, `POST /api/ella/chat ${chatRes.status} ${chatJson.error || ""}`);
      assert(typeof chatJson.reply === "string" && chatJson.reply.length > 0, "http reply");
      assert(
        chatJson.handoff && typeof chatJson.handoff.whatsappUrl === "string",
        "http handoff.whatsappUrl"
      );
      console.log("HTTP SAMPLE:", String(chatJson.reply).slice(0, 180).replace(/\n/g, " "));
    } else {
      console.log("SKIP http live chat: AI not ready");
    }
  } catch (e) {
    failed += 1;
    console.error("FAIL: http checks —", e.message);
    console.error(`(start the server first: npm start — it listens on :${port})`);
  }

  console.log("\n==== RESULT ====");
  if (failed) {
    console.error(`${failed} failure(s)`);
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
