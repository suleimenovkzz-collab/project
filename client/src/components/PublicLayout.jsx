import { Outlet, useLocation } from "react-router-dom";
import EllaChat from "./EllaChat";
import ErrorBoundary from "./ErrorBoundary";
import { CartProvider } from "../context/CartContext";
import { ContactModalProvider } from "../context/ContactModalContext";
import { CurrencyProvider } from "../context/CurrencyContext";
import { OrderModalProvider } from "../context/OrderModalContext";
import { ToastProvider } from "../context/ToastContext";
import "../styles/styles.css";

function PageOutlet() {
  const location = useLocation();
  return (
    <ErrorBoundary
      key={location.pathname}
      message="Не удалось открыть страницу. Обновите или вернитесь на главную."
    >
      <Outlet />
    </ErrorBoundary>
  );
}

export default function PublicLayout() {
  return (
    <CartProvider>
      <CurrencyProvider>
        <ToastProvider>
          <ContactModalProvider>
            <OrderModalProvider>
              <PageOutlet />
              <ErrorBoundary
                fallback={
                  <div className="ella-root" role="status">
                    <p className="ella-crash">Чат временно недоступен.</p>
                  </div>
                }
              >
                <EllaChat />
              </ErrorBoundary>
            </OrderModalProvider>
          </ContactModalProvider>
        </ToastProvider>
      </CurrencyProvider>
    </CartProvider>
  );
}
