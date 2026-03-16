import { scrapeAllAnalysis } from '@/lib/bmScraper'
import type { AnalysisType } from '@/lib/analysisTypes'
import { ANALYSIS_TYPES } from '@/lib/analysisTypes'
import type { ScrapeProgress } from '@/lib/bmScraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()

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
        const result = await scrapeAllAnalysis(year, month, today, types, onProgress)
        sendEvent({ type: 'done', success: true, ...result })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
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
