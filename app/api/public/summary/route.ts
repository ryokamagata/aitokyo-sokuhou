import { NextRequest, NextResponse } from 'next/server'
import {
  getScrapedDailySales,
  getScrapedStoreSales,
  getScrapedStaffSales,
  getTarget,
  getLastScrapeTime,
  getPerStoreVisitors,
  getPerStoreUsers,
  getPerStoreCycle,
} from '@/lib/db'
import { computeForecast } from '@/lib/forecastEngine'
import { isClosedStore } from '@/lib/stores'
import { normalizeStaffName } from '@/lib/staffNormalize'
import { ensureFreshScrape, CUTOFF_HOUR, CUTOFF_MINUTE } from '@/lib/autoScrape'

export const revalidate = 0

// レート制限用の簡易カウンター（プロセス内メモリ）
const rateLimit = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW = 60_000 // 1分

export async function GET(request: NextRequest) {
  // 1. APIキー認証
  const key = request.nextUrl.searchParams.get('key')
  const expectedKey = process.env.PUBLIC_API_KEY
  if (!expectedKey || key !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. レート制限
  const now = Date.now()
  const clientId = key // APIキー単位でレート制限
  const bucket = rateLimit.get(clientId)
  if (bucket && bucket.resetAt > now) {
    if (bucket.count >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 10 requests per minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
    bucket.count++
  } else {
    rateLimit.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
  }

  await ensureFreshScrape()

  // 3. 現在の年月日を取得（JST）
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = jstNow.getFullYear()
  const month = jstNow.getMonth() + 1
  const calendarToday = jstNow.getDate()
  const hour = jstNow.getHours()
  const minute = jstNow.getMinutes()
  const today = (hour > CUTOFF_HOUR || (hour === CUTOFF_HOUR && minute >= CUTOFF_MINUTE)) ? calendarToday : calendarToday - 1
  const daysInMonth = new Date(year, month, 0).getDate()

  // 4. DBから最新データを取得（既存のダッシュボードと同じ関数を使用）
  const scrapedDaily = getScrapedDailySales(year, month)
  const cutoffDate = `${year}-${String(month).padStart(2, '0')}-${String(Math.max(today, 0)).padStart(2, '0')}`
  const dailySales = scrapedDaily
    .filter(r => today > 0 && r.date <= cutoffDate)
    .map(r => ({
      date: r.date,
      dayOfWeek: new Date(r.date + 'T00:00:00').getDay(),
      totalAmount: r.sales,
      customers: r.customers,
      stores: {} as Record<string, number>,
      staff: {} as Record<string, number>,
    }))

  const storeSales = getScrapedStoreSales(year, month)
  const staffSalesRaw = getScrapedStaffSales(year, month)
  const monthlyTarget = getTarget(year, month)
  const lastScrapeTime = getLastScrapeTime()

  // 着地予測
  const forecast = computeForecast(dailySales, year, month, today)
  const totalSales = forecast.actualTotal
  const effectiveDays = Math.max(today, 1)
  const dailyAvg = Math.round(totalSales / effectiveDays)

  // 達成率
  const achievementRate = monthlyTarget && monthlyTarget > 0
    ? Math.round((totalSales / monthlyTarget) * 1000) / 10
    : null

  // 顧客分析
  const visitorStores = getPerStoreVisitors(year, month)
  const nominated = visitorStores.reduce((s, v) => s + v.nominated, 0)
  const freeVisit = visitorStores.reduce((s, v) => s + v.free_visit, 0)
  const newCustomers = visitorStores.reduce((s, v) => s + v.new_customers, 0)
  const totalCustomers = nominated + freeVisit

  // 客単価
  const avgUnitPrice = totalCustomers > 0 ? Math.round(totalSales / totalCustomers) : 0

  // 指名率・フリー率・新規率
  const designatedRate = totalCustomers > 0
    ? Math.round(nominated / totalCustomers * 1000) / 10
    : 0
  const freeRate = totalCustomers > 0
    ? Math.round(freeVisit / totalCustomers * 1000) / 10
    : 0
  const newRate = totalCustomers > 0
    ? Math.round(newCustomers / totalCustomers * 1000) / 10
    : 0

  // リターン率
  const cycleStores = getPerStoreCycle(year, month)
  const returnRates = cycleStores
    .filter(c => !isClosedStore(c.store) && c.new_return_3m > 0)
    .map(c => c.new_return_3m)
  const returnRate3m = returnRates.length > 0
    ? Math.round(returnRates.reduce((a, b) => a + b, 0) / returnRates.length * 10) / 10
    : null

  // 会員
  const userStores = getPerStoreUsers(year, month)
  const totalUsers = userStores.reduce((s, u) => s + u.total_users, 0)
  const appMembers = userStores.reduce((s, u) => s + u.app_members, 0)
  const appMemberRate = totalUsers > 0
    ? Math.round(appMembers / totalUsers * 1000) / 10
    : 0

  // 店舗別
  const stores = storeSales
    .filter(s => !isClosedStore(s.store))
    .map(s => {
      const visitor = visitorStores.find(v => v.store === s.store)
      const storeName = s.store
        .replace(/^AI\s*TOKYO\s*/i, '')
        .replace(/^AITOKYO\s*\+?\s*/i, '')
        .replace(/^ams by AI\s*TOKYO\s*/i, 'ams ')
        .trim()
      const storeNominated = visitor?.nominated ?? 0
      const storeFree = visitor?.free_visit ?? 0
      const storeTotal = storeNominated + storeFree
      return {
        name: storeName,
        sales: s.sales,
        customers: storeTotal,
        designated_rate: storeTotal > 0 ? Math.round(storeNominated / storeTotal * 1000) / 10 : 0,
        new_count: visitor?.new_customers ?? 0,
      }
    })
    .sort((a, b) => b.sales - a.sales)

  // スタッフ別TOP10
  const staffMap = new Map<string, number>()
  for (const s of staffSalesRaw) {
    const name = normalizeStaffName(s.staff)
    if (!name || name === 'フリー' || name === '不明') continue
    staffMap.set(name, (staffMap.get(name) ?? 0) + s.sales)
  }
  const topStaff = [...staffMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, sales]) => ({ name, sales }))

  // 5. レスポンス構築
  const response = {
    updated_at: lastScrapeTime ?? jstNow.toISOString(),
    month: `${year}-${String(month).padStart(2, '0')}`,
    day: today,
    days_in_month: daysInMonth,
    monthly_target: monthlyTarget,
    sales: {
      cumulative: totalSales,
      projected: forecast.forecastTotal,
      achievement_rate: achievementRate,
      daily_average: dailyAvg,
    },
    customers: {
      total: totalCustomers,
      designated: nominated,
      free: freeVisit,
      new: newCustomers,
      designated_rate: designatedRate,
      free_rate: freeRate,
      new_rate: newRate,
    },
    unit_price: {
      average: avgUnitPrice,
    },
    kpi: {
      return_rate_3month: returnRate3m,
      app_members: appMembers,
      app_member_rate: appMemberRate,
    },
    stores,
    top_staff: topStaff,
  }

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    },
  })
}
