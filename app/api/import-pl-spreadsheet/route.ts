import { NextResponse } from 'next/server'
import { upsertCostActual } from '@/lib/db'
import { parsePLSheet } from '@/lib/plParser'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ★月次決算速報値シート
const PL_SHEET_ID = '12Jo2w0pjKi_cUongNdmtzFS0sHbuZDAhWnBSAKxgxBo'

async function fetchSheetCSV(sheetName?: string): Promise<string> {
  const base = `https://docs.google.com/spreadsheets/d/${PL_SHEET_ID}/gviz/tq?tqx=out:csv`
  const url = sheetName ? `${base}&sheet=${encodeURIComponent(sheetName)}` : base
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch PL sheet${sheetName ? ` (${sheetName})` : ''}: ${res.status}`)
  return res.text()
}

/**
 * POST /api/import-pl-spreadsheet
 * body: { sheet?: string, fiscalStartYear?: number, confirmedThrough?: "YYYY-MM" }
 *   - sheet: 取込対象シート名（省略時はデフォルト）
 *   - fiscalStartYear: 「9月」列の年（2025年9月期なら 2025、デフォルト2025）
 *   - confirmedThrough: この年月以前を確定扱い（例 "2026-02" → 3月は予測）
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sheetName: string | undefined = body.sheet
  const fiscalStartYear: number = body.fiscalStartYear ?? 2025
  const confirmedThrough: string | undefined = body.confirmedThrough

  let isConfirmed: (year: number, month: number) => boolean = () => false
  if (confirmedThrough && /^\d{4}-\d{1,2}$/.test(confirmedThrough)) {
    const [cy, cm] = confirmedThrough.split('-').map(Number)
    const cutoff = cy * 12 + cm
    isConfirmed = (y, m) => y * 12 + m <= cutoff
  }

  try {
    const csv = await fetchSheetCSV(sheetName)
    const parsed = parsePLSheet(csv, fiscalStartYear)
    const today = new Date().toISOString().slice(0, 10)
    for (const r of parsed.rows) {
      const confirmed = isConfirmed(r.year, r.month)
      upsertCostActual(
        r.year, r.month, r.accountCode, r.store,
        r.amount,
        confirmed ? 'gsheet_confirmed' : 'gsheet_preview',
        confirmed ? today : null
      )
    }
    return NextResponse.json({
      ok: true,
      summary: {
        sheet: sheetName ?? 'default',
        fiscalStartYear,
        monthsDetected: parsed.monthsDetected,
        rowsImported: parsed.rows.length,
        rowsSkipped: parsed.skipped,
        unmatchedLabels: parsed.unmatched.slice(0, 50),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    sheet_id: PL_SHEET_ID,
    url: `https://docs.google.com/spreadsheets/d/${PL_SHEET_ID}/edit`,
    hint: 'POST with { sheet?: string, fiscalStartYear?: number, confirmedThrough?: "YYYY-MM" } to import. Sheet must be shared as "anyone with the link can view".',
  })
}
