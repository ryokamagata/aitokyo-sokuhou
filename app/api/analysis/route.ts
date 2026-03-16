import { NextRequest, NextResponse } from 'next/server'
import { getAnalysisData, getAllAnalysisTypes } from '@/lib/db'
import { ANALYSIS_LABELS, type AnalysisType } from '@/lib/analysisTypes'

export const dynamic = 'force-dynamic'

type AnalysisRow = {
  analysis_type: string; bm_code: string; store: string
  period_start: string; period_end: string; data_json: string; scraped_at: string
}

function toStoreEntry(r: AnalysisRow) {
  return {
    bm_code: r.bm_code,
    store: r.store,
    data: JSON.parse(r.data_json),
    scraped_at: r.scraped_at,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') as AnalysisType | null
  const yearStr = searchParams.get('year')
  const monthStr = searchParams.get('month')
  const bmCode = searchParams.get('store') || undefined

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = yearStr ? parseInt(yearStr) : now.getFullYear()
  const month = monthStr ? parseInt(monthStr) : now.getMonth() + 1

  // If no type specified, return available types
  if (!type) {
    const types = getAllAnalysisTypes(year, month)
    return NextResponse.json({
      year,
      month,
      types: types.map((t) => ({
        type: t,
        label: ANALYSIS_LABELS[t as AnalysisType] ?? t,
      })),
    })
  }

  // Get data for specific store
  if (bmCode && bmCode !== 'all') {
    const row = getAnalysisData(type, year, month, bmCode) as AnalysisRow | undefined
    return NextResponse.json({
      type,
      label: ANALYSIS_LABELS[type] ?? type,
      stores: row ? [toStoreEntry(row)] : [],
    })
  }

  // Get data for all stores
  const rows = getAnalysisData(type, year, month) as AnalysisRow[]
  return NextResponse.json({
    type,
    label: ANALYSIS_LABELS[type] ?? type,
    stores: Array.isArray(rows) ? rows.map(toStoreEntry) : [],
  })
}
