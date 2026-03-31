import { NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ━━━ 2025年スプレッドシート (月別シート、店舗略称) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SHEET_ID_2025 = '1R5WCaq9R7RVJ_klWRxr4Dx0yGahDeX2186MMoT5tffw'

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

// ━━━ 2026年スプレッドシート (単一シート、店舗フルネーム) ━━━━━━━━━━━━━━━━━━━━━━━━
const SHEET_ID_2026 = '1CA4Jl5gRNp0fifKw4jV-LQ45ghpYNNjNPodwN50_YJE'

// フルネーム → BM code (全角・半角スペース揺れ対応)
const FULL_STORE_MAP: Record<string, string> = {
  'AI TOKYO 渋谷': '69110375',
  'AI TOKYO Rita': '11780846',
  'AI TOKYO S': '12479835',
  'AI TOKYO 名古屋栄': '28162229',
  "AI TOKYO men's 横浜": '31132259',
  "AI TOKYO Ciel men's 横浜": '27468498',
  "AI TOKYO men's 下北沢": '46641695',
  "AI TOKYO men's 池袋": '63811270',
  'ams by AI TOKYO': '94303402',
  'AI TOKYO 名古屋 2nd': '65211838',
  'AITOKYO + Sea店 横浜': '73245379',
  'AITOKYO + Sea店\u3000横浜': '73245379', // 全角スペース対応
  'AI TOKYO 福岡': 'FUKUOKA01',
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
async function fetchSheetCSV2025(month: number): Promise<string> {
  const sheetName = `${month}月`
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID_2025}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch ${sheetName}: ${res.status}`)
  return res.text()
}

async function fetchSheetCSV2026(): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID_2026}/gviz/tq?tqx=out:csv`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch 2026 sheet: ${res.status}`)
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

// 店舗名の正規化（全角スペース→半角、前後空白除去）
function normalizeStoreName(name: string): string {
  return name.replace(/\u3000/g, ' ').trim()
}

// フルネームで店舗をルックアップ
function lookupFullStore(rawName: string): { name: string; bm_code: string } | null {
  const normalized = normalizeStoreName(rawName)
  const bmCode = FULL_STORE_MAP[normalized]
  if (bmCode) return { name: normalized, bm_code: bmCode }

  // 全角スペースバリエーションも試す
  for (const [key, code] of Object.entries(FULL_STORE_MAP)) {
    if (normalizeStoreName(key) === normalized) {
      return { name: normalized, bm_code: code }
    }
  }
  return null
}

// ━━━ 2025年データパース（略称、月別フォーマット） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parseMonthData2025(csv: string): StaffRecord[] {
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

// ━━━ 2026年データパース（フルネーム、単一シート） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parseMonthData2026(csv: string): StaffRecord[] {
  const rows = parseCSV(csv)
  if (rows.length < 2) return []

  // 2026年フォーマット: col0=店舗(フルネーム), col1=名前, col2=総売上, col14=総合客数
  const storeIdx = 0
  const nameIdx = 1
  const salesIdx = 2
  const customersIdx = 14

  const records: StaffRecord[] = []
  const skippedStores = new Set<string>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rawStore = row[storeIdx]?.trim()
    const staff = row[nameIdx]?.trim()
    const salesStr = row[salesIdx]?.trim()
    const customersStr = row[customersIdx]?.trim()

    // 店舗・名前・売上がない行はスキップ
    if (!rawStore || !staff || !salesStr) continue

    // 集計行をスキップ
    if (
      rawStore.includes('平均') || rawStore.includes('合計') ||
      rawStore.includes('リピート') || rawStore.includes('客単価') ||
      staff.includes('平均') || staff.includes('合計')
    ) continue

    const storeInfo = lookupFullStore(rawStore)
    if (!storeInfo) {
      skippedStores.add(rawStore)
      continue
    }

    const sales = parseYen(salesStr)
    const customers = parseInt(customersStr?.replace(/[",\s]/g, ''), 10) || 0

    if (sales <= 0) continue

    records.push({
      storeAbbrev: rawStore,
      storeFull: storeInfo.name,
      bmCode: storeInfo.bm_code,
      staff,
      sales,
      customers,
    })
  }

  if (skippedStores.size > 0) {
    console.log('Skipped unknown stores (2026):', Array.from(skippedStores))
  }

  return records
}

// ━━━ DB書き込み共通ロジック ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function importRecordsToDB(
  records: StaffRecord[],
  year: number,
  month: number,
): { staffCount: number; storeCount: number; totalSales: number } {
  const db = getDB()

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

  const importTx = db.transaction(() => {
    for (const [bmCode, storeRecords] of byStore) {
      deleteStaff.run(year, month, bmCode)

      for (const rec of storeRecords) {
        insertStaff.run(year, month, rec.storeFull, bmCode, rec.staff, rec.sales)
        staffCount++
      }

      const storeTotalSales = storeRecords.reduce((sum, r) => sum + r.sales, 0)
      const storeTotalCustomers = storeRecords.reduce((sum, r) => sum + r.customers, 0)
      totalSales += storeTotalSales

      const dateStr = `${year}-${String(month).padStart(2, '0')}-15`
      upsertStore.run(dateStr, storeRecords[0].storeFull, bmCode, storeTotalSales, storeTotalCustomers)
      storeCount++
    }
  })

  importTx()
  return { staffCount, storeCount, totalSales }
}

// ━━━ POST: インポート実行 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// body: { source?: '2025' | '2026', months?: number[], year?: number, month?: number }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const source: string = body.source || '2025'

  if (source === '2026') {
    // 2026年スプレッドシート（単一シート: 2026年2月）
    const year = body.year || 2026
    const month = body.month || 2
    const errors: string[] = []

    try {
      const csv = await fetchSheetCSV2026()
      const records = parseMonthData2026(csv)
      const { staffCount, storeCount, totalSales } = importRecordsToDB(records, year, month)

      return NextResponse.json({
        source: '2026',
        year,
        month,
        results: [{ month, staffRecords: staffCount, storeRecords: storeCount, totalSales, errors }],
        summary: {
          totalStaffRecords: staffCount,
          totalStoreRecords: storeCount,
          totalSales,
          monthsProcessed: 1,
          monthsWithErrors: 0,
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(msg)
      return NextResponse.json({
        source: '2026',
        year,
        month,
        results: [{ month, staffRecords: 0, storeRecords: 0, totalSales: 0, errors }],
        summary: { totalStaffRecords: 0, totalStoreRecords: 0, totalSales: 0, monthsProcessed: 1, monthsWithErrors: 1 },
      })
    }
  }

  // ━━━ 2025年スプレッドシート（月別シート） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const monthsToImport: number[] = body.months || Array.from({ length: 12 }, (_, i) => i + 1)
  const year = 2025

  const results: {
    month: number
    staffRecords: number
    storeRecords: number
    totalSales: number
    errors: string[]
  }[] = []

  for (const month of monthsToImport) {
    const errors: string[] = []

    try {
      const csv = await fetchSheetCSV2025(month)
      const records = parseMonthData2025(csv)
      const { staffCount, storeCount, totalSales } = importRecordsToDB(records, year, month)
      results.push({ month, staffRecords: staffCount, storeRecords: storeCount, totalSales, errors })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(msg)
      results.push({ month, staffRecords: 0, storeRecords: 0, totalSales: 0, errors })
    }
  }

  return NextResponse.json({
    source: '2025',
    year,
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
    GROUP BY year, month
    ORDER BY year ASC, month ASC
  `).all() as { year: number; month: number; count: number; total_sales: number }[]

  const storeCounts = db.prepare(`
    SELECT substr(date, 1, 7) as month, COUNT(*) as count, SUM(sales) as total_sales
    FROM store_daily_sales
    GROUP BY substr(date, 1, 7)
    ORDER BY month ASC
  `).all() as { month: string; count: number; total_sales: number }[]

  return NextResponse.json({
    staff_period_sales: staffCounts,
    store_daily_sales: storeCounts,
  })
}
