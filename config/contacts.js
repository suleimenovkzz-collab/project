/**
 * The only source of public contacts: server, ELLA, invoices and (via a <meta> tag in index.html) the React client.
 * Defaults live in contacts.defaults.json (also bundled into the client for `vite dev`); CONTACT_* in .env override them.
 * A malformed override stops the server — a half-applied phone change is worse than a failed start.
 */
const defaults = require("./contacts.defaults.json");

function env(key, fallback) {
  const value = String(process.env[key] ?? "").trim();
  return value || fallback;
}

const whatsapp = env("CONTACT_WHATSAPP", defaults.whatsapp).replace(/\D/g, "");
if (!/^\d{10,15}$/.test(whatsapp)) {
  throw new Error(
    `CONTACT_WHATSAPP в .env: нужен номер из 10–15 цифр в международном формате (например 77011234567), получено «${process.env.CONTACT_WHATSAPP}»`
  );
}

const mapUrl = env("CONTACT_MAP_URL", defaults.mapUrl);
if (!/^https:\/\//.test(mapUrl)) {
  throw new Error(`CONTACT_MAP_URL в .env должен начинаться с https://, получено «${mapUrl}»`);
}

const handle = (value) => String(value).replace(/^@/, "");

module.exports = Object.freeze({
  whatsapp,
  phoneDisplay: env("CONTACT_PHONE", defaults.phoneDisplay),
  telegram: handle(env("CONTACT_TELEGRAM", env("TELEGRAM_USERNAME", defaults.telegram))),
  instagram: handle(env("CONTACT_INSTAGRAM", defaults.instagram)),
  email: env("CONTACT_EMAIL", defaults.email),
  city: env("CONTACT_CITY", defaults.city),
  address: env("CONTACT_ADDRESS", defaults.address),
  addressNote: env("CONTACT_ADDRESS_NOTE", defaults.addressNote),
  mapUrl,
});
