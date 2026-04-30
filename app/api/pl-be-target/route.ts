import { NextResponse } from 'next/server'
import { getKpiValue, setKpiValue } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * 経営者の損益分岐点目標値（経営感覚値）を保存・取得するAPI。
 * システムの自動算出値と並べて表示するため。
 *
 * 保存先: executive_kpi テーブル, kpi_key='be_target_revenue'
 *
 * GET /api/pl-be-target?year=YYYY&month=M
 *   → { value: number | null }
 * POST /api/pl-be-target
 *   body: { year, month, value }
 */

const KPI_KEY = 'be_target_revenue'
const DEFAULT_BE_TARGET = 88_000_000 // 全店舗 月次BE 8800万（鎌形さん経営感覚）

export async function GET(req: Request) {
  const url = new URL(req.url)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = parseInt(url.searchParams.get('year') ?? String(now.getFullYear()), 10)
  const month = parseInt(url.searchParams.get('month') ?? String(now.getMonth() + 1), 10)

  let value = getKpiValue(year, month, KPI_KEY)
  if (value === null) {
    // 月別が無ければ年次（month=0）に保存された全社デフォルトを参照
    value = getKpiValue(year, 0, KPI_KEY)
  }
  return NextResponse.json({
    year, month,
    value,
    isDefault: value === null,
    suggestedDefault: DEFAULT_BE_TARGET,
  })
}

export async function POST(req: Request) {
  let body: { year?: number; month?: number; value?: number; applyToAllMonths?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 })
  }
  const { year, month, value, applyToAllMonths } = body
  if (typeof year !== 'number' || typeof month !== 'number') {
    return NextResponse.json({ ok: false, error: 'year/month required' }, { status: 400 })
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return NextResponse.json({ ok: false, error: 'value must be a non-negative number' }, { status: 400 })
  }

  if (applyToAllMonths) {
    // 年次デフォルトとして保存（month=0）
    setKpiValue(year, 0, KPI_KEY, Math.round(value))
  } else {
    setKpiValue(year, month, KPI_KEY, Math.round(value))
  }
  return NextResponse.json({ ok: true, year, month, value: Math.round(value) })
}
