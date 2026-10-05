const config = require("./config");
const { badRequest, emptyReply, noKey } = require("./errors");
const { buildAttachmentParts } = require("./attachments");
const { buildSystemPrompt } = require("./prompts");
const { buildWhatsAppHandoffUrl } = require("./handoff");
const { chatCompletions } = require("./llm");

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-config.historyLimit)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, config.historyContentLimit),
    }))
    .filter((item) => item.content);
}

function extractTextContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && part.text)
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

function safeFallbackReply() {
  return (
    "Сейчас не удалось завершить ответ. Напишите врачу в WhatsApp — " +
    "кнопка «Написать врачу» уже подготовит контекст переписки."
  );
}

/**
 * @param {{ readServices: Function, registry: { asOpenAiTools: Function, execute: Function } }} deps
 */
function createKernel(deps) {
  const { readServices, registry } = deps;

  async function chat({ message = "", history = [], files = [], signal } = {}) {
    const deadline = Date.now() + config.replyBudgetMs;
    const apiKey = config.getOpenAiApiKey();
    if (!apiKey) throw noKey();

    const cleanMessage = String(message || "").trim();
    const fileList = Array.isArray(files) ? files : [];
    if (!cleanMessage && !fileList.length) {
      throw badRequest("Пустое сообщение");
    }

    const services = typeof readServices === "function" ? readServices() : [];
    const historyMessages = normalizeHistory(history);
    const { parts: attachmentParts, labels } = buildAttachmentParts(fileList);

    const userText =
      cleanMessage ||
      (labels.length
        ? `Смотри вложение: ${labels.join(", ")}. Скажи по делу, что там, и что дальше.`
        : "Привет");

    const userContent =
      attachmentParts.length > 0
        ? [{ type: "text", text: userText.slice(0, config.historyContentLimit) }, ...attachmentParts]
        : userText.slice(0, config.historyContentLimit);

    const messages = [
      { role: "system", content: buildSystemPrompt(services) },
      ...historyMessages,
      { role: "user", content: userContent },
    ];

    const tools = registry.asOpenAiTools();
    const toolCtx = { readServices, config };
    let reply = "";

    for (let loop = 0; loop < config.maxToolLoops; loop += 1) {
      const allowTools = loop < config.maxToolLoops - 1;
      const payload = await chatCompletions({
        apiKey,
        model: config.getOpenAiModel(),
        messages,
        tools: allowTools ? tools : undefined,
        deadline,
        signal,
      });

      const choice = payload?.choices?.[0]?.message;
      if (!choice) throw emptyReply(payload);

      const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
      if (!toolCalls.length || !allowTools) {
        reply = extractTextContent(choice.content);
        if (!reply && toolCalls.length) {
          // Last loop still asked for tools — fall through to safe reply.
          break;
        }
        if (!reply) throw emptyReply(payload);
        break;
      }

      messages.push({
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call?.function?.name || "";
        let args = {};
        try {
          args = JSON.parse(call?.function?.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await registry.execute(name, args, toolCtx);
        messages.push({
          role: "tool",
          tool_call_id: call.id || `call_${loop}_${name || "unknown"}`,
          content: JSON.stringify(result),
        });
      }
    }

    if (!reply) {
      reply = safeFallbackReply();
    }

    const handoffUserLine =
      cleanMessage ||
      (labels.length ? `прислал файл(ы): ${labels.join(", ")}` : "интересуется консультацией");

    const handoffMessages = [
      ...historyMessages,
      { role: "user", content: handoffUserLine },
      { role: "assistant", content: reply },
    ];

    return {
      reply,
      handoff: {
        whatsappUrl: buildWhatsAppHandoffUrl(handoffMessages),
      },
    };
  }

  function status() {
    return {
      ready: Boolean(config.getOpenAiApiKey()),
      model: config.getOpenAiModel(),
    };
  }

  return { chat, status };
}

module.exports = { createKernel };
