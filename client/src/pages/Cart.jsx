import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchServices } from "../api/services";
import Footer from "../components/Footer";
import Header from "../components/Header";
import MobileCta from "../components/MobileCta";
import ProductImage from "../components/ProductImage";
import { useCart } from "../context/CartContext";
import { useOrderModal } from "../context/OrderModalContext";
import { formatTenge } from "../lib/money";
import { loadShopConfig } from "../lib/shopConfig";

export default function Cart() {
  const { items, total, changeCartQty, removeFromCart, syncWithCatalog } =
    useCart();
  const { openOrderModal } = useOrderModal();
  const [syncNote, setSyncNote] = useState("");
  const empty = items.length === 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadShopConfig();
        const catalog = await fetchServices();
        if (cancelled) return;
        const { removed, updated } = syncWithCatalog(catalog);
        if (removed || updated) {
          setSyncNote(
            removed
              ? "Часть позиций удалена или закончилась — корзина обновлена."
              : "Цены и количество в корзине обновлены по каталогу."
          );
        }
      } catch {
        // Keep local cart if catalog is temporarily unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncWithCatalog]);

  return (
    <div className="page-products">
      <Header variant="inner" />
      <main className="products-main">
        <section className="section products-hero">
          <div className="section-intro">
            <p className="eyebrow">Заказ</p>
            <h1 className="display-title">Корзина</h1>
            <p className="section-lead">
              Меняйте количество, удаляйте лишнее и оформляйте заказ через
              WhatsApp или Telegram.
            </p>
          </div>
        </section>

        <section className="section cart-section">
          {syncNote ? (
            <p className="services-empty" role="status">
              {syncNote}
            </p>
          ) : null}

          {empty ? (
            <p id="cart-empty" className="services-empty">
              Корзина пуста. Добавьте услуги на странице товаров.
            </p>
          ) : null}

          {!empty ? (
            <div className="cart-layout">
              <div id="cart-list" className="cart-list">
                {items.map((item) => (
                  <article key={item.id} className="cart-item" data-id={item.id}>
                    <div className="cart-item-photo">
                      <ProductImage src={item.image} alt={item.title} lazy={false} />
                    </div>
                    <div className="cart-item-body">
                      <h3>{item.title}</h3>
                      <p className="cart-item-price">
                        {formatTenge(item.priceTenge)} / шт.
                      </p>
                      <p className="cart-item-sum">
                        Сумма:{" "}
                        {formatTenge((item.priceTenge || 0) * (item.qty || 1))}
                      </p>
                    </div>
                    <div className="cart-item-controls">
                      <div className="qty-stepper" aria-label="Количество">
                        <button
                          type="button"
                          className="qty-btn qty-minus"
                          aria-label="Уменьшить"
                          onClick={() => changeCartQty(item.id, -1)}
                        >
                          −
                        </button>
                        <span className="qty-value">{item.qty || 1}</span>
                        <button
                          type="button"
                          className="qty-btn qty-plus"
                          aria-label="Увеличить"
                          onClick={() => changeCartQty(item.id, 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="cart-remove"
                        aria-label="Удалить"
                        onClick={() => removeFromCart(item.id)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" />
                        </svg>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="cart-checkout">
                <div className="cart-total-row">
                  <span>Итого</span>
                  <strong id="cart-total">{formatTenge(total)}</strong>
                </div>
                <button
                  type="button"
                  id="cart-checkout"
                  className="btn btn-whatsapp"
                  onClick={() =>
                    openOrderModal({
                      source: "cart",
                      items,
                    })
                  }
                >
                  Оформить заказ
                </button>
                <Link className="btn-line" to="/products">
                  Добавить ещё
                </Link>
              </aside>
            </div>
          ) : null}
        </section>
      </main>
      <Footer variant="cart" />
      <MobileCta />
    </div>
  );
}
