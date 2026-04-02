import { NextRequest, NextResponse } from 'next/server'
import {
  getStoreOpeningPlans,
  upsertStoreOpeningPlan,
  deleteStoreOpeningPlan,
} from '@/lib/db'

export const revalidate = 0

// 出店計画一覧取得
export async function GET(req: NextRequest) {
  const yearStr = req.nextUrl.searchParams.get('year')
  const year = yearStr ? parseInt(yearStr) : undefined
  if (yearStr && isNaN(year!)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }
  const plans = getStoreOpeningPlans(year)
  return NextResponse.json({ plans })
}

// 出店計画の登録・更新
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { year, opening_month, store_name, max_monthly_revenue, seats } = body as {
    year: number
    opening_month: number
    store_name: string
    max_monthly_revenue: number
    seats: number
  }

  if (!year || !opening_month || !store_name || !max_monthly_revenue) {
    return NextResponse.json({ error: 'year, opening_month, store_name, max_monthly_revenue are required' }, { status: 400 })
  }
  if (opening_month < 1 || opening_month > 12) {
    return NextResponse.json({ error: 'opening_month must be 1-12' }, { status: 400 })
  }

  upsertStoreOpeningPlan({
    year,
    opening_month,
    store_name,
    max_monthly_revenue,
    seats: seats ?? 0,
  })

  return NextResponse.json({ ok: true })
}

// 出店計画の削除
export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id')
  const id = idStr ? parseInt(idStr) : NaN
  if (isNaN(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  deleteStoreOpeningPlan(id)
  return NextResponse.json({ ok: true })
}
