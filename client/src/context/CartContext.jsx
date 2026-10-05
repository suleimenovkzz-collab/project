import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CART_KEY } from "../lib/constants";
import { cartTotal as calcTotal, getStockLimit, unitPriceKzt } from "../lib/money";
import { getMaxQtyPerItem } from "../lib/shopConfig";
import { storageGet, storageSet } from "../lib/storage";

const CartContext = createContext(null);

function qtyCap(stock) {
  const perOrder = getMaxQtyPerItem();
  return stock === null ? perOrder : Math.max(1, Math.min(perOrder, stock));
}

function sanitizeImage(value) {
  const image = String(value || "").trim();
  if (image.startsWith("/uploads/") || image.startsWith("https://")) return image;
  return "";
}

function readCart() {
  try {
    const raw = storageGet(CART_KEY);
    const data = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => {
        if (!item || item.id == null || item.id === "") return null;
        return {
          id: item.id,
          title: String(item.title || ""),
          priceTenge: Math.max(0, Number(item.priceTenge) || 0),
          image: sanitizeImage(item.image),
          qty: Math.min(getMaxQtyPerItem(), Math.max(1, Number(item.qty) || 1)),
          maxQty: Math.min(getMaxQtyPerItem(), Math.max(1, Number(item.maxQty) || 1)),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => readCart());

  useEffect(() => {
    storageSet(CART_KEY, JSON.stringify(items));
  }, [items]);

  const count = useMemo(
    () => items.reduce((sum, item) => sum + (item.qty || 1), 0),
    [items]
  );

  const total = useMemo(() => calcTotal(items), [items]);

  const isInCart = useCallback(
    (id) => items.some((item) => item.id === id),
    [items]
  );

  const addToCart = useCallback((service) => {
    if (!service?.id) return false;
    const stock = getStockLimit(service);
    if (stock !== null && stock < 1) return false;
    setItems((prev) => {
      if (prev.some((item) => item.id === service.id)) return prev;
      return [
        ...prev,
        {
          id: service.id,
          title: String(service.title || ""),
          priceTenge: Math.max(0, Number(service.priceTenge) || 0),
          image: sanitizeImage(service.image),
          qty: 1,
          maxQty: qtyCap(stock),
        },
      ];
    });
    return true;
  }, []);

  const removeFromCart = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const setCartQty = useCallback((id, qty) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const cap = Math.min(getMaxQtyPerItem(), Math.max(1, Number(item.maxQty) || 1));
        const nextQty = Math.min(cap, Math.max(1, Number(qty) || 1));
        return { ...item, qty: nextQty };
      })
    );
  }, []);

  const changeCartQty = useCallback((id, delta) => {
    setItems((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (!item) return prev;
      const cap = Math.min(getMaxQtyPerItem(), Math.max(1, Number(item.maxQty) || 1));
      const nextQty = (item.qty || 1) + delta;
      if (nextQty < 1) return prev.filter((entry) => entry.id !== id);
      return prev.map((entry) =>
        entry.id === id
          ? { ...entry, qty: Math.min(cap, nextQty) }
          : entry
      );
    });
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  /** Re-price and drop unavailable lines against fresh catalog. */
  const syncWithCatalog = useCallback((catalog) => {
    if (!Array.isArray(catalog)) return { removed: 0, updated: 0 };
    const byId = new Map(
      catalog.map((service) => [String(service.id), service])
    );
    const stats = { removed: 0, updated: 0 };

    setItems((prev) => {
      let removed = 0;
      let updated = 0;
      const next = [];
      for (const item of prev) {
        const service = byId.get(String(item.id));
        if (!service) {
          removed += 1;
          continue;
        }
        const stock = getStockLimit(service);
        if (stock !== null && stock < 1) {
          removed += 1;
          continue;
        }
        const maxQty = qtyCap(stock);
        const qty = Math.min(item.qty || 1, maxQty);
        const priceTenge = unitPriceKzt(service);
        const title = String(service.title || "");
        const image = sanitizeImage(service.image);
        if (
          priceTenge !== item.priceTenge ||
          title !== item.title ||
          image !== item.image ||
          qty !== item.qty
        ) {
          updated += 1;
        }
        next.push({
          id: service.id,
          title,
          priceTenge,
          image,
          qty,
          maxQty,
        });
      }
      stats.removed = removed;
      stats.updated = updated;
      return next;
    });

    return stats;
  }, []);

  const value = useMemo(
    () => ({
      items,
      count,
      total,
      isInCart,
      addToCart,
      removeFromCart,
      setCartQty,
      changeCartQty,
      clearCart,
      syncWithCatalog,
    }),
    [
      items,
      count,
      total,
      isInCart,
      addToCart,
      removeFromCart,
      setCartQty,
      changeCartQty,
      clearCart,
      syncWithCatalog,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
