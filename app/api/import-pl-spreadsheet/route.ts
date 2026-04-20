import { NextResponse } from 'next/server'
import { upsertCostActual } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 売上速報PLシート（2025年9月〜2026年3月）
const PL_SHEET_ID = '12Jo2w0pjKi_cUongNdmtzFS0sHbuZDAhWnBSAKxgxBo'

// スプレッドシート上の科目ラベル → DB account_code
// 揺れを吸収するため、ラベル文字列は部分一致で判定する
const LABEL_PATTERNS: { pattern: RegExp; code: string }[] = [
  { pattern: /売上高|売上$|総売上/, code: 'revenue' },
  { pattern: /薬剤|材料費/, code: 'cogs_drugs' },
  { pattern: /カード手数料|決済手数料/, code: 'cogs_card_fee' },
  { pattern: /原価/, code: 'cogs_other' },
  { pattern: /役員報酬|給与|固定給/, code: 'personnel_fixed' },
  { pattern: /歩合|業績給|報奨/, code: 'personnel_commission' },
  { pattern: /法定福利|社会保険/, code: 'personnel_social' },
  { pattern: /福利厚生/, code: 'personnel_welfare' },
  { pattern: /地代家賃|家賃/, code: 'rent' },
  { pattern: /共益|管理費/, code: 'rent_common' },
  { pattern: /水道光熱|電気|ガス|水道/, code: 'utility' },
  { pattern: /広告宣伝|販促費|広告費/, code: 'promo_ad' },
  { pattern: /HPB|ホットペッパー|プラットフォーム|販促手数料/, code: 'promo_platform' },
  { pattern: /消耗品/, code: 'sga_supplies' },
  { pattern: /通信費/, code: 'sga_comm' },
  { pattern: /外注|業務委託/, code: 'sga_outsource' },
  { pattern: /旅費|交通費/, code: 'sga_travel' },
  { pattern: /減価償却/, code: 'sga_depreciation' },
  { pattern: /その他|雑費/, code: 'sga_other' },
]

function parseYen(v: string | undefined): number {
  if (!v) return 0
  const cleaned = v.replace(/[¥,\s"]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else current += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { fields.push(current); current = '' }
      else current += ch
    }
  }
  fields.push(current)
  return fields
}

function parseCSV(csv: string): string[][] {
  return csv.split('\n').filter(l => l.trim()).map(parseCSVLine)
}

function classifyLabel(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  for (const { pattern, code } of LABEL_PATTERNS) {
    if (pattern.test(trimmed)) return code
  }
  return null
}

async function fetchSheetCSV(sheetName?: string): Promise<string> {
  const base = `https://docs.google.com/spreadsheets/d/${PL_SHEET_ID}/gviz/tq?tqx=out:csv`
  const url = sheetName ? `${base}&sheet=${encodeURIComponent(sheetName)}` : base
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch PL sheet${sheetName ? ` (${sheetName})` : ''}: ${res.status}`)
  return res.text()
}

/**
 * ヘッダ行から年月カラム（"2025年9月" など）を検出し、その月の列に PL数値を書き込む。
 * シート構造（想定）:
 *   行0: ヘッダ (科目 | 2025年9月 | 2025年10月 | ...)
 *   行1..N: 科目ラベル | 金額 | 金額 | ...
 */
function parseMonthColumns(csv: string): {
  monthColumns: { colIndex: number; year: number; month: number }[]
  rows: string[][]
} {
  const rows = parseCSV(csv)
  const monthColumns: { colIndex: number; year: number; month: number }[] = []
  if (rows.length === 0) return { monthColumns, rows }

  // どの行がヘッダかを探す（先頭数行から「年」「月」を含むセルが2つ以上ある行）
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const header = rows[r]
    const found: { colIndex: number; year: number; month: number }[] = []
    for (let c = 0; c < header.length; c++) {
      const cell = header[c].trim()
      // "2025年9月" or "2025/9" or "2025-09" 等に対応
      const m1 = cell.match(/(\d{4})\s*[年\-\/]\s*(\d{1,2})/)
      if (m1) {
        found.push({ colIndex: c, year: parseInt(m1[1], 10), month: parseInt(m1[2], 10) })
      }
    }
    if (found.length >= 2) {
      // 先頭のデータ行を返す
      return { monthColumns: found, rows: rows.slice(r + 1) }
    }
  }
  return { monthColumns, rows: rows.slice(1) }
}

type ImportSummary = {
  sheetName?: string
  monthsDetected: { year: number; month: number }[]
  rowsImported: number
  rowsSkipped: number
  unmatchedLabels: string[]
}

async function importOneSheet(sheetName: string | undefined, isConfirmedFn: (year: number, month: number) => boolean): Promise<ImportSummary> {
  const csv = await fetchSheetCSV(sheetName)
  const { monthColumns, rows } = parseMonthColumns(csv)
  const unmatched = new Set<string>()
  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const label = row[0]?.trim() ?? ''
    if (!label) { skipped++; continue }
    const code = classifyLabel(label)
    if (!code) { unmatched.add(label); skipped++; continue }
    for (const col of monthColumns) {
      const raw = row[col.colIndex]?.trim() ?? ''
      if (!raw || raw === '-' || raw === '—') continue
      const amount = parseYen(raw)
      if (amount === 0) continue
      const confirmed = isConfirmedFn(col.year, col.month)
      const source = confirmed ? 'gsheet_auto' : 'gsheet_auto'
      const confirmedAt = confirmed ? new Date().toISOString().slice(0, 10) : null
      upsertCostActual(col.year, col.month, code, null, amount, source, confirmedAt)
      imported++
    }
  }

  return {
    sheetName,
    monthsDetected: monthColumns.map(({ year, month }) => ({ year, month })),
    rowsImported: imported,
    rowsSkipped: skipped,
    unmatchedLabels: [...unmatched].slice(0, 50),
  }
}

/**
 * POST /api/import-pl-spreadsheet
 * body: { sheet?: string, confirmedThrough?: "YYYY-MM" }
 *   - sheet: 取込対象シート名（省略時はデフォルトシート）
 *   - confirmedThrough: この年月以前を確定として扱う（例 "2026-02" → 3月は予測扱い）
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sheetName: string | undefined = body.sheet
  const confirmedThrough: string | undefined = body.confirmedThrough

  let isConfirmed: (year: number, month: number) => boolean = () => true
  if (confirmedThrough && /^\d{4}-\d{1,2}$/.test(confirmedThrough)) {
    const [cy, cm] = confirmedThrough.split('-').map(Number)
    const cutoff = cy * 12 + cm
    isConfirmed = (y, m) => y * 12 + m <= cutoff
  }

  try {
    const summary = await importOneSheet(sheetName, isConfirmed)
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    sheet_id: PL_SHEET_ID,
    url: `https://docs.google.com/spreadsheets/d/${PL_SHEET_ID}/edit`,
    hint: 'POST with { sheet?: string, confirmedThrough?: "YYYY-MM" } to import. Sheet must be shared as "anyone with the link can view".',
  })
}
