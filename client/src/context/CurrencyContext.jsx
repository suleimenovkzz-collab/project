import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DISPLAY_CURRENCY_KEY } from "../lib/constants";
import { resolvePrice } from "../lib/money";
import { loadShopConfig } from "../lib/shopConfig";
import { storageGet, storageSet } from "../lib/storage";

const CurrencyContext = createContext(null);

function readCurrency() {
  const saved = storageGet(DISPLAY_CURRENCY_KEY) || "KZT";
  return ["KZT", "USD", "RUB"].includes(saved) ? saved : "KZT";
}

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState(() => readCurrency());
  const [ratesVersion, setRatesVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadShopConfig().then(() => {
      if (!cancelled) setRatesVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((next) => {
    const value = ["KZT", "USD", "RUB"].includes(next) ? next : "KZT";
    storageSet(DISPLAY_CURRENCY_KEY, value);
    setCurrencyState(value);
  }, []);

  const priceOf = useCallback(
    (service) => resolvePrice(service, currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, ratesVersion]
  );

  const value = useMemo(
    () => ({ currency, setCurrency, priceOf, ratesVersion }),
    [currency, setCurrency, priceOf, ratesVersion]
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
