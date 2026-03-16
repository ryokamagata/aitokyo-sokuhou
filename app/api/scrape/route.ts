import { NextResponse } from 'next/server'
import { scrapeAllStores } from '@/lib/bmScraper'
import { logScrape } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()

  try {
    const result = await scrapeAllStores(year, month, today)
    logScrape(result.storesScraped, result.recordsStored, result.errors.join(' | ') || undefined)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logScrape(0, 0, msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
