import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CLINIC_MAP_URL, INSTAGRAM_URL, WHATSAPP_HREF } from "../lib/constants";
import { storageGet, storageSet } from "../lib/storage";
import "../styles/ella-chat.css";

const WA_BASE = `${WHATSAPP_HREF}?text=`;
const SIZE_KEY = "ella-chat-size";
const MAX_FILES = 3;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

let ellaMsgSeq = 0;
function nextMsgId(prefix) {
  ellaMsgSeq += 1;
  return `${prefix}-${ellaMsgSeq}`;
}

function defaultHandoffUrl() {
  return (
    WA_BASE +
    encodeURIComponent(
      "Здравствуйте, Алишер Галымханович! Пишу после консультации с ELLA на сайте. Хочу записаться / уточнить детали."
    )
  );
}

function buildLocalHandoffUrl(history) {
  const userLines = history
    .filter((item) => item.role === "user")
    .map((item) => String(item.content || "").trim())
    .filter(Boolean)
    .slice(-4);

  const lastUser = userLines[userLines.length - 1] || "интересуется консультацией";
  const summary =
    userLines.length > 1
      ? userLines.map((line, i) => `${i + 1}) ${line}`).join("\n")
      : lastUser;

  const text =
    "Здравствуйте, Алишер Галымханович!\n\n" +
    "ELLA передаёт клиента с сайта.\n\n" +
    `Актуальный запрос:\n«${lastUser}»\n\n` +
    `Кратко из переписки:\n${summary}\n\n` +
    "Клиент готов продолжить с вами.";

  return WA_BASE + encodeURIComponent(text);
}

async function requestEllaReply({ clean, attach, history }) {
  const formData = new FormData();
  formData.append("message", clean);
  formData.append("history", JSON.stringify(history));
  attach.forEach((file) => formData.append("files", file, file.name));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/ella/chat", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.reply) {
      return { reply: data.reply, handoffUrl: data.handoff?.whatsappUrl || null };
    }
    if (response.status === 429) {
      return { error: data.error || "Слишком много сообщений подряд. Подождите немного и попробуйте снова." };
    }
    return { error: data.error || "ELLA временно недоступна. Напишите врачу в WhatsApp — он ответит сам." };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { error: "ELLA отвечает слишком долго. Попробуйте ещё раз или напишите врачу в WhatsApp." };
    }
    return { error: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз — или напишите врачу в WhatsApp." };
  } finally {
    clearTimeout(timer);
  }
}

function BotText({ text, whatsappUrl }) {
  const parts = [];
  const pattern = /(WhatsApp|Instagram|2ГИС|\/products\.html|\/products)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token === "WhatsApp") {
      parts.push(
        <a
          key={key++}
          className="ella-link"
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
      );
    } else if (token === "Instagram") {
      parts.push(
        <a
          key={key++}
          className="ella-link"
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Instagram
        </a>
      );
    } else if (token === "2ГИС") {
      parts.push(
        <a
          key={key++}
          className="ella-link"
          href={CLINIC_MAP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          2ГИС
        </a>
      );
    } else {
      parts.push(
        <Link key={key++} className="ella-link" to="/products">
          каталог услуг
        </Link>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string"
          ? part.split("\n").map((line, j, arr) => (
              <span key={`${i}-${j}`}>
                {line}
                {j < arr.length - 1 ? <br /> : null}
              </span>
            ))
          : part
      )}
    </>
  );
}

function loadSavedSize() {
  try {
    const raw = JSON.parse(storageGet(SIZE_KEY) || "{}");
    return {
      width: Number(raw.width) || null,
      height: Number(raw.height) || null,
    };
  } catch {
    return { width: null, height: null };
  }
}

export default function EllaChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [typing, setTyping] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState(defaultHandoffUrl);
  const [size, setSize] = useState(() => loadSavedSize());
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef(null);
  const messagesRef = useRef(null);
  const historyRef = useRef([]);
  const askChainRef = useRef(Promise.resolve());
  const fileInputRef = useRef(null);

  useEffect(() => {
    historyRef.current = messages;
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, typing]);

  const openChat = useCallback(() => {
    setOpen(true);
    setMessages((prev) => {
      if (prev.length) return prev;
      return [
        {
          id: "welcome",
          who: "bot",
          text: "Здравствуйте! Я ELLA — помощник на сайте. Подскажу по услугам и ценам или помогу записаться к Алишеру Галымхановичу. Можно прикрепить фото кнопкой +.",
          whatsappUrl: defaultHandoffUrl(),
        },
      ];
    });
  }, []);

  const bindResize = useCallback((mode) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startW = panel.getBoundingClientRect().width;
    const startH = panel.getBoundingClientRect().height;
    const maxW = Math.min(window.innerWidth - 24, 720);
    const maxH = Math.min(window.innerHeight - 24, 900);
    const minW = 280;
    const minH = 360;
    const handle = event.currentTarget;

    setResizing(true);
    handle.setPointerCapture(event.pointerId);

    function onMove(moveEvent) {
      let nextW = startW;
      let nextH = startH;
      if (mode === "w" || mode === "both") {
        nextW = Math.min(maxW, Math.max(minW, startW + (startX - moveEvent.clientX)));
      }
      if (mode === "h" || mode === "both") {
        nextH = Math.min(maxH, Math.max(minH, startH + (startY - moveEvent.clientY)));
      }
      setSize({ width: nextW, height: nextH });
    }

    function onUp(upEvent) {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizing(false);
      const rect = panel.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      storageSet(SIZE_KEY, JSON.stringify(next));
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }, []);

  function ask(text, files = [], retry = null) {
    const clean = String(text || "").trim();
    const attach = files.map((entry) => entry.file || entry);
    if (!clean && !attach.length) return;

    askChainRef.current = askChainRef.current
      .catch((error) => console.error("[ELLA] ask failed:", error))
      .then(() => runAsk(clean, attach, files, retry));
  }

  function appendMessage(message) {
    setMessages((prev) => {
      const next = [...prev, message];
      historyRef.current = next;
      return next;
    });
  }

  async function runAsk(clean, attach, files, retry) {
    let prior = historyRef.current;
    let userMsgId;

    if (retry) {
      userMsgId = retry.userMsgId;
      const at = prior.findIndex((node) => node.id === userMsgId);
      if (at >= 0) prior = prior.slice(0, at);
      setMessages((prev) => {
        const next = prev.filter((node) => node.id !== retry.errorId);
        historyRef.current = next;
        return next;
      });
    } else {
      userMsgId = nextMsgId("u");
      appendMessage({
        id: userMsgId,
        who: "user",
        text: clean || (attach.length ? "Файл" : ""),
        files: files.map((entry) => {
          if (entry.file) return entry;
          return {
            file: entry,
            previewUrl: entry.type.startsWith("image/")
              ? URL.createObjectURL(entry)
              : null,
          };
        }),
      });
    }

    const history = prior
      .filter((node) => node.kind !== "error")
      .slice(-8)
      .map((node) => ({
        role: node.who === "user" ? "user" : "assistant",
        content: node.text || "",
      }));
    const localHandoff = buildLocalHandoffUrl([
      ...history,
      {
        role: "user",
        content: clean || `[файл: ${attach.map((f) => f.name).join(", ")}]`,
      },
    ]);

    setTyping(true);
    try {
      const result = await requestEllaReply({ clean, attach, history });
      if (result.reply) {
        const nextHandoff = result.handoffUrl || localHandoff;
        setHandoffUrl(nextHandoff);
        appendMessage({
          id: nextMsgId("b"),
          who: "bot",
          text: result.reply,
          whatsappUrl: nextHandoff,
        });
      } else {
        setHandoffUrl(localHandoff);
        const errorId = nextMsgId("err");
        appendMessage({
          id: errorId,
          who: "bot",
          kind: "error",
          text: result.error,
          whatsappUrl: localHandoff,
          retry: { errorId, userMsgId, text: clean, files },
        });
      }
    } finally {
      setTyping(false);
    }
  }

  function onPickFiles(event) {
    const picked = [...(event.target.files || [])];
    event.target.value = "";
    const next = [...pendingFiles];
    const errors = [];
    for (const file of picked) {
      if (next.length >= MAX_FILES) break;
      if (file.size > MAX_FILE_BYTES) {
        errors.push(`«${file.name}» слишком большой (макс. 8 МБ).`);
        continue;
      }
      next.push({
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      });
    }
    setPendingFiles(next);
    if (errors.length) {
      setMessages((prev) => [
        ...prev,
        ...errors.map((text) => ({
          id: nextMsgId("err"),
          who: "bot",
          text,
          whatsappUrl: handoffUrl,
        })),
      ]);
    }
  }

  const panelStyle = {};
  if (size.width) panelStyle["--ella-w"] = `${size.width}px`;
  if (size.height) panelStyle["--ella-h"] = `${size.height}px`;

  return (
    <div className="ella-root">
      <button
        type="button"
        className="ella-toggle"
        aria-label="Открыть чат с ELLA"
        aria-expanded={open ? "true" : "false"}
        onClick={openChat}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H7l-3 3V4zm3 4v2h10V8H7zm0 4v2h7v-2H7z" />
        </svg>
      </button>
      <section
        ref={panelRef}
        className={`ella-panel ella-panel--ready${resizing ? " is-resizing" : ""}`}
        hidden={!open}
        aria-label="Чат с ELLA"
        style={panelStyle}
      >
        <div
          className="ella-resize ella-resize--w"
          title="Ширина"
          aria-hidden="true"
          onPointerDown={bindResize("w")}
        />
        <div
          className="ella-resize ella-resize--h"
          title="Высота"
          aria-hidden="true"
          onPointerDown={bindResize("h")}
        />
        <div
          className="ella-resize ella-resize--corner"
          title="Размер"
          aria-hidden="true"
          onPointerDown={bindResize("both")}
        />
        <header className="ella-head">
          <div className="ella-avatar">EL</div>
          <div className="ella-head-copy">
            <p className="ella-name">ELLA</p>
            <p className="ella-status">помощник · отвечу вежливо</p>
          </div>
          <button
            type="button"
            className="ella-close"
            aria-label="Закрыть чат"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="ella-messages" role="log" aria-live="polite" ref={messagesRef}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`ella-bubble ella-bubble--${msg.who}${msg.kind === "error" ? " ella-bubble--error" : ""}`}
            >
              {msg.who === "bot" ? (
                <>
                  <BotText text={msg.text} whatsappUrl={msg.whatsappUrl || handoffUrl} />
                  {msg.retry ? (
                    <button
                      type="button"
                      className="ella-chip ella-retry"
                      disabled={typing}
                      onClick={() => ask(msg.retry.text, msg.retry.files, msg.retry)}
                    >
                      Повторить
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {msg.text ? msg.text : null}
                  {msg.files?.length ? (
                    <div className="ella-bubble-files">
                      {msg.files.map((entry) => {
                        const file = entry.file || entry;
                        const previewUrl = entry.previewUrl;
                        return previewUrl ? (
                          <img
                            key={file.name + file.size}
                            alt={file.name}
                            src={previewUrl}
                          />
                        ) : (
                          <div key={file.name + file.size} className="ella-file-chip">
                            {file.name}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
          {typing ? <div className="ella-typing">печатает…</div> : null}
        </div>
        <div className="ella-quick">
          {[
            ["Здравствуйте! Хочу записаться на консультацию", "Запись"],
            ["Подскажите, пожалуйста, сколько стоят виниры?", "Цены"],
            ["Какие услуги у вас есть?", "Услуги"],
          ].map(([q, label]) => (
            <button
              key={label}
              type="button"
              className="ella-chip"
              onClick={() => ask(q)}
            >
              {label}
            </button>
          ))}
        </div>
        <a
          className="ella-handoff"
          href={handoffUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Написать врачу
        </a>
        <div className="ella-attach-preview" hidden={pendingFiles.length === 0}>
          {pendingFiles.map((entry, index) => (
            <div
              key={(entry.file?.name || entry.name) + (entry.file?.size || entry.size) + index}
              className="ella-attach-item"
            >
              {entry.previewUrl ? (
                <img alt={entry.file.name} src={entry.previewUrl} />
              ) : null}
              <span>{entry.file.name}</span>
              <button
                type="button"
                className="ella-attach-remove"
                aria-label="Убрать файл"
                onClick={() =>
                  setPendingFiles((prev) => {
                    const target = prev[index];
                    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                    return prev.filter((_, i) => i !== index);
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <form
          className="ella-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = input;
            const files = [...pendingFiles];
            setInput("");
            setPendingFiles([]);
            ask(value, files);
          }}
        >
          <button
            type="button"
            className="ella-attach"
            aria-label="Прикрепить файл"
            onClick={() => fileInputRef.current?.click()}
          >
            +
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="ella-file"
            hidden
            multiple
            onChange={onPickFiles}
          />
          <input
            type="text"
            name="message"
            placeholder="Напишите ваш вопрос…"
            autoComplete="off"
            maxLength={500}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="ella-send">
            Отправить
          </button>
        </form>
      </section>
    </div>
  );
}
