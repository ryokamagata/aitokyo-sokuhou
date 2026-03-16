import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import type { BMRow } from './types'

const DB_PATH =
  process.env.DB_PATH ??
  (process.env.NODE_ENV === 'production'
    ? '/app/data/aitokyo.db'
    : path.join(process.cwd(), 'data', 'aitokyo.db'))

let db: Database.Database | null = null

export function getDB(): Database.Database {
  if (db) return db

  // ディレクトリが存在しない場合は作成
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      store       TEXT NOT NULL,
      staff       TEXT NOT NULL DEFAULT '',
      amount      INTEGER NOT NULL,
      customers   INTEGER NOT NULL DEFAULT 0,
      menu        TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_records(date);
    CREATE INDEX IF NOT EXISTS idx_sales_store ON sales_records(store);

    CREATE TABLE IF NOT EXISTS monthly_targets (
      year    INTEGER NOT NULL,
      month   INTEGER NOT NULL,
      target  INTEGER NOT NULL,
      PRIMARY KEY (year, month)
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      filename     TEXT NOT NULL,
      file_hash    TEXT NOT NULL UNIQUE,
      row_count    INTEGER NOT NULL,
      imported_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_daily_sales (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      store      TEXT NOT NULL,
      bm_code    TEXT NOT NULL,
      sales      INTEGER NOT NULL DEFAULT 0,
      customers  INTEGER NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, bm_code)
    );
    CREATE INDEX IF NOT EXISTS idx_sds_date ON store_daily_sales(date);

    CREATE TABLE IF NOT EXISTS staff_period_sales (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      year       INTEGER NOT NULL,
      month      INTEGER NOT NULL,
      store      TEXT NOT NULL,
      bm_code    TEXT NOT NULL,
      staff      TEXT NOT NULL,
      sales      INTEGER NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, bm_code, staff)
    );

    CREATE TABLE IF NOT EXISTS scrape_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      stores_scraped INTEGER NOT NULL DEFAULT 0,
      records_stored INTEGER NOT NULL DEFAULT 0,
      error          TEXT,
      scraped_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export function getSalesForMonth(year: number, month: number) {
  const db = getDB()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return db
    .prepare(
      `SELECT date, store, staff, SUM(amount) as amount, SUM(customers) as customers
       FROM sales_records
       WHERE date LIKE ?
       GROUP BY date, store, staff
       ORDER BY date ASC`
    )
    .all(`${prefix}-%`) as { date: string; store: string; staff: string; amount: number; customers: number }[]
}

export function getTarget(year: number, month: number): number | null {
  const db = getDB()
  const row = db
    .prepare('SELECT target FROM monthly_targets WHERE year=? AND month=?')
    .get(year, month) as { target: number } | undefined
  return row?.target ?? null
}

export function setTarget(year: number, month: number, target: number) {
  const db = getDB()
  db.prepare(
    `INSERT INTO monthly_targets(year, month, target) VALUES(?, ?, ?)
     ON CONFLICT(year, month) DO UPDATE SET target=excluded.target`
  ).run(year, month, target)
}

// ─── Scraped data functions ─────────────────────────────────────────────────

export function upsertStoreDailySales(
  records: { date: string; store: string; bm_code: string; sales: number; customers: number }[]
): number {
  const db = getDB()
  const upsert = db.prepare(`
    INSERT INTO store_daily_sales(date, store, bm_code, sales, customers)
    VALUES(@date, @store, @bm_code, @sales, @customers)
    ON CONFLICT(date, bm_code) DO UPDATE SET
      store=excluded.store, sales=excluded.sales,
      customers=excluded.customers, scraped_at=datetime('now')
  `)
  const run = db.transaction(() => {
    for (const r of records) upsert.run(r)
    return records.length
  })
  return run()
}

export function upsertStaffSales(
  year: number,
  month: number,
  store: string,
  bmCode: string,
  records: { staff: string; sales: number }[]
): void {
  const db = getDB()
  db.transaction(() => {
    db.prepare('DELETE FROM staff_period_sales WHERE year=? AND month=? AND bm_code=?').run(year, month, bmCode)
    const insert = db.prepare(
      'INSERT INTO staff_period_sales(year, month, store, bm_code, staff, sales) VALUES(?,?,?,?,?,?)'
    )
    for (const r of records) insert.run(year, month, store, bmCode, r.staff, r.sales)
  })()
}

export function getScrapedDailySales(year: number, month: number) {
  const db = getDB()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return db
    .prepare(
      `SELECT date, SUM(sales) as sales, SUM(customers) as customers
       FROM store_daily_sales WHERE date LIKE ? GROUP BY date ORDER BY date ASC`
    )
    .all(`${prefix}-%`) as { date: string; sales: number; customers: number }[]
}

export function getScrapedStoreSales(year: number, month: number) {
  const db = getDB()
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return db
    .prepare(
      `SELECT store, SUM(sales) as sales FROM store_daily_sales
       WHERE date LIKE ? GROUP BY store ORDER BY sales DESC`
    )
    .all(`${prefix}-%`) as { store: string; sales: number }[]
}

export function getScrapedStaffSales(year: number, month: number) {
  const db = getDB()
  return db
    .prepare(
      `SELECT staff, SUM(sales) as sales FROM staff_period_sales
       WHERE year=? AND month=? GROUP BY staff ORDER BY sales DESC`
    )
    .all(year, month) as { staff: string; sales: number }[]
}

export function getLastScrapeTime(): string | null {
  const db = getDB()
  const row = db
    .prepare('SELECT scraped_at FROM scrape_log WHERE error IS NULL ORDER BY id DESC LIMIT 1')
    .get() as { scraped_at: string } | undefined
  return row?.scraped_at ?? null
}

export function logScrape(storesScraped: number, recordsStored: number, error?: string): void {
  const db = getDB()
  db.prepare('INSERT INTO scrape_log(stores_scraped, records_stored, error) VALUES(?,?,?)').run(
    storesScraped,
    recordsStored,
    error ?? null
  )
}

// ─── CSV import functions ────────────────────────────────────────────────────

export function importCSVRows(rows: BMRow[], fileHash: string, filename: string): number {
  const db = getDB()

  // 重複チェック
  const existing = db.prepare('SELECT id FROM import_log WHERE file_hash=?').get(fileHash)
  if (existing) return 0

  const insert = db.prepare(
    `INSERT INTO sales_records(date, store, staff, amount, customers, menu)
     VALUES(@date, @store, @staff, @amount, @customers, @menu)`
  )

  const insertMany = db.transaction((rows: BMRow[]) => {
    for (const row of rows) insert.run(row)
    return rows.length
  })

  const count = insertMany(rows)
  db.prepare('INSERT INTO import_log(filename, file_hash, row_count) VALUES(?,?,?)').run(
    filename,
    fileHash,
    count
  )
  return count
}
