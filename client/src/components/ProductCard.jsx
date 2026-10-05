import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCurrency } from "../context/CurrencyContext";
import { useOrderModal } from "../context/OrderModalContext";
import { useToast } from "../context/ToastContext";
import ProductImage from "./ProductImage";
import { isPurchasable, typeLabel, unitPriceKzt } from "../lib/money";

export default function ProductCard({ service, index }) {
  const { isInCart, addToCart } = useCart();
  const { priceOf } = useCurrency();
  const { openOrderModal } = useOrderModal();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const num = String(index + 1).padStart(2, "0");
  const priceText = priceOf(service);
  const type = service.type || "product";
  const inCart = isInCart(service.id);
  const available = isPurchasable(service, 1);
  const orderLabel = type === "service" ? "Записаться" : "Заказать";

  const cartPayload = {
    id: service.id,
    title: service.title,
    priceTenge: unitPriceKzt(service),
    image: service.image || "",
    currency: service.currency || "KZT",
    type,
    quantity: service.quantity,
  };

  function handleAddCart() {
    if (!available) {
      showToast("Нет в наличии");
      return;
    }
    if (inCart) {
      navigate("/cart");
      return;
    }
    const ok = addToCart(cartPayload);
    if (!ok) {
      showToast("Нет в наличии");
      return;
    }
    showToast("Добавлено в корзину", { href: "/cart", linkText: "Открыть" });
  }

  function handleOrder() {
    if (!available) {
      showToast("Нет в наличии");
      return;
    }
    openOrderModal({
      source: "direct",
      items: [{ ...cartPayload, qty: 1 }],
      service: cartPayload,
    });
  }

  return (
    <article className="service product-card" data-type={type}>
      <div className="service-photo">
        <ProductImage src={service.image} alt={service.title} />
      </div>
      <div className="service-copy">
        <span>{num}</span>
        <p className="product-type">{typeLabel(type)}</p>
        <h3>{service.title}</h3>
        <p>{service.description || ""}</p>
        {priceText ? <p className="service-price">{priceText}</p> : null}
        {!available ? (
          <p className="service-price" role="status">
            Нет в наличии
          </p>
        ) : null}
        <div className="product-actions">
          <button
            type="button"
            className={`btn btn-line add-cart-btn${inCart ? " in-cart" : ""}`}
            aria-pressed={inCart ? "true" : "false"}
            disabled={!available && !inCart}
            onClick={handleAddCart}
          >
            {inCart ? "В корзине" : "В корзину"}
          </button>
          <button
            type="button"
            className="btn btn-whatsapp service-order"
            disabled={!available}
            onClick={handleOrder}
          >
            {orderLabel}
          </button>
        </div>
      </div>
    </article>
  );
}
