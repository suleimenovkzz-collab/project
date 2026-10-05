import defaults from "../../../config/contacts.defaults.json";

/** The server injects the live contacts (incl. CONTACT_* from .env) into index.html; `vite dev` has no meta. */
function readInjected() {
  const raw = document.querySelector('meta[name="site-contacts"]')?.getAttribute("content");
  if (!raw) {
    if (import.meta.env.PROD) console.warn("[contacts] site-contacts meta missing, using bundled defaults");
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("[contacts] site-contacts meta is not valid JSON:", error);
    return {};
  }
}

export const CONTACTS = Object.freeze({ ...defaults, ...readInjected() });
