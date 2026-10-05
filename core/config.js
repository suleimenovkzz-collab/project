const contacts = require("../config/contacts");

module.exports = {
  getOpenAiApiKey: () => process.env.OPENAI_API_KEY || "",
  getOpenAiModel: () => process.env.OPENAI_MODEL || "gpt-4o-mini",
  temperature: 0.55,
  maxTokens: 380,
  requestTimeoutMs: 25_000,
  /** Whole reply incl. retries and tool loops; must stay below the client's 60s abort. */
  replyBudgetMs: 40_000,
  /** Not worth starting an OpenAI call with less time than this left. */
  minAttemptMs: 3_000,
  maxRetries: 1,
  retryDelayMs: 600,
  maxToolLoops: 4,
  historyLimit: 8,
  historyContentLimit: 1000,
  catalogPromptLimit: 20,
  whatsappNumber: contacts.whatsapp,
  whatsappBaseUrl: `https://wa.me/${contacts.whatsapp}?text=`,
  instagramUrl: `https://instagram.com/${contacts.instagram}`,
  clinicName: "Клиника доктора Сулейменова",
  doctorName: "Алишер Галымханович Сулейменов",
  doctorShortName: "Алишер Галымханович",
  doctorRole: "хирург-имплантолог и ортопед",
  city: contacts.city,
  address: contacts.addressNote ? `${contacts.address} (${contacts.addressNote})` : contacts.address,
  mapUrl: contacts.mapUrl,
  currencySymbols: { KZT: "₸", USD: "$", RUB: "₽", EUR: "€" },
};
