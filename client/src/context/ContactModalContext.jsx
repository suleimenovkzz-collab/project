import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CLINIC_ADDRESS,
  CLINIC_MAP_URL,
  CONTACT_WHATSAPP_HREF,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  PHONE_DISPLAY,
  WHATSAPP_HREF,
} from "../lib/constants";

const ContactModalContext = createContext(null);

export function ContactModalProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openContactModal = useCallback(() => setOpen(true), []);
  const closeContactModal = useCallback(() => setOpen(false), []);

  useEffect(() => {
    document.body.classList.toggle("contact-modal-open", open);
    return () => document.body.classList.remove("contact-modal-open");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeContactModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeContactModal]);

  const value = useMemo(
    () => ({ openContactModal, closeContactModal }),
    [openContactModal, closeContactModal]
  );

  return (
    <ContactModalContext.Provider value={value}>
      {children}
      <div
        id="contact-modal"
        className="contact-modal"
        hidden={!open}
        aria-hidden={open ? "false" : "true"}
      >
        <div
          className="contact-modal-backdrop"
          onClick={closeContactModal}
          aria-hidden="true"
        />
        <div
          className="contact-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-modal-title"
        >
          <button
            type="button"
            className="contact-modal-close"
            onClick={closeContactModal}
            aria-label="Закрыть"
          >
            ×
          </button>
          <p className="contact-modal-eyebrow">Контакт</p>
          <h2 id="contact-modal-title">Напишите напрямую</h2>
          <p className="contact-modal-lead">
            WhatsApp с готовым приветствием или Instagram.
          </p>
          <a
            className="btn btn-whatsapp contact-modal-whatsapp"
            href={CONTACT_WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            Написать в WhatsApp
          </a>
          <a
            className="contact-modal-phone"
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            {PHONE_DISPLAY}
          </a>
          <a
            className="contact-modal-handle"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{INSTAGRAM_HANDLE}
          </a>
          <a
            className="contact-modal-city"
            href={CLINIC_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {CLINIC_ADDRESS}
          </a>
        </div>
      </div>
    </ContactModalContext.Provider>
  );
}

export function useContactModal() {
  const ctx = useContext(ContactModalContext);
  if (!ctx) {
    throw new Error("useContactModal must be used within ContactModalProvider");
  }
  return ctx;
}
