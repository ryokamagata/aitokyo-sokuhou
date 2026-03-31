import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getMonthlyStaffSales,
} from '@/lib/db'

export const revalidate = 0

export async function GET() {
  // 2024年9月〜当月
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1

  const fromYear = 2024
  const fromMonth = 9

  const totalMonthly = getMonthlyTotalSales(fromYear, fromMonth, toYear, toMonth)
  const storeMonthly = getMonthlyStoreSales(fromYear, fromMonth, toYear, toMonth)
  const staffMonthly = getMonthlyStaffSales(fromYear, fromMonth, toYear, toMonth)

  // 店舗別を月ごとにグループ化
  const storeByMonth: Record<string, { store: string; sales: number; customers: number }[]> = {}
  for (const row of storeMonthly) {
    if (!storeByMonth[row.month]) storeByMonth[row.month] = []
    storeByMonth[row.month].push({ store: row.store, sales: row.sales, customers: row.customers })
  }

  // スタッフ別: 全月のデータを集約してスタッフごとの月次推移を作る
  const staffMap: Record<string, { month: string; sales: number }[]> = {}
  for (const row of staffMonthly) {
    const monthKey = `${row.year}-${String(row.month).padStart(2, '0')}`
    if (!staffMap[row.staff]) staffMap[row.staff] = []
    staffMap[row.staff].push({ month: monthKey, sales: row.sales })
  }

  // スタッフごとに直近月の売上と前月比を計算
  const months = totalMonthly.map(m => m.month)
  const latestMonth = months[months.length - 1] || ''
  const prevMonth = months.length >= 2 ? months[months.length - 2] : ''

  const staffSummary = Object.entries(staffMap).map(([staff, data]) => {
    const latestData = data.find(d => d.month === latestMonth)
    const prevData = data.find(d => d.month === prevMonth)
    const latestSales = latestData?.sales ?? 0
    const prevSales = prevData?.sales ?? 0
    const growthRate = prevSales > 0 ? ((latestSales - prevSales) / prevSales) * 100 : null
    return {
      staff,
      latestSales,
      prevSales,
      growthRate,
      monthly: data.sort((a, b) => a.month.localeCompare(b.month)),
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
