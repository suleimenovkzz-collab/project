/**
 * Реквизиты компании-продавца для счетов.
 * Значения можно переопределить через .env (COMPANY_*); телефон и адрес по умолчанию — из config/contacts.
 */
const contacts = require("./contacts");

function env(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : fallback;
}

module.exports = {
  legalName: env(
    "COMPANY_LEGAL_NAME",
    "ИП Алишер Галымханович Сулейменов"
  ),
  iinBin: env("COMPANY_IIN_BIN", "000000000000"),
  bankName: env("COMPANY_BANK_NAME", "АО «Kaspi Bank»"),
  iban: env("COMPANY_IBAN", "KZ000000000000000000"),
  bik: env("COMPANY_BIK", "CASPKZKA"),
  phone: env("COMPANY_PHONE", contacts.phoneDisplay),
  email: env("COMPANY_EMAIL", contacts.email),
  address: env("COMPANY_ADDRESS", `г. ${contacts.address}`),
  taxNote: env("COMPANY_TAX_NOTE", "Без НДС"),
};
