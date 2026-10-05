import { CONTACT_WHATSAPP_HREF } from "../lib/constants";

export default function CatalogError({ onRetry }) {
  return (
    <div className="catalog-error" role="alert">
      <p className="catalog-error-title">Каталог временно недоступен</p>
      <p className="catalog-error-text">
        Не удалось загрузить услуги и товары — возможно, сервер обновляется или пропал интернет.
        Попробуйте ещё раз или напишите нам — подскажем цены и запишем.
      </p>
      <div className="catalog-error-actions">
        <button type="button" className="btn btn-line" onClick={onRetry}>
          Попробовать снова
        </button>
        <a
          className="btn btn-whatsapp"
          href={CONTACT_WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
        >
          Написать в WhatsApp
        </a>
      </div>
    </div>
  );
}
