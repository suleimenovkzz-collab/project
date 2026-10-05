import { CONTACTS } from "./contacts";

export const CART_KEY = "as_cart_v1";
export const DISPLAY_CURRENCY_KEY = "as_display_currency";
export const ADMIN_TOKEN_KEY = "admin_token";

export const WHATSAPP_NUMBER = CONTACTS.whatsapp;
export const WHATSAPP_HREF = `https://wa.me/${CONTACTS.whatsapp}`;
export const CONTACT_WHATSAPP_HREF = `${WHATSAPP_HREF}?text=${encodeURIComponent(
  "Здравствуйте! Пишу с вашего сайта. Хочу записаться на консультацию."
)}`;
export const PHONE_DISPLAY = CONTACTS.phoneDisplay;
export const TELEGRAM_USERNAME = CONTACTS.telegram;
export const INSTAGRAM_HANDLE = CONTACTS.instagram;
export const INSTAGRAM_URL = `https://instagram.com/${CONTACTS.instagram}`;

export const CLINIC_ADDRESS = CONTACTS.address;
export const CLINIC_MAP_URL = CONTACTS.mapUrl;
