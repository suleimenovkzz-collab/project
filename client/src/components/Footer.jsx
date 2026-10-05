import { Link } from "react-router-dom";
import { CONTACT_WHATSAPP_HREF, INSTAGRAM_URL, WHATSAPP_HREF } from "../lib/constants";

export default function Footer({ variant = "home" }) {
  const year = new Date().getFullYear();

  if (variant === "cart") {
    return (
      <footer className="site-footer">
        <span>© {year} Клиника доктора Сулейменова</span>
        <Link to="/products">К каталогу</Link>
      </footer>
    );
  }

  if (variant === "products") {
    return (
      <footer className="site-footer">
        <span>© {year} Клиника доктора Сулейменова</span>
        <div className="footer-links">
          <Link to="/">На главную</Link>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        </div>
      </footer>
    );
  }

  return (
    <footer className="site-footer">
      <span>© {year} Клиника доктора Сулейменова</span>
      <div className="footer-links">
        <Link to="/products">Каталог</Link>
        <a href="#faq">Вопросы</a>
        <a href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
          Instagram
        </a>
      </div>
    </footer>
  );
}
