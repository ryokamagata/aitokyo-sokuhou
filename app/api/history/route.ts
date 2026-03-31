import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getMonthlyStaffSales,
} from '@/lib/db'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const revalidate = 0

export async function GET() {
  // 2024年8月〜当月
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1

  const fromYear = 2024
  const fromMonth = 8

  const totalMonthly = getMonthlyTotalSales(fromYear, fromMonth, toYear, toMonth)
  const storeMonthly = getMonthlyStoreSales(fromYear, fromMonth, toYear, toMonth)
  const staffMonthly = getMonthlyStaffSales(fromYear, fromMonth, toYear, toMonth)

  // 店舗別を月ごとにグループ化
  const storeByMonth: Record<string, { store: string; sales: number; customers: number }[]> = {}
  for (const row of storeMonthly) {
    if (!storeByMonth[row.month]) storeByMonth[row.month] = []
    storeByMonth[row.month].push({ store: row.store, sales: row.sales, customers: row.customers })
  }

  // スタッフ別: 名前を正規化して同一人物の売上を統合
  // key = normalizedName, value = { month → sales }
  const staffMerged = new Map<string, { displayName: string; monthData: Map<string, number> }>()

  for (const row of staffMonthly) {
    const normalized = normalizeStaffName(row.staff)
    const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`

    let entry = staffMerged.get(normalized)
    if (!entry) {
      entry = { displayName: normalized, monthData: new Map() }
      staffMerged.set(normalized, entry)
    }
    entry.monthData.set(monthKey, (entry.monthData.get(monthKey) ?? 0) + row.sales)
  }

  // スタッフごとに直近月の売上と前月比を計算
  const months = totalMonthly.map(m => m.month)
  const latestMonth = months[months.length - 1] || ''
  const prevMonth = months.length >= 2 ? months[months.length - 2] : ''

  const staffSummary = Array.from(staffMerged.entries()).map(([, { displayName, monthData }]) => {
    const latestSales = monthData.get(latestMonth) ?? 0
    const prevSales = monthData.get(prevMonth) ?? 0
    const growthRate = prevSales > 0 ? ((latestSales - prevSales) / prevSales) * 100 : null

    const monthly = Array.from(monthData.entries())
      .map(([month, sales]) => ({ month, sales }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return {
      staff: displayName,
      latestSales,
      prevSales,
      growthRate,
      monthly,
    }
  }).sort((a, b) => b.latestSales - a.latestSales)

  return NextResponse.json({
    months,
    latestMonth,
    prevMonth,
    totalMonthly,
    storeByMonth,
    staffSummary,
  })
}
