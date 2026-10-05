/**
 * KZT exchange rates: National Bank of Kazakhstan (official) → open.er-api.com → last saved → emergency.
 * FX_*_KZT in .env pin a rate manually and always win.
 * getRates() is synchronous: prices are computed inside DB transactions and must not await the network.
 */
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const CURRENCIES = ["USD", "EUR", "RUB"];
const EMERGENCY_RATES = { USD: 480, EUR: 520, RUB: 5.2 };
/** A provider answering outside these bounds is broken, not a real market move. */
const SANE_RANGE = { USD: [150, 2000], EUR: [150, 2500], RUB: [1, 50] };

const FETCH_TIMEOUT_MS = 8000;
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

function isSane(rates) {
  return CURRENCIES.every((code) => {
    const value = rates?.[code];
    const [min, max] = SANE_RANGE[code];
    return Number.isFinite(value) && value >= min && value <= max;
  });
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function almatyDate(date = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function parseNbrkXml(xml) {
  const rates = {};
  for (const [, item] of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const code = item.match(/<title>\s*([A-Z]{3})\s*<\/title>/)?.[1];
    if (!CURRENCIES.includes(code)) continue;
    const value = Number(item.match(/<description>\s*([\d.,]+)\s*<\/description>/)?.[1]?.replace(",", "."));
    const quant = Number(item.match(/<quant>\s*(\d+)\s*<\/quant>/)?.[1] || 1);
    if (value > 0 && quant > 0) rates[code] = round4(value / quant);
  }
  return rates;
}

/** open.er-api returns units per 1 USD; KZT per X = KZT/USD ÷ X/USD. */
function parseOpenErApi(json) {
  if (json?.result !== "success" || !(json?.rates?.KZT > 0)) return {};
  const r = { USD: 1, ...json.rates };
  const rates = {};
  for (const code of CURRENCIES) {
    if (r[code] > 0) rates[code] = round4(r.KZT / r[code]);
  }
  return rates;
}

const PROVIDERS = [
  {
    name: "nbrk",
    url: () => `https://nationalbank.kz/rss/get_rates.cfm?fdate=${almatyDate()}`,
    parse: (response) => response.text().then(parseNbrkXml),
  },
  {
    name: "open.er-api",
    url: () => "https://open.er-api.com/v6/latest/USD",
    parse: (response) => response.json().then(parseOpenErApi),
  },
];

function readEnvOverrides(env) {
  const overrides = {};
  for (const code of CURRENCIES) {
    const n = Number(String(env[`FX_${code}_KZT`] ?? "").trim().replace(",", "."));
    if (Number.isFinite(n) && n > 0) overrides[code] = n;
  }
  return overrides;
}

/**
 * @param {{ cacheFile: string, env?: NodeJS.ProcessEnv, autoUpdate?: boolean, fetchImpl?: typeof fetch }} options
 */
function createRatesService({ cacheFile, env = process.env, autoUpdate = true, fetchImpl = fetch }) {
  const overrides = readEnvOverrides(env);
  const allPinned = CURRENCIES.every((code) => code in overrides);
  let live = { ...EMERGENCY_RATES };
  let source = "emergency";
  let updatedAt = null;
  let inFlight = null;
  let timer = null;

  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (isSane(saved.rates)) {
      live = { ...saved.rates };
      source = `cache:${saved.source || "unknown"}`;
      updatedAt = saved.updatedAt || null;
    }
  } catch (error) {
    if (error.code !== "ENOENT") logger.warn("fx: saved rates unreadable, ignoring", { error });
  }

  function getRates() {
    return { KZT: 1, ...live, ...overrides };
  }

  function getInfo() {
    const age = updatedAt ? Date.now() - Date.parse(updatedAt) : Infinity;
    return {
      source: allPinned ? "env" : source,
      updatedAt,
      pinned: Object.keys(overrides),
      stale: !allPinned && (source === "emergency" || age > STALE_AFTER_MS),
    };
  }

  async function fetchFrom(provider) {
    const response = await fetchImpl(provider.url(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rates = await provider.parse(response);
    if (!isSane(rates)) throw new Error(`implausible rates ${JSON.stringify(rates)}`);
    return rates;
  }

  async function doRefresh() {
    const failures = [];
    for (const provider of PROVIDERS) {
      try {
        const rates = await fetchFrom(provider);
        live = rates;
        source = provider.name;
        updatedAt = new Date().toISOString();
        try {
          fs.writeFileSync(cacheFile, JSON.stringify({ rates, source, updatedAt }, null, 2));
        } catch (error) {
          logger.warn("fx: could not save rates to disk", { error, cacheFile });
        }
        logger.info("fx: rates updated", { source, rates });
        return true;
      } catch (error) {
        failures.push({ provider: provider.name, reason: error.message });
      }
    }
    const info = getInfo();
    const log = info.stale ? logger.error : logger.warn;
    log("fx: all providers failed, keeping previous rates", { failures, ...info, rates: getRates() });
    return false;
  }

  /** Concurrent callers share one network round-trip. */
  function refresh() {
    if (!inFlight) inFlight = doRefresh().finally(() => (inFlight = null));
    return inFlight;
  }

  function schedule(ms) {
    timer = setTimeout(async () => {
      const ok = await refresh();
      schedule(ok ? REFRESH_MS : RETRY_AFTER_FAILURE_MS);
    }, ms);
    timer.unref?.();
  }

  function start() {
    if (!autoUpdate || allPinned) return;
    schedule(0);
  }

  function stop() {
    if (timer) clearTimeout(timer);
  }

  return { getRates, getInfo, refresh, start, stop };
}

module.exports = {
  createRatesService,
  parseNbrkXml,
  parseOpenErApi,
  isSane,
  EMERGENCY_RATES,
  defaultCacheFile: (dataDir) => path.join(dataDir, "fx-rates.json"),
};
