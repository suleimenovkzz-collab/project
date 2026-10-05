/**
 * Turns multer/busboy/fs errors into a status + Russian message for the visitor.
 * Server-side failures (disk full, permissions) are flagged `internal` so the caller logs them as errors.
 */
const multer = require("multer");

const RETRY_HINT = "Обновите страницу и попробуйте ещё раз.";

/**
 * @param {Error & { code?: string }} error
 * @param {{ maxFileMb: number, maxFiles: number }} limits
 * @returns {{ status: number, message: string, internal: boolean }}
 */
function describeUploadError(error, { maxFileMb, maxFiles }) {
  if (error instanceof multer.MulterError) {
    const tooMany =
      maxFiles === 1 ? "Можно загрузить только один файл." : `Можно прикрепить не больше ${maxFiles} файлов.`;
    const messages = {
      LIMIT_FILE_SIZE: `Файл слишком большой. Максимум — ${maxFileMb} МБ.`,
      LIMIT_FILE_COUNT: tooMany,
      LIMIT_UNEXPECTED_FILE: tooMany,
      LIMIT_PART_COUNT: `Слишком большой запрос. ${RETRY_HINT}`,
      LIMIT_FIELD_COUNT: `Слишком большой запрос. ${RETRY_HINT}`,
      LIMIT_FIELD_KEY: `Некорректный запрос. ${RETRY_HINT}`,
      LIMIT_FIELD_VALUE: "Текст слишком длинный. Сократите описание и попробуйте ещё раз.",
      MISSING_FIELD_NAME: `Некорректный запрос. ${RETRY_HINT}`,
    };
    return {
      status: error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
      message: messages[error.code] || `Не удалось загрузить файл. ${RETRY_HINT}`,
      internal: false,
    };
  }
  if (error?.code === "UNSUPPORTED_FILE_TYPE") {
    return { status: 415, message: error.message, internal: false };
  }
  // Node system errors (ENOSPC, EACCES, EMFILE…) are our fault, not the visitor's.
  if (/^E[A-Z]+$/.test(String(error?.code || ""))) {
    return { status: 500, message: "Не удалось сохранить файл на сервере. Попробуйте позже.", internal: true };
  }
  return {
    status: 400,
    message: "Файл не удалось прочитать — возможно, загрузка прервалась. Попробуйте ещё раз.",
    internal: false,
  };
}

module.exports = { describeUploadError };
