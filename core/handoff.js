const config = require("./config");

function buildHandoffMessage(messages) {
  const userLines = messages
    .filter((item) => item.role === "user")
    .map((item) => String(item.content || "").trim())
    .filter(Boolean)
    .slice(-4);

  const lastUser = userLines[userLines.length - 1] || "интересуется консультацией";
  const summary =
    userLines.length > 1
      ? userLines.map((line, i) => `${i + 1}) ${line}`).join("\n")
      : lastUser;

  return (
    `Здравствуйте, ${config.doctorShortName}!\n\n` +
    "ELLA передаёт клиента с сайта.\n\n" +
    `Актуальный запрос:\n«${lastUser}»\n\n` +
    `Кратко из переписки:\n${summary}\n\n` +
    "Клиент готов продолжить с вами."
  );
}

function buildWhatsAppHandoffUrl(messages) {
  const text = buildHandoffMessage(messages);
  return config.whatsappBaseUrl + encodeURIComponent(text);
}

module.exports = {
  buildHandoffMessage,
  buildWhatsAppHandoffUrl,
};
