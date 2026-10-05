import { useEffect, useMemo, useState } from "react";
import { fetchServices } from "../api/services";
import CatalogError from "../components/CatalogError";
import Footer from "../components/Footer";
import Header from "../components/Header";
import MobileCta from "../components/MobileCta";
import ProductCard from "../components/ProductCard";
import { useCurrency } from "../context/CurrencyContext";
import { useToast } from "../context/ToastContext";
import { downloadCatalogPdf } from "../lib/catalogPdf";

export default function Products() {
  const [services, setServices] = useState(null);
  const [error, setError] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const { currency, setCurrency } = useCurrency();
  const { showToast } = useToast();

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchServices()
      .then((data) => {
        if (!cancelled) setServices(data);
      })
      .catch((loadError) => {
        console.error("[catalog] load failed:", loadError);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setError(false);
    setServices(null);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 160);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    if (!Array.isArray(services)) return [];
    const query = searchDebounced.trim().toLowerCase();
    return services.filter((item) => {
      const type = item.type || "product";
      const typeOk = typeFilter === "all" || type === typeFilter;
      if (!typeOk) return false;
      if (!query) return true;
      const hay = `${item.title || ""} ${item.description || ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [services, typeFilter, searchDebounced]);

  return (
    <div className="page-products">
      <Header variant="inner" />
      <main className="products-main">
        <section className="section products-hero">
          <div className="section-intro">
            <p className="eyebrow">Каталог</p>
            <h1 className="display-title">Услуги и товары</h1>
            <p className="section-lead">
              Цены — ориентиры «от». Фильтруйте, добавляйте в корзину или
              записывайтесь сразу.
            </p>
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <span className="visually-hidden">Поиск</span>
                <input
                  type="search"
                  id="filter-search"
                  placeholder="Поиск: виниры, имплант…"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="catalog-chips" role="group" aria-label="Тип">
                {[
                  ["all", "Все"],
                  ["service", "Услуги"],
                  ["product", "Товары"],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    className={`catalog-chip${typeFilter === type ? " is-active" : ""}`}
                    onClick={() => setTypeFilter(type)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-line catalog-pdf-btn"
                onClick={() =>
                  downloadCatalogPdf(typeFilter).catch((pdfError) => showToast(pdfError.message))
                }
              >
                Скачать каталог в PDF
              </button>
              <label className="catalog-currency">
                Валюта
                <select
                  id="filter-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="KZT">Тенге (₸)</option>
                  <option value="USD">Доллары ($)</option>
                  <option value="RUB">Рубли (₽)</option>
                </select>
              </label>
              <p id="catalog-count" className="catalog-count" aria-live="polite">
                {services === null
                  ? ""
                  : filtered.length
                    ? `Найдено: ${filtered.length}`
                    : "Ничего не найдено"}
              </p>
            </div>
          </div>
        </section>

        <section className="section services products-catalog">
          <div className="products-grid" id="products-list">
            {error ? (
              <CatalogError onRetry={retry} />
            ) : services === null ? (
              <p className="services-loading">Загружаем товары…</p>
            ) : services.length === 0 ? (
              <p className="services-empty">
                Каталог скоро пополнится. Пока можно записаться в WhatsApp.
              </p>
            ) : filtered.length === 0 ? (
              <p className="services-empty">
                Нет позиций по выбранному фильтру. Попробуйте другой запрос.
              </p>
            ) : (
              filtered.map((service, index) => (
                <ProductCard key={service.id} service={service} index={index} />
              ))
            )}
          </div>
        </section>
      </main>
      <Footer variant="products" />
      <MobileCta />
    </div>
  );
}
