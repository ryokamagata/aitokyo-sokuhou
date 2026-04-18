import { scrapeAllStores } from './bmScraper'
import { getLastScrapeTime, logScrape } from './db'

// 売上締め時刻 (JST)
export const CUTOFF_HOUR = 20
export const CUTOFF_MINUTE = 45

let inFlight: Promise<void> | null = null

function jstNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
}

function isPastCutoff(d: Date): boolean {
  const h = d.getHours()
  const m = d.getMinutes()
  return h > CUTOFF_HOUR || (h === CUTOFF_HOUR && m >= CUTOFF_MINUTE)
}

function todaysCutoff(d: Date): Date {
  const c = new Date(d)
  c.setHours(CUTOFF_HOUR, CUTOFF_MINUTE, 0, 0)
  return c
}

/**
 * 当日の締め時刻 (20:45 JST) 以降にアクセスがあった際、
 * 前回スクレイプが今日の締め時刻より前なら自動で再スクレイプする。
 * 同時実行はモジュールレベルの Promise でガードする。
 */
export async function ensureFreshScrape(): Promise<void> {
  const now = jstNow()
  if (!isPastCutoff(now)) return

  const last = getLastScrapeTime()
  if (last) {
    const lastDate = new Date(last)
    if (lastDate >= todaysCutoff(now)) return
  }

  if (inFlight) {
    await inFlight
    return
  }

  inFlight = (async () => {
    try {
      const result = await scrapeAllStores(now.getFullYear(), now.getMonth() + 1, now.getDate())
      logScrape(result.storesScraped, result.recordsStored, result.errors.join(' | ') || undefined)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logScrape(0, 0, msg)
    } finally {
      inFlight = null
    }
  })()

  await inFlight
}
