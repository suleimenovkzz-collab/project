import { Link, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useContactModal } from "../context/ContactModalContext";

export default function Header({ variant = "home" }) {
  const { count } = useCart();
  const { openContactModal } = useContactModal();
  const location = useLocation();
  const isProducts = location.pathname === "/products";
  const isCart = location.pathname === "/cart";

  return (
    <header className="site-header">
      <Link className="logo" to={variant === "home" ? "/#top" : "/"}>
        AS
      </Link>
      <nav className="nav" aria-label="Навигация">
        {variant === "home" ? (
          <>
            <a href="#about">О клинике</a>
            <a href="#services">Услуги</a>
            <Link to="/products">Каталог</Link>
            <Link to="/cart">
              Корзина{" "}
              <span data-cart-count hidden={count === 0}>
                {count}
              </span>
            </Link>
            <a
              href="#contact"
              onClick={(e) => {
                e.preventDefault();
                openContactModal();
              }}
            >
              Контакт
            </a>
          </>
        ) : (
          <>
            <Link to="/">Главная</Link>
            <Link to="/products" aria-current={isProducts ? "page" : undefined}>
              Каталог
            </Link>
            <Link to="/cart" aria-current={isCart ? "page" : undefined}>
              Корзина{" "}
              <span data-cart-count hidden={count === 0}>
                {count}
              </span>
            </Link>
            <a
              href="#contact"
              onClick={(e) => {
                e.preventDefault();
                openContactModal();
              }}
            >
              Контакт
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
