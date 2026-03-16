import { scrapeAllStores } from '@/lib/bmScraper'
import { logScrape } from '@/lib/db'
import type { ScrapeProgress } from '@/lib/bmScraper'

export const dynamic = 'force-dynamic'

export async function POST() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const onProgress = (p: ScrapeProgress) => {
        sendEvent({ type: 'progress', ...p })
      }

      try {
        const result = await scrapeAllStores(year, month, today, onProgress)
        logScrape(result.storesScraped, result.recordsStored, result.errors.join(' | ') || undefined)
        sendEvent({ type: 'done', success: true, ...result })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logScrape(0, 0, msg)
        sendEvent({ type: 'done', success: false, error: msg })
      }

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
