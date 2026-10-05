function isTextLikeFile(file) {
  const name = String(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/csv",
      "application/x-csv",
    ].includes(mime)
  ) {
    return true;
  }
  return /\.(txt|md|csv|json|xml|log|html|htm|rtf|tsv)$/i.test(name);
}

function isPdfFile(file) {
  const name = String(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  return mime === "application/pdf" || name.endsWith(".pdf");
}

function buildAttachmentParts(files = []) {
  const parts = [];
  const labels = [];

  for (const file of files) {
    const name = file.originalname || "file";
    const mime = file.mimetype || "application/octet-stream";
    const base64 = file.buffer.toString("base64");
    labels.push(name);

    if (mime.startsWith("image/")) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${base64}`,
          detail: "high",
        },
      });
      parts.push({
        type: "text",
        text: `Клиент прислал изображение «${name}». Посмотри и коротко скажи, что видишь по делу (зубы/улыбка/документ). Не ставь диагноз.`,
      });
      continue;
    }

    if (isTextLikeFile(file)) {
      const text = file.buffer.toString("utf8").slice(0, 12000);
      parts.push({
        type: "text",
        text: `Содержимое файла «${name}»:\n${text || "(пусто)"}`,
      });
      continue;
    }

    if (isPdfFile(file)) {
      parts.push({
        type: "file",
        file: {
          filename: name.endsWith(".pdf") ? name : `${name}.pdf`,
          file_data: `data:application/pdf;base64,${base64}`,
        },
      });
      parts.push({
        type: "text",
        text: `Клиент прислал PDF «${name}». Прочитай по делу и кратко перескажи важное. Не выдумывай.`,
      });
      continue;
    }

    parts.push({
      type: "text",
      text:
        `Клиент прислал файл «${name}» (${mime}, ${file.size} байт). ` +
        "Бинарный формат целиком не разобрать — попроси коротко описать, что внутри, или скинуть фото/PDF/текст. " +
        "И всё равно веди к WhatsApp Алишеру.",
    });
  }

  return { parts, labels };
}

module.exports = {
  isTextLikeFile,
  isPdfFile,
  buildAttachmentParts,
};
