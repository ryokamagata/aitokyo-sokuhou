import { scrapeAllStores } from '@/lib/bmScraper'
import { logScrape } from '@/lib/db'
import type { ScrapeProgress } from '@/lib/bmScraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes

export async function POST(req: Request) {
  const { fromYear, fromMonth, toYear, toMonth } = await req.json().catch(() => ({
    fromYear: 2024,
    fromMonth: 8,
    toYear: 2026,
    toMonth: 2,
  }))

  // Build list of months to scrape
  const months: { year: number; month: number; days: number }[] = []
  let y = fromYear, m = fromMonth
  while (y < toYear || (y === toYear && m <= toMonth)) {
    const days = new Date(y, m, 0).getDate() // last day of month
    months.push({ year: y, month: m, days })
    m++
    if (m > 12) { m = 1; y++ }
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* stream closed */ }
      }

      let totalStored = 0
      const allErrors: string[] = []

      for (let mi = 0; mi < months.length; mi++) {
        const { year, month, days } = months[mi]
        const label = `${year}年${month}月`

        sendEvent({
          type: 'month-start',
          monthIndex: mi,
          totalMonths: months.length,
          label,
        })

        const onProgress = (p: ScrapeProgress) => {
          sendEvent({
            type: 'progress',
            monthIndex: mi,
            totalMonths: months.length,
            label,
            ...p,
          })
        }

        try {
          const result = await scrapeAllStores(year, month, days, onProgress)
          totalStored += result.recordsStored
          if (result.errors.length > 0) {
            allErrors.push(`${label}: ${result.errors.join(', ')}`)
          }
          logScrape(result.storesScraped, result.recordsStored, result.errors.join(' | ') || undefined)

          sendEvent({
            type: 'month-done',
            monthIndex: mi,
            totalMonths: months.length,
            label,
            storesScraped: result.storesScraped,
            recordsStored: result.recordsStored,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          allErrors.push(`${label}: ${msg}`)
          sendEvent({ type: 'month-error', label, error: msg })
        }

        // Brief pause between months
        await new Promise(r => setTimeout(r, 500))
      }

      sendEvent({
        type: 'all-done',
        totalMonths: months.length,
        totalStored,
        errors: allErrors,
      })

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
