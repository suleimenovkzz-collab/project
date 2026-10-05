import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/admin";
import ErrorBoundary from "../../components/ErrorBoundary";
import { AuthProvider, useAuth } from "../../context/AuthContext";
import {
  buildClients,
  CHANNEL_LABELS,
  clientWhatsAppLink,
  formatDate,
  formatPrice,
  SOURCE_LABELS,
  STATUS_LABELS,
  TAB_TITLES,
  typeLabel,
} from "./adminUtils";
import { downloadCatalogPdf } from "../../lib/catalogPdf";
import { downloadInvoice } from "../../lib/invoicePdf";
import "../../styles/admin.css";

function LoadError({ message, onRetry }) {
  return (
    <div className="load-error" role="alert">
      <p>{message}</p>
      <button type="button" className="ghost" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

function AdminLogin({ onSuccess }) {
  const { login, notice } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const value = password.trim();
    if (!value) {
      setError("Введите пароль");
      return;
    }
    try {
      await login(value);
      onSuccess();
    } catch (err) {
      setError(err.message || "Неверный пароль");
    }
  }

  return (
    <section id="login-view" className="card login-card">
      <h2>Вход в админку</h2>
      {notice ? (
        <p className="login-notice" role="status">
          {notice}
        </p>
      ) : null}
      <p className="hint">Введите пароль администратора</p>
      <form id="login-form" onSubmit={handleSubmit}>
        <label>
          Пароль
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn-primary">
          Войти
        </button>
        {error ? (
          <p id="login-error" className="error">
            {error}
          </p>
        ) : (
          <p id="login-error" className="error" hidden />
        )}
      </form>
    </section>
  );
}

function ServiceModal({ open, mode, initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    id: "",
    title: "",
    description: "",
    priceTenge: "",
    currency: "KZT",
    type: "product",
    quantity: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [currentImage, setCurrentImage] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const quantity =
        initial.quantity === undefined ||
        initial.quantity === null ||
        initial.quantity === ""
          ? ""
          : String(initial.quantity);
      setForm({
        id: initial.id || "",
        title: initial.title || "",
        description: initial.description || "",
        priceTenge: initial.priceTenge ?? "",
        currency: initial.currency || "KZT",
        type: initial.type === "service" ? "service" : "product",
        quantity,
        quantityExpected: quantity,
      });
      setCurrentImage(initial.image || "");
    } else {
      setForm({
        id: "",
        title: "",
        description: "",
        priceTenge: "",
        currency: "KZT",
        type: "product",
        quantity: "",
      });
      setCurrentImage("");
    }
    setImageFile(null);
    setImagePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    setMessage("");
    setIsError(false);
  }, [open, initial]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (savingRef.current) return;
    setMessage("");

    if (!form.title.trim()) {
      setMessage("Укажите название");
      setIsError(true);
      return;
    }
    if (!String(form.priceTenge).trim()) {
      setMessage("Укажите цену");
      setIsError(true);
      return;
    }
    if (!form.description.trim()) {
      setMessage("Укажите описание товара");
      setIsError(true);
      return;
    }
    if (!form.id && !imageFile && !currentImage) {
      setMessage("Добавьте фото товара");
      setIsError(true);
      return;
    }

    const body = new FormData();
    body.append("title", form.title.trim());
    body.append("description", form.description.trim());
    body.append("priceTenge", String(form.priceTenge).trim());
    body.append("currency", form.currency);
    body.append("type", form.type);
    body.append("quantity", String(form.quantity).trim());
    if (form.id) {
      body.append("quantityExpected", String(form.quantityExpected ?? "").trim());
    }
    if (imageFile) {
      body.append("image", imageFile);
    } else if (currentImage) {
      body.append("image", currentImage);
    } else if (form.id) {
      body.append("image", "");
    }

    savingRef.current = true;
    setSaving(true);
    try {
      if (form.id) {
        await adminApi(`/api/services/${form.id}`, { method: "PUT", body });
      } else {
        await adminApi("/api/services", { method: "POST", body });
      }
      onSaved();
      onClose();
    } catch (error) {
      setMessage(error.message);
      setIsError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const previewSrc = imagePreviewUrl || currentImage || "";

  return (
    <div
      id="modal"
      className={`modal${open ? "" : " hidden"}`}
      aria-hidden={open ? "false" : "true"}
    >
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
      >
        <div className="modal-head">
          <h2 id="form-title">
            {mode === "edit" ? "Изменить товар" : "Новый товар"}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <form id="service-form" encType="multipart/form-data" onSubmit={handleSubmit}>
          <label>
            Название
            <input
              type="text"
              name="title"
              required
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </label>

          <div className="form-row">
            <label>
              Цена
              <input
                type="number"
                name="priceTenge"
                min="0"
                step="1"
                required
                value={form.priceTenge}
                onChange={(e) => setField("priceTenge", e.target.value)}
              />
            </label>
            <label>
              Валюта
              <select
                name="currency"
                required
                value={form.currency}
                onChange={(e) => setField("currency", e.target.value)}
              >
                <option value="KZT">Тенге (₸)</option>
                <option value="USD">Доллары ($)</option>
                <option value="RUB">Рубли (₽)</option>
              </select>
            </label>
          </div>

          <div className="form-row">
            <label>
              Количество
              <input
                type="number"
                name="quantity"
                min="0"
                step="1"
                placeholder="пусто = безлимит"
                value={form.quantity}
                onChange={(e) => setField("quantity", e.target.value)}
              />
            </label>
            <label>
              Тип
              <select
                name="type"
                required
                value={form.type}
                onChange={(e) => setField("type", e.target.value)}
              >
                <option value="product">Товар</option>
                <option value="service">Услуга</option>
              </select>
            </label>
          </div>

          <label>
            Описание товара
            <textarea
              name="description"
              rows="5"
              placeholder="Кратко опишите товар или услугу"
              required
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </label>

          <div className="photo-field">
            <span className="photo-label">Фото товара</span>
            <label className="photo-drop">
              <input
                type="file"
                name="image"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setImageFile(file);
                  setCurrentImage("");
                  setImagePreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return URL.createObjectURL(file);
                  });
                }}
              />
              <span className="photo-drop-title">Загрузить фото</span>
              <span className="photo-drop-hint">
                Нажмите или выберите файл (JPG, PNG, WEBP)
              </span>
            </label>
            <div
              id="image-preview-wrap"
              className={`preview-wrap${previewSrc ? "" : " hidden"}`}
            >
              {previewSrc ? (
                <img id="image-preview" alt="Превью фото" src={previewSrc} />
              ) : null}
              <button
                type="button"
                id="clear-photo-btn"
                className="ghost"
                onClick={() => {
                  setImageFile(null);
                  setCurrentImage("");
                  setImagePreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return "";
                  });
                }}
              >
                Убрать фото
              </button>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              id="save-btn"
              className="btn-primary"
              disabled={saving}
              aria-busy={saving ? "true" : "false"}
            >
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
          {message ? (
            <p id="form-message" className={isError ? "error" : "ok"}>
              {message}
            </p>
          ) : (
            <p id="form-message" className="ok" hidden />
          )}
        </form>
      </div>
    </div>
  );
}

function AdminApp() {
  const { authenticated, checking, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("catalog");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editing, setEditing] = useState(null);

  /** Never throws: the error is kept in state and rendered instead of a misleading empty list. */
  async function loadList() {
    setServicesLoading(true);
    try {
      const data = await adminApi("/api/services");
      setServices(Array.isArray(data) ? data : []);
      setServicesError("");
    } catch (error) {
      setServicesError(error.message || "Не удалось загрузить каталог");
    } finally {
      setServicesLoading(false);
    }
  }

  async function loadOrders() {
    setOrdersLoading(true);
    try {
      const data = await adminApi("/api/orders");
      setOrders(Array.isArray(data) ? data : []);
      setOrdersError("");
    } catch (error) {
      setOrdersError(error.message || "Не удалось загрузить заказы");
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (!authenticated) return;
    loadList();
    loadOrders();
  }, [authenticated]);

  const newOrdersCount = useMemo(
    () => orders.filter((item) => (item.status || "new") === "new").length,
    [orders]
  );

  const clientsAll = useMemo(
    () => buildClients(orders, { applyStatusFilter: false }),
    [orders]
  );

  const clientsFiltered = useMemo(
    () =>
      buildClients(orders, {
        applyStatusFilter: true,
        orderStatusFilter,
      }),
    [orders, orderStatusFilter]
  );

  const filteredOrders = useMemo(() => {
    if (orderStatusFilter === "all") return orders;
    return orders.filter((order) => (order.status || "new") === orderStatusFilter);
  }, [orders, orderStatusFilter]);

  const statusCounts = useMemo(() => {
    const counts = {
      all: orders.length,
      new: 0,
      contacted: 0,
      done: 0,
      cancelled: 0,
    };
    orders.forEach((order) => {
      const status = order.status || "new";
      if (counts[status] != null) counts[status] += 1;
    });
    return counts;
  }, [orders]);

  if (checking) {
    return (
      <div className="wrap">
        <p className="empty">Проверяем сессию…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="wrap">
        <AdminLogin
          onSuccess={() => {
            setActiveTab("catalog");
            setModalOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="wrap">
      <section id="admin-view">
        <header className="top">
          <h1 id="admin-page-title">{TAB_TITLES[activeTab] || "Список"}</h1>
          <div className="top-actions">
            <Link className="ghost" to="/" target="_blank">
              Открыть сайт
            </Link>
            <button
              type="button"
              id="download-catalog-pdf-btn"
              className="ghost"
              hidden={activeTab !== "catalog"}
              onClick={() =>
                downloadCatalogPdf("all").catch((error) => alert(error.message))
              }
            >
              Скачать каталог (PDF)
            </button>
            <button
              type="button"
              id="open-create-btn"
              className="btn-primary"
              hidden={activeTab !== "catalog"}
              onClick={() => {
                setEditing(null);
                setModalMode("create");
                setModalOpen(true);
              }}
            >
              + Новый товар
            </button>
            <button
              type="button"
              id="logout-btn"
              className="ghost"
              onClick={async () => {
                setModalOpen(false);
                await logout();
              }}
            >
              Выйти
            </button>
          </div>
        </header>

        <nav className="admin-tabs" aria-label="Разделы админки">
          {[
            ["catalog", "Товары"],
            ["orders", "Заказы"],
            ["clients", "Клиенты"],
          ].map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={`admin-tab${activeTab === tab ? " is-active" : ""}`}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "orders" || tab === "clients") loadOrders();
              }}
            >
              {label}{" "}
              {tab === "orders" ? (
                <span
                  id="orders-badge"
                  className="tab-badge"
                  hidden={newOrdersCount === 0}
                >
                  {newOrdersCount}
                </span>
              ) : null}
              {tab === "clients" ? (
                <span
                  id="clients-badge"
                  className="tab-badge"
                  hidden={clientsAll.length === 0}
                >
                  {clientsAll.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div
          id="status-filters"
          className={`status-filters${
            activeTab === "orders" || activeTab === "clients" ? "" : " hidden"
          }`}
          aria-label="Фильтр по статусу"
        >
          {["all", "new", "contacted", "done", "cancelled"].map((status) => (
            <button
              key={status}
              type="button"
              className={`status-filter${
                orderStatusFilter === status ? " is-active" : ""
              }`}
              onClick={() => setOrderStatusFilter(status)}
            >
              {status === "all" ? "Все" : STATUS_LABELS[status]}{" "}
              <span>{statusCounts[status] || 0}</span>
            </button>
          ))}
        </div>

        {activeTab === "catalog" ? (
          <div id="catalog-panel">
            {servicesError ? <LoadError message={servicesError} onRetry={loadList} /> : null}
            <div id="admin-list" className="admin-grid">
              {!services.length ? (
                servicesError ? null : servicesLoading ? (
                  <p className="empty">Загружаем каталог…</p>
                ) : (
                  <p className="empty">Пока пусто — нажмите «+ Новый товар».</p>
                )
              ) : (
                services.map((item) => {
                  const currency = item.currency || "KZT";
                  const type = item.type || "product";
                  const quantityLabel =
                    item.quantity === undefined ||
                    item.quantity === null ||
                    item.quantity === ""
                      ? "безлимит"
                      : String(item.quantity);
                  const price =
                    item.priceTenge != null
                      ? formatPrice(item.priceTenge, currency)
                      : "";
                  return (
                    <article key={item.id} className="item" data-id={item.id}>
                      {item.image ? (
                        <img
                          className="item-image"
                          src={item.image}
                          alt={item.title}
                        />
                      ) : (
                        <div className="item-image item-image--empty">Нет фото</div>
                      )}
                      <div className="item-body">
                        <div className="item-meta">
                          <span className="badge badge-type">{typeLabel(type)}</span>
                          <span className="badge badge-qty">
                            Кол-во: {quantityLabel}
                          </span>
                        </div>
                        <h3 className="item-title">{item.title}</h3>
                        {price ? <p className="item-price">{price}</p> : null}
                        <p className="item-desc">
                          {item.description || "Без описания"}
                        </p>
                        <div className="item-actions">
                          <button
                            type="button"
                            className="ghost edit-btn"
                            onClick={() => {
                              setEditing(item);
                              setModalMode("edit");
                              setModalOpen(true);
                            }}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="ghost danger delete-btn"
                            onClick={async () => {
                              if (!window.confirm("Удалить эту позицию?")) return;
                              try {
                                await adminApi(`/api/services/${item.id}`, {
                                  method: "DELETE",
                                });
                                await loadList();
                              } catch (error) {
                                alert(error.message);
                              }
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "orders" ? (
          <div id="orders-panel">
            {ordersError ? <LoadError message={ordersError} onRetry={loadOrders} /> : null}
            <div id="orders-list" className="orders-list">
              {ordersError && !orders.length ? null : ordersLoading && !orders.length ? (
                <p className="empty">Загружаем заявки…</p>
              ) : !orders.length ? (
                <p className="empty">
                  Заявок пока нет. Они появятся, когда клиент оформит заказ на
                  сайте.
                </p>
              ) : !filteredOrders.length ? (
                <p className="empty">
                  Нет заявок со статусом «
                  {STATUS_LABELS[orderStatusFilter] || orderStatusFilter}».
                </p>
              ) : (
                filteredOrders.map((order) => {
                  const items = Array.isArray(order.items) ? order.items : [];
                  const status = order.status || "new";
                  const whatsappHref = clientWhatsAppLink(order);
                  const savedMessage = String(
                    order.message || order.whatsappMessage || ""
                  ).trim();
                  const customerNote = String(order.customerNote || "").trim();
                  return (
                    <article
                      key={order.id}
                      className="order-card"
                      data-id={order.id}
                    >
                      <div className="order-head">
                        <div>
                          <p className="order-meta">
                            {formatDate(order.createdAt)} ·{" "}
                            {SOURCE_LABELS[order.source] || order.source || "заказ"}{" "}
                            ·{" "}
                            {CHANNEL_LABELS[order.channel] ||
                              order.channel ||
                              "WhatsApp"}
                          </p>
                          <h3>{order.customerName || "Без имени"}</h3>
                          <a
                            className="order-phone"
                            href={`tel:${order.customerPhone || ""}`}
                          >
                            {order.customerPhone || "—"}
                          </a>
                        </div>
                        <span className={`order-status status-${status}`}>
                          {STATUS_LABELS[status] || status}
                        </span>
                      </div>
                      <ul className="order-items">
                        {items.map((item, i) => (
                          <li key={`${order.id}-${i}`}>
                            {item.title} × {item.qty || 1} —{" "}
                            {formatPrice(
                              item.priceTenge * (item.qty || 1),
                              "KZT"
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="order-total">
                        Итого: {formatPrice(order.totalTenge || 0, "KZT")}
                      </p>
                      {savedMessage ? (
                        <p className="order-message">
                          <span>Сообщение клиента</span>
                          {savedMessage}
                        </p>
                      ) : null}
                      {customerNote ? (
                        <p className="order-note">
                          <span>Заметка</span>
                          {customerNote}
                        </p>
                      ) : null}
                      <div className="order-actions">
                        <label>
                          Статус
                          <select
                            className="order-status-select"
                            value={status}
                            onChange={async (e) => {
                              try {
                                await adminApi(`/api/orders/${order.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: e.target.value }),
                                });
                                await loadOrders();
                              } catch (error) {
                                alert(error.message);
                                await loadOrders();
                              }
                            }}
                          >
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="order-action-btns">
                          <button
                            type="button"
                            className="ghost order-invoice-btn"
                            onClick={() =>
                              downloadInvoice(order.id).catch((error) => alert(error.message))
                            }
                          >
                            Скачать счёт (PDF)
                          </button>
                          {whatsappHref ? (
                            <a
                              className="btn-whatsapp-order"
                              href={whatsappHref}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              WhatsApp
                            </a>
                          ) : (
                            <span
                              className="btn-whatsapp-order is-disabled"
                              title="Нет телефона"
                            >
                              WhatsApp
                            </span>
                          )}
                          <button
                            type="button"
                            className="ghost danger order-delete-btn"
                            onClick={async () => {
                              if (!window.confirm("Удалить эту заявку?")) return;
                              try {
                                await adminApi(`/api/orders/${order.id}`, {
                                  method: "DELETE",
                                });
                                await loadOrders();
                              } catch (error) {
                                alert(error.message);
                              }
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "clients" ? (
          <div id="clients-panel">
            {ordersError ? <LoadError message={ordersError} onRetry={loadOrders} /> : null}
            <div id="clients-list" className="clients-list">
              {ordersError && !orders.length ? null : ordersLoading && !orders.length ? (
                <p className="empty">Загружаем клиентов…</p>
              ) : !orders.length ? (
                <p className="empty">
                  Клиентов пока нет — они появятся из заявок.
                </p>
              ) : !clientsFiltered.length ? (
                <p className="empty">Нет клиентов по выбранному статусу.</p>
              ) : (
                clientsFiltered.map((client) => {
                  const order = client.lastOrder || {
                    customerName: client.name,
                    customerPhone: client.phone,
                    items: client.titles.map((title) => ({
                      title,
                      qty: 1,
                      priceTenge: 0,
                    })),
                  };
                  const whatsappHref = clientWhatsAppLink(order);
                  const statusBits = Object.entries(client.statuses)
                    .map(
                      ([status, count]) =>
                        `${STATUS_LABELS[status] || status}: ${count}`
                    )
                    .join(" · ");

                  return (
                    <article key={client.phoneKey} className="client-card">
                      <div className="client-head">
                        <div>
                          <p className="order-meta">
                            {formatDate(client.lastOrderAt)} · заказов:{" "}
                            {client.ordersCount}
                          </p>
                          <h3>{client.name}</h3>
                          <a className="order-phone" href={`tel:${client.phone}`}>
                            {client.phone || "—"}
                          </a>
                        </div>
                      </div>
                      <ul className="order-items">
                        {client.titles.length ? (
                          client.titles.map((title) => (
                            <li key={title}>{title}</li>
                          ))
                        ) : (
                          <li>Без позиций</li>
                        )}
                      </ul>
                      <p className="order-total">
                        Сумма заявок: {formatPrice(client.totalTenge, "KZT")}
                      </p>
                      <p className="client-status-line">{statusBits}</p>
                      <div className="order-action-btns">
                        {whatsappHref ? (
                          <a
                            className="btn-whatsapp-order"
                            href={whatsappHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            WhatsApp
                          </a>
                        ) : (
                          <span
                            className="btn-whatsapp-order is-disabled"
                            title="Нет телефона"
                          >
                            WhatsApp
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </section>

      <ServiceModal
        open={modalOpen}
        mode={modalMode}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={loadList}
      />
    </div>
  );
}

export default function Admin() {
  useEffect(() => {
    document.documentElement.classList.add("admin-app");
    return () => document.documentElement.classList.remove("admin-app");
  }, []);

  return (
    <AuthProvider>
      <ErrorBoundary
        className="wrap"
        message="Админка не смогла открыться. Обновите страницу."
      >
        <AdminApp />
      </ErrorBoundary>
    </AuthProvider>
  );
}
