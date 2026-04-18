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

  // Migration: add new_customers column
  const cols = db.prepare("PRAGMA table_info(store_daily_sales)").all() as { name: string }[]
  if (!cols.some(c => c.name === 'new_customers')) {
    db.exec('ALTER TABLE store_daily_sales ADD COLUMN new_customers INTEGER NOT NULL DEFAULT 0')
  }

  // 来店客月次集計テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_monthly_visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      store TEXT NOT NULL,
      bm_code TEXT NOT NULL,
      nominated INTEGER NOT NULL DEFAULT 0,
      free_visit INTEGER NOT NULL DEFAULT 0,
      new_customers INTEGER NOT NULL DEFAULT 0,
      revisit INTEGER NOT NULL DEFAULT 0,
      fixed INTEGER NOT NULL DEFAULT 0,
      re_return INTEGER NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, bm_code)
    );
  `)

  // 顧客月次集計テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_monthly_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      store TEXT NOT NULL,
      bm_code TEXT NOT NULL,
      total_users INTEGER NOT NULL DEFAULT 0,
      app_members INTEGER NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, bm_code)
    );
  `)

  // サイクル分析テーブル（新規3ヶ月リターン率など）
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_monthly_cycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      store TEXT NOT NULL,
      bm_code TEXT NOT NULL,
      avg_cycle REAL NOT NULL DEFAULT 0,
      new_return_3m REAL NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, bm_code)
    );

    CREATE TABLE IF NOT EXISTS store_opening_plans (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      year            INTEGER NOT NULL,
      opening_month   INTEGER NOT NULL,
      store_name      TEXT NOT NULL,
      max_monthly_revenue INTEGER NOT NULL,
      seats           INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, store_name)
    );

    CREATE TABLE IF NOT EXISTS store_daily_utilization (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      store TEXT NOT NULL,
      bm_code TEXT NOT NULL,
      utilization_rate REAL NOT NULL DEFAULT 0,
      total_slots INTEGER NOT NULL DEFAULT 0,
      booked_slots INTEGER NOT NULL DEFAULT 0,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, bm_code)
    );
    CREATE INDEX IF NOT EXISTS idx_sdu_date ON store_daily_utilization(date);

    CREATE TABLE IF NOT EXISTS executive_kpi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      kpi_key TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, kpi_key)
    );
  `)

  // 2026年 月別売上目標のシード（既存データがなければ挿入）
  const targetCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM monthly_targets WHERE year=2026 AND month BETWEEN 1 AND 12'
  ).get() as { cnt: number }).cnt
  if (targetCount === 0) {
    const targets2026: [number, number][] = [
      [1, 67000000],   // 6700万
      [2, 70000000],   // 7000万（+sea出店）
      [3, 100000000],  // 1億
      [4, 95000000],   // 9500万
      [5, 78000000],   // 7800万
      [6, 78000000],   // 7800万
      [7, 120000000],  // 1.2億（横浜直営出店）
      [8, 110000000],  // 1.1億
      [9, 80000000],   // 8000万
      [10, 80000000],  // 8000万
      [11, 80000000],  // 8000万（渋谷シェアサロン出店）
      [12, 150000000], // 1.5億
    ]
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO monthly_targets(year, month, target) VALUES(2026, ?, ?)'
    )
    const total = targets2026.reduce((s, [, v]) => s + v, 0)
    db.transaction(() => {
      for (const [m, t] of targets2026) stmt.run(m, t)
      // 年間目標も合計で同期
      db.prepare(
        'INSERT INTO monthly_targets(year, month, target) VALUES(2026, 0, ?) ON CONFLICT(year, month) DO UPDATE SET target=excluded.target'
      ).run(total)
    })()
  }
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

/** 年間目標を取得: month=0 に直接入力値があればそれを使い、なければ月別合算 */
export function getAnnualTarget(year: number): number | null {
  const db = getDB()
  // 直接入力の年間目標 (month=0) を優先
  const direct = db.prepare(
    'SELECT target FROM monthly_targets WHERE year=? AND month=0'
  ).get(year) as { target: number } | undefined
  if (direct) return direct.target

  // なければ月別目標の合算
  const row = db.prepare(
    'SELECT SUM(target) as total, COUNT(*) as cnt FROM monthly_targets WHERE year=? AND month>0'
  ).get(year) as { total: number | null; cnt: number } | undefined
  if (!row || row.cnt === 0) return null
  return row.total
}

/** 年間目標を直接設定 (month=0 で保存) */
export function setAnnualTarget(year: number, target: number) {
  const db = getDB()
  db.prepare(
    `INSERT INTO monthly_targets(year, month, target) VALUES(?, 0, ?)
     ON CONFLICT(year, month) DO UPDATE SET target=excluded.target`
  ).run(year, target)
}

/** 指定年の月別目標を一括取得 (month 1-12) */
export function getMonthlyTargets(year: number): Record<number, number> {
  const db = getDB()
  const rows = db.prepare(
    'SELECT month, target FROM monthly_targets WHERE year=? AND month BETWEEN 1 AND 12'
  ).all(year) as { month: number; target: number }[]
  const result: Record<number, number> = {}
  for (const r of rows) result[r.month] = r.target
  return result
}

/** 月別目標を一括保存 & 年間目標(month=0)を合計で自動同期 */
export function setMonthlyTargets(year: number, targets: Record<number, number>) {
  const db = getDB()
  const stmt = db.prepare(
    `INSERT INTO monthly_targets(year, month, target) VALUES(?, ?, ?)
     ON CONFLICT(year, month) DO UPDATE SET target=excluded.target`
  )
  const tx = db.transaction(() => {
    for (const [month, target] of Object.entries(targets)) {
      const m = parseInt(month)
      if (m >= 1 && m <= 12 && target > 0) {
        stmt.run(year, m, Math.round(target))
      }
    }
    // 年間目標を月別合計で自動同期
    const sum = db.prepare(
      'SELECT SUM(target) as total FROM monthly_targets WHERE year=? AND month BETWEEN 1 AND 12'
    ).get(year) as { total: number | null }
    if (sum.total) {
      stmt.run(year, 0, sum.total)
    }
  })
  tx()
}

// ─── 出店計画 ──────────────────────────────────────────────────────────────

export type StoreOpeningPlan = {
  id: number
  year: number
  opening_month: number
  store_name: string
  max_monthly_revenue: number
  seats: number
}

export function getStoreOpeningPlans(year?: number): StoreOpeningPlan[] {
  const db = getDB()
  if (year) {
    return db.prepare(
      'SELECT id, year, opening_month, store_name, max_monthly_revenue, seats FROM store_opening_plans WHERE year=? ORDER BY year, opening_month'
    ).all(year) as StoreOpeningPlan[]
  }
  return db.prepare(
    'SELECT id, year, opening_month, store_name, max_monthly_revenue, seats FROM store_opening_plans ORDER BY year, opening_month'
  ).all() as StoreOpeningPlan[]
}

export function upsertStoreOpeningPlan(plan: {
  year: number
  opening_month: number
  store_name: string
  max_monthly_revenue: number
  seats: number
}): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO store_opening_plans(year, opening_month, store_name, max_monthly_revenue, seats)
    VALUES(@year, @opening_month, @store_name, @max_monthly_revenue, @seats)
    ON CONFLICT(year, store_name) DO UPDATE SET
      opening_month=excluded.opening_month,
      max_monthly_revenue=excluded.max_monthly_revenue,
      seats=excluded.seats
  `).run(plan)
}

export function deleteStoreOpeningPlan(id: number): void {
  const db = getDB()
  db.prepare('DELETE FROM store_opening_plans WHERE id=?').run(id)
}

/**
 * 出店計画から月別の予測売上を算出（成長カーブ + 季節変動率）
 * 成長カーブ: 1ヶ月目30% → 2ヶ月目50% → 3ヶ月目70% → 4ヶ月目85% → 5ヶ月目95% → 6ヶ月目以降100%
 * 6ヶ月目以降は前年の全店舗売上の月別変動率を反映（繁忙期/閑散期を加味）
 */
export function getSeasonalIndex(year: number): Record<number, number> {
  const prevYearMonthly = getMonthlyTotalSales(year - 1, 1, year - 1, 12)
  const index: Record<number, number> = {}
  if (prevYearMonthly.length >= 6) {
    const avg = prevYearMonthly.reduce((s, m) => s + m.sales, 0) / prevYearMonthly.length
    for (const m of prevYearMonthly) {
      const [, mStr] = m.month.split('-')
      index[parseInt(mStr)] = avg > 0 ? Math.round((m.sales / avg) * 100) / 100 : 1.0
    }
  }
  return index
}

export function getStoreOpeningRevenue(year: number): { month: number; revenue: number; storeName: string }[] {
  const plans = getStoreOpeningPlans(year)
  const growthCurve = [0.30, 0.50, 0.70, 0.85, 0.95, 1.0]
  const result: { month: number; revenue: number; storeName: string }[] = []

  // 前年の月別売上から季節変動指数を算出
  const prevYearMonthly = getMonthlyTotalSales(year - 1, 1, year - 1, 12)
  const seasonalIndex: Record<number, number> = {}
  if (prevYearMonthly.length >= 6) {
    const avgMonthlySales = prevYearMonthly.reduce((s, m) => s + m.sales, 0) / prevYearMonthly.length
    for (const m of prevYearMonthly) {
      const [, mStr] = m.month.split('-')
      const mo = parseInt(mStr)
      seasonalIndex[mo] = avgMonthlySales > 0 ? m.sales / avgMonthlySales : 1.0
    }
  }

  for (const plan of plans) {
    for (let mo = plan.opening_month; mo <= 12; mo++) {
      const monthsOpen = mo - plan.opening_month // 0-indexed
      let growthRate: number
      if (monthsOpen < growthCurve.length) {
        growthRate = growthCurve[monthsOpen]
      } else {
        // 6ヶ月目以降: 100%ベースに季節変動率を掛ける
        growthRate = seasonalIndex[mo] ?? 1.0
      }
      result.push({
        month: mo,
        revenue: Math.round(plan.max_monthly_revenue * growthRate),
        storeName: plan.store_name,
      })
    }
  }

  return result
}

// ─── Scraped data functions ─────────────────────────────────────────────────

export function upsertStoreDailySales(
  records: { date: string; store: string; bm_code: string; sales: number; customers: number; new_customers?: number }[]
): number {
  const db = getDB()
  const upsert = db.prepare(`
    INSERT INTO store_daily_sales(date, store, bm_code, sales, customers, new_customers)
    VALUES(@date, @store, @bm_code, @sales, @customers, @new_customers)
    ON CONFLICT(date, bm_code) DO UPDATE SET
      store=excluded.store, sales=excluded.sales,
      customers=excluded.customers, new_customers=excluded.new_customers, scraped_at=datetime('now')
  `)
  const run = db.transaction(() => {
    for (const r of records) upsert.run({ ...r, new_customers: r.new_customers ?? 0 })
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
      `SELECT date, SUM(sales) as sales, SUM(customers) as customers, SUM(new_customers) as new_customers
       FROM store_daily_sales WHERE date LIKE ? GROUP BY date ORDER BY date ASC`
    )
    .all(`${prefix}-%`) as { date: string; sales: number; customers: number; new_customers: number }[]
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
  if (!row) return null
  // New records contain 'T' (already JST), old records are UTC space-separated
  if (row.scraped_at.includes('T')) return row.scraped_at
  // Old UTC records → convert to JST (+9h)
  const utc = new Date(row.scraped_at + 'Z')
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000)
  return `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, '0')}-${String(jst.getDate()).padStart(2, '0')}T${String(jst.getHours()).padStart(2, '0')}:${String(jst.getMinutes()).padStart(2, '0')}:${String(jst.getSeconds()).padStart(2, '0')}`
}

export function logScrape(storesScraped: number, recordsStored: number, error?: string): void {
  const db = getDB()
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const scraped_at = `${jstNow.getFullYear()}-${String(jstNow.getMonth() + 1).padStart(2, '0')}-${String(jstNow.getDate()).padStart(2, '0')}T${String(jstNow.getHours()).padStart(2, '0')}:${String(jstNow.getMinutes()).padStart(2, '0')}:${String(jstNow.getSeconds()).padStart(2, '0')}`
  db.prepare('INSERT INTO scrape_log(stores_scraped, records_stored, error, scraped_at) VALUES(?,?,?,?)').run(
    storesScraped,
    recordsStored,
    error ?? null,
    scraped_at
  )
}

// ─── Visitor / User stats functions ──────────────────────────────────────────

export function upsertMonthlyVisitors(
  year: number, month: number, store: string, bmCode: string,
  data: { nominated: number; free_visit: number; new_customers: number; revisit: number; fixed: number; re_return: number }
): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO store_monthly_visitors(year, month, store, bm_code, nominated, free_visit, new_customers, revisit, fixed, re_return)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(year, month, bm_code) DO UPDATE SET
      store=excluded.store, nominated=excluded.nominated, free_visit=excluded.free_visit,
      new_customers=excluded.new_customers, revisit=excluded.revisit, fixed=excluded.fixed,
      re_return=excluded.re_return, scraped_at=datetime('now')
  `).run(year, month, store, bmCode, data.nominated, data.free_visit, data.new_customers, data.revisit, data.fixed, data.re_return)
}

export function getMonthlyVisitors(year: number, month: number) {
  const db = getDB()
  return db.prepare(
    `SELECT SUM(nominated) as nominated, SUM(free_visit) as free_visit,
            SUM(new_customers) as new_customers, SUM(revisit) as revisit,
            SUM(fixed) as fixed, SUM(re_return) as re_return
     FROM store_monthly_visitors WHERE year=? AND month=?`
  ).get(year, month) as {
    nominated: number; free_visit: number; new_customers: number
    revisit: number; fixed: number; re_return: number
  } | undefined
}

export function getPerStoreVisitors(year: number, month: number) {
  const db = getDB()
  return db.prepare(
    `SELECT store, bm_code, nominated, free_visit, new_customers, revisit, fixed, re_return
     FROM store_monthly_visitors WHERE year=? AND month=?`
  ).all(year, month) as {
    store: string; bm_code: string; nominated: number; free_visit: number
    new_customers: number; revisit: number; fixed: number; re_return: number
  }[]
}

export function upsertMonthlyUsers(
  year: number, month: number, store: string, bmCode: string,
  totalUsers: number, appMembers: number
): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO store_monthly_users(year, month, store, bm_code, total_users, app_members)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(year, month, bm_code) DO UPDATE SET
      store=excluded.store, total_users=excluded.total_users,
      app_members=excluded.app_members, scraped_at=datetime('now')
  `).run(year, month, store, bmCode, totalUsers, appMembers)
}

export function getMonthlyUsers(year: number, month: number) {
  const db = getDB()
  return db.prepare(
    `SELECT SUM(total_users) as total_users, SUM(app_members) as app_members
     FROM store_monthly_users WHERE year=? AND month=?`
  ).get(year, month) as { total_users: number; app_members: number } | undefined
}

export function getPerStoreUsers(year: number, month: number) {
  const db = getDB()
  return db.prepare(
    `SELECT store, bm_code, total_users, app_members
     FROM store_monthly_users WHERE year=? AND month=?`
  ).all(year, month) as { store: string; bm_code: string; total_users: number; app_members: number }[]
}

// ─── Cycle (サイクル分析) functions ──────────────────────────────────────────

export function upsertMonthlyCycle(
  year: number, month: number, store: string, bmCode: string,
  avgCycle: number, newReturn3m: number
): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO store_monthly_cycle(year, month, store, bm_code, avg_cycle, new_return_3m)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(year, month, bm_code) DO UPDATE SET
      store=excluded.store, avg_cycle=excluded.avg_cycle,
      new_return_3m=excluded.new_return_3m, scraped_at=datetime('now')
  `).run(year, month, store, bmCode, avgCycle, newReturn3m)
}

export function getPerStoreCycle(year: number, month: number) {
  const db = getDB()
  return db.prepare(
    `SELECT store, bm_code, avg_cycle, new_return_3m
     FROM store_monthly_cycle WHERE year=? AND month=?`
  ).all(year, month) as { store: string; bm_code: string; avg_cycle: number; new_return_3m: number }[]
}

// ─── Historical data functions ───────────────────────────────────────────────

/** 全店舗合計の月次売上 (指定範囲) */
export function getMonthlyTotalSales(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  return db.prepare(`
    SELECT substr(date, 1, 7) as month, SUM(sales) as sales, SUM(customers) as customers
    FROM store_daily_sales
    WHERE date >= ? AND date <= ?
    GROUP BY substr(date, 1, 7)
    ORDER BY month ASC
  `).all(fromPrefix, toPrefix) as { month: string; sales: number; customers: number }[]
}

/** 店舗別の月次売上 (指定範囲) */
export function getMonthlyStoreSales(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  return db.prepare(`
    SELECT substr(date, 1, 7) as month, store, SUM(sales) as sales, SUM(customers) as customers
    FROM store_daily_sales
    WHERE date >= ? AND date <= ?
    GROUP BY substr(date, 1, 7), store
    ORDER BY month ASC, sales DESC
  `).all(fromPrefix, toPrefix) as { month: string; store: string; sales: number; customers: number }[]
}

/** スタッフ別の月次売上 (指定範囲) */
export function getMonthlyStaffSales(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  return db.prepare(`
    SELECT year, month, staff, store, SUM(sales) as sales
    FROM staff_period_sales
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    GROUP BY year, month, staff
    ORDER BY year ASC, month ASC, sales DESC
  `).all(fromYear * 100 + fromMonth, toYear * 100 + toMonth) as { year: number; month: number; staff: string; store: string; sales: number }[]
}

/** スタッフ別の月次売上（単月・店舗付き） */
export function getStaffSalesForMonth(year: number, month: number) {
  const db = getDB()
  return db.prepare(`
    SELECT staff, store, SUM(sales) as sales
    FROM staff_period_sales
    WHERE year=? AND month=?
    GROUP BY staff
    ORDER BY sales DESC
  `).all(year, month) as { staff: string; store: string; sales: number }[]
}

/** スタッフ別の月次売上（店舗付き） */
export function getMonthlyStaffSalesWithStore(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  return db.prepare(`
    SELECT year, month, staff, store, SUM(sales) as sales
    FROM staff_period_sales
    WHERE (year * 100 + month) >= ? AND (year * 100 + month) <= ?
    GROUP BY year, month, staff, store
    ORDER BY year ASC, month ASC, sales DESC
  `).all(fromYear * 100 + fromMonth, toYear * 100 + toMonth) as { year: number; month: number; staff: string; store: string; sales: number }[]
}

/** 日別の売上・客数（指定日付範囲） */
export function getDailySales(fromDate: string, toDate: string) {
  const db = getDB()
  return db.prepare(`
    SELECT date, SUM(sales) as sales, SUM(customers) as customers
    FROM store_daily_sales
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(fromDate, toDate) as { date: string; sales: number; customers: number }[]
}

/** 店舗別の日別売上（指定日付範囲） */
export function getStoreDailySales(fromDate: string, toDate: string) {
  const db = getDB()
  return db.prepare(`
    SELECT date, store, sales, customers
    FROM store_daily_sales
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC, store ASC
  `).all(fromDate, toDate) as { date: string; store: string; sales: number; customers: number }[]
}

/** 曜日別の売上・客数集計 (指定範囲) */
export function getDayOfWeekSales(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  // 日毎に集約してから曜日平均を取る（重複行や複数bm_code対策）
  return db.prepare(`
    SELECT dow, COUNT(*) as days,
           SUM(salesPerDay) as totalSales,
           SUM(customersPerDay) as totalCustomers,
           ROUND(AVG(salesPerDay)) as avgSales,
           ROUND(AVG(customersPerDay)) as avgCustomers
    FROM (
      SELECT date,
             CAST(strftime('%w', date) AS INTEGER) as dow,
             SUM(sales) as salesPerDay,
             SUM(customers) as customersPerDay
      FROM store_daily_sales
      WHERE date >= ? AND date <= ?
      GROUP BY date
    ) sub
    GROUP BY dow
    ORDER BY dow ASC
  `).all(fromPrefix, toPrefix) as {
    dow: number; days: number; totalSales: number; totalCustomers: number;
    avgSales: number; avgCustomers: number
  }[]
}

/** 店舗別の曜日別売上 (指定範囲) */
export function getStoreDayOfWeekSales(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  // 日毎に店舗単位で集約してから曜日平均を取る（重複行や複数bm_code対策）
  return db.prepare(`
    SELECT store, dow, COUNT(*) as days,
           SUM(salesPerDay) as totalSales,
           SUM(customersPerDay) as totalCustomers,
           ROUND(AVG(salesPerDay)) as avgSales,
           ROUND(AVG(customersPerDay)) as avgCustomers
    FROM (
      SELECT store, date,
             CAST(strftime('%w', date) AS INTEGER) as dow,
             SUM(sales) as salesPerDay,
             SUM(customers) as customersPerDay
      FROM store_daily_sales
      WHERE date >= ? AND date <= ?
      GROUP BY store, date
    ) sub
    GROUP BY store, dow
    ORDER BY store ASC, dow ASC
  `).all(fromPrefix, toPrefix) as {
    store: string; dow: number; days: number; totalSales: number; totalCustomers: number;
    avgSales: number; avgCustomers: number
  }[]
}

// ─── Executive KPI functions ────────────────────────────────────────────────

/** KPI値を取得 */
export function getKpiValue(year: number, month: number, key: string): number | null {
  const db = getDB()
  const row = db.prepare('SELECT value FROM executive_kpi WHERE year=? AND month=? AND kpi_key=?').get(year, month, key) as { value: number } | undefined
  return row?.value ?? null
}

/** KPI値を保存 */
export function setKpiValue(year: number, month: number, key: string, value: number) {
  const db = getDB()
  db.prepare(`
    INSERT INTO executive_kpi(year, month, kpi_key, value)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(year, month, kpi_key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(year, month, key, value)
}

/** KPI_NO_DATA: 「データなし」を表す特殊値（0とは区別） */
export const KPI_NO_DATA = -99999

/** 指定年のKPI値をすべて取得（prefixでフィルタ可能） */
export function getAllKpiValues(year: number, prefix?: string): Record<string, Record<number, number>> {
  const db = getDB()
  let rows: { month: number; kpi_key: string; value: number }[]
  if (prefix) {
    rows = db.prepare('SELECT month, kpi_key, value FROM executive_kpi WHERE year=? AND kpi_key LIKE ?')
      .all(year, `${prefix}%`) as typeof rows
  } else {
    rows = db.prepare('SELECT month, kpi_key, value FROM executive_kpi WHERE year=? AND kpi_key NOT LIKE ?')
      .all(year, 'kpi_target_%') as typeof rows
  }
  const result: Record<string, Record<number, number>> = {}
  for (const r of rows) {
    if (!result[r.kpi_key]) result[r.kpi_key] = {}
    result[r.kpi_key][r.month] = r.value
  }
  return result
}

/** Q期間のKPI合計/平均を取得 */
export function getKpiForQuarter(year: number, quarter: number, key: string, mode: 'sum' | 'avg' = 'sum'): number | null {
  const db = getDB()
  const quarters: Record<number, number[]> = { 1: [10, 11, 12], 2: [1, 2, 3], 3: [4, 5, 6], 4: [7, 8, 9] }
  const months = quarters[quarter]
  if (!months) return null
  const fn = mode === 'sum' ? 'SUM(value)' : 'AVG(value)'
  const placeholders = months.map(() => '?').join(',')
  const row = db.prepare(`SELECT ${fn} as result FROM executive_kpi WHERE year=? AND kpi_key=? AND month IN (${placeholders})`).get(year, key, ...months) as { result: number | null } | undefined
  return row?.result ?? null
}

/** 稼働率データを保存 */
export function upsertUtilization(date: string, store: string, bmCode: string, rate: number, totalSlots: number, bookedSlots: number) {
  const db = getDB()
  db.prepare(`
    INSERT INTO store_daily_utilization(date, store, bm_code, utilization_rate, total_slots, booked_slots)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, bm_code) DO UPDATE SET
      utilization_rate=excluded.utilization_rate,
      total_slots=excluded.total_slots,
      booked_slots=excluded.booked_slots,
      scraped_at=datetime('now')
  `).run(date, store, bmCode, rate, totalSlots, bookedSlots)
}

/** 曜日別稼働率 (指定範囲) */
export function getDayOfWeekUtilization(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  return db.prepare(`
    SELECT CAST(strftime('%w', date) AS INTEGER) as dow,
           COUNT(*) as days,
           ROUND(AVG(utilization_rate), 1) as avgRate,
           ROUND(1.0 * SUM(booked_slots) / NULLIF(SUM(total_slots), 0) * 100, 1) as actualRate
    FROM store_daily_utilization
    WHERE date >= ? AND date <= ?
    GROUP BY CAST(strftime('%w', date) AS INTEGER)
    ORDER BY dow ASC
  `).all(fromPrefix, toPrefix) as { dow: number; days: number; avgRate: number; actualRate: number | null }[]
}

/** 店舗別の曜日別稼働率 (指定範囲) */
export function getStoreDayOfWeekUtilization(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  return db.prepare(`
    SELECT store,
           CAST(strftime('%w', date) AS INTEGER) as dow,
           COUNT(*) as days,
           ROUND(AVG(utilization_rate), 1) as avgRate,
           ROUND(1.0 * SUM(booked_slots) / NULLIF(SUM(total_slots), 0) * 100, 1) as actualRate
    FROM store_daily_utilization
    WHERE date >= ? AND date <= ?
    GROUP BY store, CAST(strftime('%w', date) AS INTEGER)
    ORDER BY store ASC, dow ASC
  `).all(fromPrefix, toPrefix) as { store: string; dow: number; days: number; avgRate: number; actualRate: number | null }[]
}

/** 月次稼働率サマリー */
export function getMonthlyUtilization(fromYear: number, fromMonth: number, toYear: number, toMonth: number) {
  const db = getDB()
  const fromPrefix = `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`
  const toPrefix = `${toYear}-${String(toMonth).padStart(2, '0')}-31`
  return db.prepare(`
    SELECT substr(date, 1, 7) as month,
           ROUND(AVG(utilization_rate), 1) as avgRate,
           COUNT(DISTINCT date) as days
    FROM store_daily_utilization
    WHERE date >= ? AND date <= ?
    GROUP BY substr(date, 1, 7)
    ORDER BY month ASC
  `).all(fromPrefix, toPrefix) as { month: string; avgRate: number; days: number }[]
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
