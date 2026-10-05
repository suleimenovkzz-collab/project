/**
 * One-off import of the local project's database and photos into the Docker volumes.
 * The app container must be stopped (single SQLite writer). From the project root:
 *   docker compose stop
 *   docker compose run --rm -v "${PWD}:/import" app node db/importLocal.js
 *   docker compose start
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SOURCE_ROOT = process.argv[2] || "/import";
const sourceDb = path.join(SOURCE_ROOT, "data", "app.db");
const sourceUploads = path.join(SOURCE_ROOT, "public", "uploads");
const targetDb = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "app.db");
const targetUploads = path.join(__dirname, "..", "public", "uploads");

async function main() {
  if (!fs.existsSync(sourceDb)) {
    throw new Error(`Не найдена ${sourceDb}. Запускайте из корня проекта с -v "\${PWD}:/import".`);
  }

  // A stale -wal/-shm next to the replaced file would not match it and corrupt the copy.
  for (const file of [targetDb, `${targetDb}-wal`, `${targetDb}-shm`]) fs.rmSync(file, { force: true });

  // The backup API reads through the source WAL, so recent writes not yet checkpointed are included.
  const source = new Database(sourceDb, { fileMustExist: true });
  await source.backup(targetDb);
  const counts = source
    .prepare("SELECT (SELECT COUNT(*) FROM services) AS services, (SELECT COUNT(*) FROM orders) AS orders")
    .get();
  source.close();
  console.log(`База перенесена: услуг ${counts.services}, заказов ${counts.orders}`);

  if (fs.existsSync(sourceUploads)) {
    const files = fs.readdirSync(sourceUploads).filter((name) => !name.startsWith("."));
    for (const name of files) {
      fs.copyFileSync(path.join(sourceUploads, name), path.join(targetUploads, name));
    }
    console.log(`Фото перенесено: ${files.length}`);
  }
}

main().catch((error) => {
  console.error(`Импорт не удался: ${error.message}`);
  process.exit(1);
});
