import { NextRequest, NextResponse } from 'next/server'
import { getAnnualTarget, setAnnualTarget } from '@/lib/db'

export async function GET(req: NextRequest) {
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? '')
  if (isNaN(year)) return NextResponse.json({ error: 'year required' }, { status: 400 })

  const target = getAnnualTarget(year)
  return NextResponse.json({ year, target })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { year, target } = body as { year: number; target: number }

  if (!year || !target || target <= 0) {
    return NextResponse.json({ error: 'year and target required' }, { status: 400 })
  }

  setAnnualTarget(year, target)
  return NextResponse.json({ ok: true, year, target })
}
