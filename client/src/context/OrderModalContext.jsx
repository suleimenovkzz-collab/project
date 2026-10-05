import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { saveOrderToServer } from "../api/orders";
import { useCart } from "./CartContext";
import {
  buildCartMessage,
  buildDirectMessage,
  normalizePhoneInput,
  openMessenger,
} from "../lib/messengers";

const OrderModalContext = createContext(null);

export function OrderModalProvider({ children }) {
  const { clearCart } = useCart();
  const [pendingOrder, setPendingOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const idempotencyKeyRef = useRef("");

  const open = Boolean(pendingOrder);

  const openOrderModal = useCallback((order) => {
    setPendingOrder(order);
    setError("");
    setBusy(false);
    setName("");
    setPhone("");
    idempotencyKeyRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  const closeOrderModal = useCallback(() => {
    setPendingOrder(null);
    setError("");
    setBusy(false);
    idempotencyKeyRef.current = "";
  }, []);

  useEffect(() => {
    document.body.classList.toggle("order-modal-open", open);
    return () => document.body.classList.remove("order-modal-open");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeOrderModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOrderModal]);

  const submitOrder = useCallback(
    async (channel = "whatsapp") => {
      if (!pendingOrder) return;

      const customerName = String(name || "").trim();
      const customerPhone = normalizePhoneInput(phone);
      const selectedChannel = channel === "telegram" ? "telegram" : "whatsapp";

      if (!customerName) {
        setError("Укажите имя");
        return;
      }
      if (customerPhone.replace(/\D/g, "").length < 10) {
        setError("Укажите корректный номер телефона");
        return;
      }

      const customer = { name: customerName, phone: customerPhone };
      const items = pendingOrder.items;
      const source = pendingOrder.source;

      setBusy(true);
      setError("");

      const popup = window.open("", "_blank");
      if (popup) popup.opener = null;

      try {
        const saved = await saveOrderToServer({
          source,
          channel: selectedChannel,
          customerName,
          customerPhone,
          items,
          idempotencyKey: idempotencyKeyRef.current,
        });

        const pricedItems =
          Array.isArray(saved.items) && saved.items.length
            ? saved.items
            : items;
        // Server items are already in KZT — do not re-apply FX via service.currency
        const message =
          source === "direct"
            ? buildDirectMessage(
                {
                  title:
                    pricedItems[0]?.title ||
                    pendingOrder.service?.title ||
                    "",
                  priceTenge: pricedItems[0]?.priceTenge,
                  currency: "KZT",
                },
                customer
              )
            : buildCartMessage(pricedItems, customer);

        if (source === "cart") {
          clearCart();
        }
        closeOrderModal();
        await openMessenger(selectedChannel, message, popup);
      } catch (err) {
        if (popup && !popup.closed) popup.close();
        setError(err.message || "Ошибка отправки");
        setBusy(false);
      }
    },
    [pendingOrder, name, phone, clearCart, closeOrderModal]
  );

  const value = useMemo(
    () => ({ openOrderModal, closeOrderModal }),
    [openOrderModal, closeOrderModal]
  );

  return (
    <OrderModalContext.Provider value={value}>
      {children}
      <div
        id="order-modal"
        className="order-modal"
        hidden={!open}
        aria-hidden={open ? "false" : "true"}
      >
        <div
          className="order-modal-backdrop"
          onClick={closeOrderModal}
          aria-hidden="true"
        />
        <div
          className="order-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-modal-title"
        >
          <button
            type="button"
            className="order-modal-close"
            onClick={closeOrderModal}
            aria-label="Закрыть"
          >
            ×
          </button>
          <p className="order-modal-eyebrow">Заявка</p>
          <h2 id="order-modal-title">Оформление заявки</h2>
          <p className="order-modal-lead">
            Укажите имя и телефон — заявка сохранится, затем выберите удобный
            мессенджер.
          </p>
          <form
            id="order-form"
            className="order-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitOrder("whatsapp");
            }}
          >
            <label>
              Имя
              <input
                type="text"
                name="customerName"
                autoComplete="name"
                placeholder="Как к вам обращаться"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Телефон
              <input
                type="tel"
                name="customerPhone"
                autoComplete="tel"
                placeholder="+7 7XX XXX XX XX"
                required
                maxLength={20}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {error ? (
              <p id="order-form-error" className="order-form-error">
                {error}
              </p>
            ) : (
              <p id="order-form-error" className="order-form-error" hidden />
            )}
            <div className="order-channel-actions">
              <button
                type="button"
                className="btn btn-whatsapp"
                disabled={busy}
                onClick={() => submitOrder("whatsapp")}
              >
                {busy ? "Сохраняем…" : "WhatsApp"}
              </button>
              <button
                type="button"
                className="btn btn-telegram"
                disabled={busy}
                onClick={() => submitOrder("telegram")}
              >
                {busy ? "Сохраняем…" : "Telegram"}
              </button>
            </div>
            <button
              type="button"
              className="btn-line order-cancel-btn"
              onClick={closeOrderModal}
            >
              Отмена
            </button>
          </form>
        </div>
      </div>
    </OrderModalContext.Provider>
  );
}

export function useOrderModal() {
  const ctx = useContext(OrderModalContext);
  if (!ctx) {
    throw new Error("useOrderModal must be used within OrderModalProvider");
  }
  return ctx;
}
