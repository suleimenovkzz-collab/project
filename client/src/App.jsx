import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import PublicLayout from "./components/PublicLayout";
import Admin from "./pages/admin/Admin";
import Cart from "./pages/Cart";
import Home from "./pages/Home";
import Products from "./pages/Products";

export default function App() {
  return (
    <ErrorBoundary message="Сайт временно недоступен. Обновите страницу.">
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/products.html" element={<Navigate to="/products" replace />} />
            <Route path="/cart.html" element={<Navigate to="/cart" replace />} />
          </Route>
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
