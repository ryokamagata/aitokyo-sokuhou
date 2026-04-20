import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { upsertCostActual } from '@/lib/db'
import { parsePLSheet } from '@/lib/plParser'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/seed-pl-from-text
 * スプレッドシートへの直接アクセスが不可な環境向け。TSV / CSV 本文を body に渡す、
 * または body に `useFixture: true` を指定して同梱の fixture を使う。
 *
 * body: { text?: string, useFixture?: boolean, fiscalStartYear?: number, confirmedThrough?: "YYYY-MM" }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const text: string | undefined = body.text
  const useFixture: boolean = body.useFixture === true
  const fiscalStartYear: number = body.fiscalStartYear ?? 2025
  const confirmedThrough: string | undefined = body.confirmedThrough ?? '2026-02'

  let rawText = text
  if (!rawText && useFixture) {
    const p = path.join(process.cwd(), 'data', 'fixtures', 'seed-pl-fy25.tsv')
    if (!fs.existsSync(p)) {
      return NextResponse.json({ ok: false, error: `fixture not found: ${p}` }, { status: 404 })
    }
    rawText = fs.readFileSync(p, 'utf8')
  }
  if (!rawText) {
    return NextResponse.json({ ok: false, error: 'body.text or body.useFixture=true is required' }, { status: 400 })
  }

  let isConfirmed: (year: number, month: number) => boolean = () => false
  if (confirmedThrough && /^\d{4}-\d{1,2}$/.test(confirmedThrough)) {
    const [cy, cm] = confirmedThrough.split('-').map(Number)
    const cutoff = cy * 12 + cm
    isConfirmed = (y, m) => y * 12 + m <= cutoff
  }

  try {
    const parsed = parsePLSheet(rawText, fiscalStartYear)
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
