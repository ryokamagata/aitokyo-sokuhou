import { NextResponse } from 'next/server'
import { scrapeAllAnalysis } from '@/lib/bmScraper'
import type { AnalysisType } from '@/lib/analysisTypes'
import { ANALYSIS_TYPES } from '@/lib/analysisTypes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max

export async function POST(req: Request) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()

  // Optional: filter specific types
  let types: AnalysisType[] | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (body.types && Array.isArray(body.types)) {
      types = body.types.filter((t: string) =>
        (ANALYSIS_TYPES as readonly string[]).includes(t)
      ) as AnalysisType[]
    }
  } catch {
    // no body is fine
  }

  try {
    const result = await scrapeAllAnalysis(year, month, today, types)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
