import { NextRequest, NextResponse } from 'next/server'
import { getPlanGrowthRate, setPlanGrowthRate } from '@/lib/db'

export const revalidate = 0

// 計画成長率の取得
export async function GET(req: NextRequest) {
  const yearStr = req.nextUrl.searchParams.get('year')
  const year = yearStr ? parseInt(yearStr) : NaN
  if (isNaN(year)) {
    return NextResponse.json({ error: 'year required' }, { status: 400 })
  }
  return NextResponse.json({ year, growth_rate: getPlanGrowthRate(year) })
}

// 計画成長率の設定（growth_rate: 小数 0.05 = +5%、null で自動に戻す）
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { year, growth_rate } = body as { year: number; growth_rate: number | null }

  if (!year) {
    return NextResponse.json({ error: 'year required' }, { status: 400 })
  }
  if (growth_rate !== null && (typeof growth_rate !== 'number' || growth_rate < -1 || growth_rate > 5)) {
    return NextResponse.json({ error: 'growth_rate must be null or a number between -1 and 5' }, { status: 400 })
  }

  setPlanGrowthRate(year, growth_rate)
  return NextResponse.json({ ok: true })
}
