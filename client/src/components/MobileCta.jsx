import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { CONTACT_WHATSAPP_HREF } from "../lib/constants";

export default function MobileCta() {
  const { count } = useCart();

  return (
    <div className="mobile-cta" aria-label="Быстрые действия">
      <a
        className="mobile-cta-wa"
        href={CONTACT_WHATSAPP_HREF}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
      <Link className="mobile-cta-catalog" to="/products">
        Каталог
      </Link>
      <Link className="mobile-cta-cart" to="/cart">
        Корзина{" "}
        <span data-cart-count hidden={count === 0}>
          {count}
        </span>
      </Link>
    </div>
  );
}
