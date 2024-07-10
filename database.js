const { Pool } = require("pg");
require("dotenv").config(); // Загружает переменные окружения из .env файла

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: isProduction
    ? process.env.DATABASE_URL
    : `postgresql://postgres:mcfaq4Ubtch331@localhost:5432/notesForBot`,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Создание таблицы заметок, если ее нет
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    reminder_at TIMESTAMP
  )
`
  )
  .catch((err) => console.error("Ошибка создания таблицы:", err));

module.exports = pool;
