import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchServices } from "../api/services";
import CatalogError from "../components/CatalogError";
import Footer from "../components/Footer";
import Header from "../components/Header";
import MobileCta from "../components/MobileCta";
import ProductCard from "../components/ProductCard";
import { useContactModal } from "../context/ContactModalContext";
import {
  CLINIC_ADDRESS,
  CLINIC_MAP_URL,
  CONTACT_WHATSAPP_HREF,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  PHONE_DISPLAY,
  WHATSAPP_HREF,
} from "../lib/constants";

export default function Home() {
  const [services, setServices] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { openContactModal } = useContactModal();
  const location = useLocation();

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
    if (location.hash === "#contact") {
      openContactModal();
    }
  }, [location.hash, openContactModal]);

  const preview = Array.isArray(services) ? services.slice(0, 4) : [];

  return (
    <>
      <Header variant="home" />
      <main id="top">
        <section className="hero">
          <img
            className="hero-photo"
            src="https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=2400&q=85"
            alt="Эстетическая стоматология"
            width="2400"
            height="1600"
          />
          <div className="hero-shade" aria-hidden="true" />
          <div className="hero-content">
            <p className="hero-meta">Астана · семейная стоматология</p>
            <h1 className="hero-name">
              Клиника
              <br />
              доктора
              <br />
              Сулейменова
            </h1>
            <p className="hero-lead">
              Импланты и виниры. Точная эстетика, спокойный приём и улыбка,
              которую хочется показывать.
            </p>
            <div className="hero-actions">
              <a
                className="btn btn-whatsapp"
                href={CONTACT_WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
              >
                Записаться в WhatsApp
              </a>
              <Link className="btn-line" to="/products">
                Смотреть услуги
              </Link>
            </div>
          </div>
        </section>

        <section id="about" className="section about">
          <div className="about-layout">
            <p className="eyebrow">О клинике</p>
            <h2 className="display-title">
              Семейная
              <br />
              стоматология
            </h2>
            <div className="about-copy">
              <p>
                Мы — семейная стоматология в Астане. Лечим взрослых и детей,
                чтобы вся семья могла доверить свои улыбки одним врачам.
              </p>
              <p>
                От профилактики и лечения до имплантов и виниров — спокойный
                приём, понятный план лечения и честные цены.
              </p>
            </div>
          </div>
        </section>

        <section id="services" className="section services">
          <div className="section-intro">
            <p className="eyebrow">Каталог</p>
            <h2 className="display-title">Услуги и товары</h2>
            <p className="section-lead">
              Ориентиры по цене. Точная стоимость — после осмотра.
            </p>
            <Link className="btn btn-line products-cta" to="/products">
              Открыть полный каталог
            </Link>
          </div>

          <div className="service-grid" id="services-preview">
            {error ? (
              <CatalogError onRetry={retry} />
            ) : services === null ? (
              <p className="services-loading">Загружаем…</p>
            ) : preview.length === 0 ? (
              <p className="services-empty">Товары скоро появятся.</p>
            ) : (
              preview.map((service, index) => (
                <ProductCard key={service.id} service={service} index={index} />
              ))
            )}
          </div>
        </section>

        <section id="faq" className="section faq">
          <div className="section-intro">
            <p className="eyebrow">Вопросы</p>
            <h2 className="display-title">Частые вопросы</h2>
            <p className="section-lead">
              Коротко о записи, ценах и консультации.
            </p>
          </div>
          <div className="faq-list">
            <details className="faq-item" open>
              <summary>Как записаться на приём?</summary>
              <p>
                Напишите в WhatsApp или оформите заявку через каталог — Алишер
                Галымханович ответит и предложит удобное время.
              </p>
            </details>
            <details className="faq-item">
              <summary>Цены на сайте окончательные?</summary>
              <p>
                Это ориентиры «от». Точный план и стоимость врач определяет после
                осмотра — без скрытых сюрпризов в переписке.
              </p>
            </details>
            <details className="faq-item">
              <summary>Можно прислать фото заранее?</summary>
              <p>
                Да. В чате ELLA или в WhatsApp можно прикрепить снимок — это
                поможет подготовиться к консультации, но не заменяет осмотр.
              </p>
            </details>
            <details className="faq-item">
              <summary>Где проходит приём?</summary>
              <p>
                {CLINIC_ADDRESS} (район Есиль).{" "}
                <a href={CLINIC_MAP_URL} target="_blank" rel="noopener noreferrer">
                  Открыть в 2ГИС
                </a>
                . Удобное время согласуем при записи.
              </p>
            </details>
          </div>
        </section>

        <section id="gallery" className="gallery">
          <div className="gallery-item gallery-item--wide">
            <img
              src="https://images.unsplash.com/photo-1609840114035-3c981b782dfe?auto=format&fit=crop&w=1800&q=85"
              alt="Стоматологический приём"
              width="1800"
              height="1200"
              loading="lazy"
            />
          </div>
          <div className="gallery-item">
            <img
              src="https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=1200&q=85"
              alt="Клиническая точность"
              width="1200"
              height="1500"
              loading="lazy"
            />
          </div>
          <div className="gallery-item">
            <img
              src="https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=1200&q=85"
              alt="Эстетика улыбки"
              width="1200"
              height="1500"
              loading="lazy"
            />
          </div>
        </section>

        <section id="contact" className="section contact">
          <p className="eyebrow">Запись</p>
          <h2 className="display-title">
            Напишите
            <br />
            напрямую
          </h2>
          <p className="contact-lead">
            Напишите в WhatsApp — ответим и согласуем удобное время.
          </p>
          <a
            className="btn btn-whatsapp contact-whatsapp"
            href={CONTACT_WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            Записаться в WhatsApp
          </a>
          <a
            className="contact-phone"
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
          >
            {PHONE_DISPLAY}
          </a>
          <a
            className="contact-handle"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            @{INSTAGRAM_HANDLE}
          </a>
          <a
            className="contact-city"
            href={CLINIC_MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {CLINIC_ADDRESS}
          </a>
        </section>
      </main>
      <Footer variant="home" />
      <MobileCta />
    </>
  );
}
