import { scrapeAllStores } from '@/lib/bmScraper'
import { logScrape } from '@/lib/db'
import type { ScrapeProgress } from '@/lib/bmScraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — 11店舗 × 6ページのフェッチで60秒を超えるため

export async function POST(req: Request) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const url = new URL(req.url)
  const yearParam = url.searchParams.get('year')
  const monthParam = url.searchParams.get('month')

  // 過去月の確定スクレイプ用に year/month を受け取れるようにする
  // 未指定なら当月（既存挙動）
  let year = now.getFullYear()
  let month = now.getMonth() + 1
  let today = now.getDate()
  if (yearParam && monthParam) {
    const ty = parseInt(yearParam, 10)
    const tm = parseInt(monthParam, 10)
    if (Number.isFinite(ty) && Number.isFinite(tm) && tm >= 1 && tm <= 12) {
      year = ty
      month = tm
      const targetOrd = ty * 12 + tm
      const nowOrd = now.getFullYear() * 12 + (now.getMonth() + 1)
      // 過去月: 月末日を today として渡す（その月の全日を対象に取り込む）
      // 当月    : 既存どおり今日
      // 将来月: BMに無いので無視（今日扱い）
      today = targetOrd < nowOrd
        ? new Date(ty, tm, 0).getDate()
        : (targetOrd === nowOrd ? now.getDate() : now.getDate())
    }
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
