import { NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SHEET_ID = '1R5WCaq9R7RVJ_klWRxr4Dx0yGahDeX2186MMoT5tffw'
const YEAR = 2025

// スプレッドシートの店舗略称 → DB上の正式名称 + BM code
const STORE_MAP: Record<string, { name: string; bm_code: string }> = {
  '池袋': { name: "AI TOKYO men's 池袋", bm_code: '63811270' },
  'Ciel': { name: "AI TOKYO Ciel men's 横浜", bm_code: '27468498' },
  '渋谷': { name: 'AI TOKYO 渋谷', bm_code: '69110375' },
  'S': { name: 'AI TOKYO S', bm_code: '12479835' },
  '名古屋': { name: 'AI TOKYO 名古屋栄', bm_code: '28162229' },
  'Rita': { name: 'AI TOKYO Rita', bm_code: '11780846' },
  '横浜': { name: "AI TOKYO men's 横浜", bm_code: '31132259' },
  '下北沢': { name: "AI TOKYO men's 下北沢", bm_code: '46641695' },
  '名駅': { name: 'AI TOKYO 名古屋 2nd', bm_code: '65211838' },
  '福岡': { name: 'AI TOKYO 福岡', bm_code: 'FUKUOKA01' },
}

// ¥記号とカンマを除去して整数に変換
function parseYen(v: string): number {
  if (!v) return 0
  const cleaned = v.replace(/[¥,\s"]/g, '')
  return parseInt(cleaned, 10) || 0
}

// CSV行をパース（ダブルクォートやカンマ対応）
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

function parseCSV(csv: string): string[][] {
  return csv
    .split('\n')
    .filter(line => line.trim())
    .map(line => parseCSVLine(line))
}

// Google Sheetsからシート別CSVを取得
async function fetchSheetCSV(month: number): Promise<string> {
  const sheetName = `${month}月`
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch ${sheetName}: ${res.status}`)
  return res.text()
}

interface StaffRecord {
  storeAbbrev: string
  storeFull: string
  bmCode: string
  staff: string
  sales: number
  customers: number
}

// CSVデータをパースしてスタッフレコードに変換
function parseMonthData(csv: string): StaffRecord[] {
  const rows = parseCSV(csv)
  if (rows.length < 2) return []

  const header = rows[0]

  // フォーマット検出:
  // Early format (月1-5): col0=店舗, col1=名前, col2=総売上, col13=客数 (19列)
  // Late format (月6-12): col0=店舗, col1=スタイリスト歴, col2=名前, col3=総売上, col15=客数 (21列)
  const isLateFormat =
    header[2]?.includes('名前') ||
    header[1]?.includes('スタイリスト') ||
    (rows.length > 1 && /^\d+年$/.test(rows[1]?.[1]?.trim() || ''))

  const storeIdx = 0
  const nameIdx = isLateFormat ? 2 : 1
  const salesIdx = isLateFormat ? 3 : 2
  const customersIdx = isLateFormat ? 15 : 13

  const records: StaffRecord[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const storeAbbrev = row[storeIdx]?.trim()
    const staff = row[nameIdx]?.trim()
    const salesStr = row[salesIdx]?.trim()
    const customersStr = row[customersIdx]?.trim()

    // 店舗・名前・売上がない行はスキップ
    if (!storeAbbrev || !staff || !salesStr) continue

    // 集計行をスキップ
    if (
      storeAbbrev.includes('平均') || storeAbbrev.includes('合計') ||
      storeAbbrev.includes('リピート') || storeAbbrev.includes('客単価') ||
      staff.includes('平均') || staff.includes('合計')
    ) continue

    const storeInfo = STORE_MAP[storeAbbrev]
    if (!storeInfo) continue // 不明な店舗はスキップ

    const sales = parseYen(salesStr)
    const customers = parseInt(customersStr?.replace(/[",\s]/g, ''), 10) || 0

    if (sales <= 0) continue // 売上ゼロはスキップ

    records.push({
      storeAbbrev,
      storeFull: storeInfo.name,
      bmCode: storeInfo.bm_code,
      staff,
      sales,
      customers,
    })
  }

  return records
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const monthsToImport: number[] = body.months || Array.from({ length: 12 }, (_, i) => i + 1)

  const db = getDB()
  const results: {
    month: number
    staffRecords: number
    storeRecords: number
    totalSales: number
    errors: string[]
  }[] = []

  // Prepared statements
  const deleteStaff = db.prepare(
    'DELETE FROM staff_period_sales WHERE year = ? AND month = ? AND bm_code = ?'
  )
  const insertStaff = db.prepare(
    `INSERT INTO staff_period_sales (year, month, store, bm_code, staff, sales, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  )
  const upsertStore = db.prepare(
    `INSERT INTO store_daily_sales (date, store, bm_code, sales, customers, scraped_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date, bm_code) DO UPDATE SET
       store = excluded.store,
       sales = excluded.sales,
       customers = excluded.customers,
       scraped_at = excluded.scraped_at`
  )

  for (const month of monthsToImport) {
    const errors: string[] = []

    try {
      const csv = await fetchSheetCSV(month)
      const records = parseMonthData(csv)

      // 店舗ごとにグループ化
      const byStore = new Map<string, StaffRecord[]>()
      for (const rec of records) {
        const key = rec.bmCode
        if (!byStore.has(key)) byStore.set(key, [])
        byStore.get(key)!.push(rec)
      }

      let staffCount = 0
      let storeCount = 0
      let totalSales = 0

      // トランザクションで一括処理
      const importMonth = db.transaction(() => {
        for (const [bmCode, storeRecords] of byStore) {
          // 既存のスタッフデータを削除して再挿入
          deleteStaff.run(YEAR, month, bmCode)

          for (const rec of storeRecords) {
            insertStaff.run(YEAR, month, rec.storeFull, bmCode, rec.staff, rec.sales)
            staffCount++
          }

          // 店舗月次合計を集計
          const storeTotalSales = storeRecords.reduce((sum, r) => sum + r.sales, 0)
          const storeTotalCustomers = storeRecords.reduce((sum, r) => sum + r.customers, 0)
          totalSales += storeTotalSales

          // 月の15日を代表日として store_daily_sales に挿入
          const dateStr = `${YEAR}-${String(month).padStart(2, '0')}-15`
          upsertStore.run(dateStr, storeRecords[0].storeFull, bmCode, storeTotalSales, storeTotalCustomers)
          storeCount++
        }
      })

      importMonth()

      results.push({ month, staffRecords: staffCount, storeRecords: storeCount, totalSales, errors })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(msg)
      results.push({ month, staffRecords: 0, storeRecords: 0, totalSales: 0, errors })
    }
  }

  return NextResponse.json({
    year: YEAR,
    results,
    summary: {
      totalStaffRecords: results.reduce((s, r) => s + r.staffRecords, 0),
      totalStoreRecords: results.reduce((s, r) => s + r.storeRecords, 0),
      totalSales: results.reduce((s, r) => s + r.totalSales, 0),
      monthsProcessed: results.length,
      monthsWithErrors: results.filter(r => r.errors.length > 0).length,
    },
  })
}

// GET: インポート状況の確認用
export async function GET() {
  const db = getDB()

  const staffCounts = db.prepare(`
    SELECT year, month, COUNT(*) as count, SUM(sales) as total_sales
    FROM staff_period_sales
    WHERE year = ?
    GROUP BY year, month
    ORDER BY month ASC
  `).all(YEAR) as { year: number; month: number; count: number; total_sales: number }[]

  const storeCounts = db.prepare(`
    SELECT substr(date, 1, 7) as month, COUNT(*) as count, SUM(sales) as total_sales
    FROM store_daily_sales
    WHERE date LIKE ?
    GROUP BY substr(date, 1, 7)
    ORDER BY month ASC
  `).all(`${YEAR}-%`) as { month: string; count: number; total_sales: number }[]

  return NextResponse.json({
    year: YEAR,
    staff_period_sales: staffCounts,
    store_daily_sales: storeCounts,
  })
}
