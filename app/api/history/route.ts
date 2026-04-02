import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getMonthlyStaffSales,
  getAnnualTarget,
} from '@/lib/db'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const revalidate = 0

// 年間サマリー型
interface AnnualMonthDetail {
  month: number       // 1-12
  sales: number
  customers: number
  isProjected: boolean // true = 予測値
}

interface AnnualSummary {
  year: number
  total: number
  customers: number
  monthDetails: AnnualMonthDetail[]
  isComplete: boolean   // 12ヶ月すべて実績あり
  actualMonths: number  // 実績月数
}

interface Projection {
  currentYear: number
  projectedTotal: number
  projectedCustomers: number
  ytdTotal: number
  ytdCustomers: number
  ytdMonths: number
  avgYoYGrowthRate: number | null      // 前年同月比の平均成長率（完了月のみ）
  monthDetails: AnnualMonthDetail[]     // 12ヶ月分（実績+予測）
  prevYearTotal: number
  yoyProjectedGrowth: number | null     // 着地予測の前年比
  currentMonthEstimate: number | null   // 今月着地予測
  conservativeTotal: number             // 堅実予測（年間）
  optimisticTotal: number               // 高め見込み（年間）
  annualTarget: number | null           // 年間目標
}

export async function GET() {
  // 2024年8月〜当月
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const toYear = now.getFullYear()
  const toMonth = now.getMonth() + 1
  const today = now.getDate()
  const daysInCurrentMonth = new Date(toYear, toMonth, 0).getDate()
  const currentMonthKey = `${toYear}-${String(toMonth).padStart(2, '0')}`

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

  // ━━━ スタッフ別 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  // スタッフデータが存在する月を特定
  const staffMonthsSet = new Set<string>()
  for (const [, { monthData }] of staffMerged) {
    for (const mk of monthData.keys()) staffMonthsSet.add(mk)
  }
  const staffMonthsSorted = Array.from(staffMonthsSet).sort()

  // 完了月 vs 今月（進行中）を分離
  const completedStaffMonths = staffMonthsSorted.filter(m => m < currentMonthKey)
  const hasCurrentMonthStaff = staffMonthsSorted.includes(currentMonthKey)

  // ランキング基準: 最新の完了月（前月）
  const staffBaseMonth = completedStaffMonths[completedStaffMonths.length - 1] || ''
  const staffPrevMonth = completedStaffMonths.length >= 2 ? completedStaffMonths[completedStaffMonths.length - 2] : ''
  const staffPrev2Month = completedStaffMonths.length >= 3 ? completedStaffMonths[completedStaffMonths.length - 3] : ''
  const staffCurrentMonth = hasCurrentMonthStaff ? currentMonthKey : ''

  const months = totalMonthly.map(m => m.month)
  const latestMonth = months[months.length - 1] || ''
  const prevMonth = months.length >= 2 ? months[months.length - 2] : ''

  // スタッフ別: 完了月の売上30万円以下を除外
  const MIN_SALES_FILTER = 300000

  const staffSummary = Array.from(staffMerged.entries()).map(([, { displayName, monthData }]) => {
    const baseSales = monthData.get(staffBaseMonth) ?? 0        // 前月(完了・ランキング基準)
    const prevSales = monthData.get(staffPrevMonth) ?? 0        // 前々月
    const prev2Sales = monthData.get(staffPrev2Month) ?? 0      // 3ヶ月前
    const currentSales = staffCurrentMonth ? (monthData.get(staffCurrentMonth) ?? 0) : 0  // 今月(進行中)
    const growthRate = prevSales > 0 ? ((baseSales - prevSales) / prevSales) * 100 : null

    const monthly = Array.from(monthData.entries())
      .map(([month, sales]) => ({ month, sales }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return {
      staff: displayName,
      baseSales,
      prevSales,
      prev2Sales,
      currentSales,
      growthRate,
      monthly,
    }
  })
  .filter(s => s.baseSales > MIN_SALES_FILTER)
  .sort((a, b) => b.baseSales - a.baseSales)

  // ━━━ 年間合計 & 着地予測 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const byYear = new Map<number, Map<number, { sales: number; customers: number }>>()
  for (const m of totalMonthly) {
    const [yStr, mStr] = m.month.split('-')
    const y = parseInt(yStr)
    const mo = parseInt(mStr)
    if (!byYear.has(y)) byYear.set(y, new Map())
    byYear.get(y)!.set(mo, { sales: m.sales, customers: m.customers })
  }

  // 年間サマリーを生成
  const annualSummaries: AnnualSummary[] = []
  for (const [year, monthMap] of Array.from(byYear.entries()).sort((a, b) => a[0] - b[0])) {
    const details: AnnualMonthDetail[] = []
    let total = 0
    let customers = 0
    let actualMonths = 0

    for (let mo = 1; mo <= 12; mo++) {
      const data = monthMap.get(mo)
      if (data) {
        // 今年の今月は「進行中」なので完了実績から除外
        const isCurrentPartial = year === toYear && mo === toMonth
        if (!isCurrentPartial) {
          details.push({ month: mo, sales: data.sales, customers: data.customers, isProjected: false })
          total += data.sales
          customers += data.customers
          actualMonths++
        }
      }
    }

    annualSummaries.push({
      year,
      total,
      customers,
      monthDetails: details,
      isComplete: actualMonths === 12,
      actualMonths,
    })
  }

  // 着地予測: 完了月のみで成長率を計算
  let projection: Projection | null = null
  const currentYear = toYear
  const currentYearData = byYear.get(currentYear)
  const prevYearNum = currentYear - 1
  const prevYearData = byYear.get(prevYearNum)

  if (currentYearData && prevYearData) {
    // 完了月のみ（今月を除く）
    const completedMonthNumbers = Array.from(currentYearData.keys()).filter(mo => mo !== toMonth)
    const isComplete = completedMonthNumbers.length === 12

    if (!isComplete) {
      // 完了月のみで前年同月比を計算
      const yoyRates: number[] = []
      const yoyCustomerRates: number[] = []
      for (const mo of completedMonthNumbers) {
        const prev = prevYearData.get(mo)
        const curr = currentYearData.get(mo)
        if (prev && curr && prev.sales > 0) {
          yoyRates.push((curr.sales - prev.sales) / prev.sales)
        }
        if (prev && curr && prev.customers > 0) {
          yoyCustomerRates.push((curr.customers - prev.customers) / prev.customers)
        }
      }

      const avgGrowthRate = yoyRates.length > 0
        ? yoyRates.reduce((a, b) => a + b, 0) / yoyRates.length
        : null
      const avgCustomerGrowthRate = yoyCustomerRates.length > 0
        ? yoyCustomerRates.reduce((a, b) => a + b, 0) / yoyCustomerRates.length
        : null

      // ── 今月着地予測 ──
      // 前月売上 × 前年比変動パターン + 今月実績ペースのブレンド
      const currentMonthActual = currentYearData.get(toMonth)
      const prevYearCurrentMonthData = prevYearData.get(toMonth)
      let currentMonthEstimate: number | null = null
      let currentMonthCustEstimate: number | null = null

      if (prevYearCurrentMonthData) {
        // 方法1: 前年同月 × (1 + 完了月平均成長率)
        const yoyEstimate = avgGrowthRate !== null
          ? Math.round(prevYearCurrentMonthData.sales * (1 + avgGrowthRate))
          : prevYearCurrentMonthData.sales
        const yoyCustEstimate = avgCustomerGrowthRate !== null
          ? Math.round(prevYearCurrentMonthData.customers * (1 + avgCustomerGrowthRate))
          : prevYearCurrentMonthData.customers

        if (currentMonthActual && currentMonthActual.sales > 0) {
          // 方法2: 今月実績 ÷ 経過日数 × 月日数（日割りペース）
          const daysElapsed = Math.max(today - 1, 1) // 締め日考慮: 昨日までのデータ
          const paceEstimate = Math.round((currentMonthActual.sales / daysElapsed) * daysInCurrentMonth)
          const paceCustEstimate = Math.round((currentMonthActual.customers / daysElapsed) * daysInCurrentMonth)

          // ブレンド: 月が進むほどペースを信頼
          const monthProgress = daysElapsed / daysInCurrentMonth
          // 0-30%: YoY 80%, pace 20%
          // 30-70%: 線形補間
          // 70-100%: YoY 20%, pace 80%
          let paceWeight: number
          if (monthProgress < 0.3) {
            paceWeight = 0.2
          } else if (monthProgress > 0.7) {
            paceWeight = 0.8
          } else {
            paceWeight = 0.2 + (monthProgress - 0.3) / 0.4 * 0.6
          }

          currentMonthEstimate = Math.round(paceEstimate * paceWeight + yoyEstimate * (1 - paceWeight))
          currentMonthCustEstimate = Math.round(paceCustEstimate * paceWeight + yoyCustEstimate * (1 - paceWeight))
        } else {
          // 今月データなし → YoYのみ
          currentMonthEstimate = yoyEstimate
          currentMonthCustEstimate = yoyCustEstimate
        }
      }

      // 12ヶ月の詳細（完了実績 + 今月予測 + 未来予測）
      const monthDetails: AnnualMonthDetail[] = []
      let projectedTotal = 0
      let projectedCustomers = 0
      let ytdTotal = 0
      let ytdCustomers = 0
      let ytdMonths = 0

      for (let mo = 1; mo <= 12; mo++) {
        if (mo === toMonth) {
          // 今月: 着地予測を使用
          if (currentMonthEstimate !== null) {
            monthDetails.push({
              month: mo,
              sales: currentMonthEstimate,
              customers: currentMonthCustEstimate ?? 0,
              isProjected: true,
            })
            projectedTotal += currentMonthEstimate
            projectedCustomers += currentMonthCustEstimate ?? 0
          }
        } else {
          const actual = currentYearData.get(mo)
          if (actual) {
            // 完了月の実績
            monthDetails.push({
              month: mo,
              sales: actual.sales,
              customers: actual.customers,
              isProjected: false,
            })
            projectedTotal += actual.sales
            projectedCustomers += actual.customers
            ytdTotal += actual.sales
            ytdCustomers += actual.customers
            ytdMonths++
          } else {
            // 未来月: 前年同月 × (1 + 平均成長率)
            const prevMonthData = prevYearData.get(mo)
            if (prevMonthData && avgGrowthRate !== null) {
              const projSales = Math.round(prevMonthData.sales * (1 + avgGrowthRate))
              const projCust = avgCustomerGrowthRate !== null
                ? Math.round(prevMonthData.customers * (1 + avgCustomerGrowthRate))
                : 0
              monthDetails.push({
                month: mo,
                sales: projSales,
                customers: projCust,
                isProjected: true,
              })
              projectedTotal += projSales
              projectedCustomers += projCust
            }
          }
        }
      }

      const prevYearTotal = Array.from(prevYearData.values()).reduce((s, v) => s + v.sales, 0)

      // 堅実予測: 標準予測の95%
      const conservativeTotal = Math.round(projectedTotal * 0.95)

      // 高め見込み: 標準予測の105%
      const optimisticTotal = Math.round(projectedTotal * 1.05)

      // 年間目標
      const annualTarget = getAnnualTarget(currentYear)

      projection = {
        currentYear,
        projectedTotal,
        projectedCustomers,
        ytdTotal,
        ytdCustomers,
        ytdMonths,
        avgYoYGrowthRate: avgGrowthRate !== null ? avgGrowthRate * 100 : null,
        monthDetails,
        prevYearTotal,
        yoyProjectedGrowth: prevYearTotal > 0
          ? ((projectedTotal - prevYearTotal) / prevYearTotal) * 100
          : null,
        currentMonthEstimate,
        conservativeTotal,
        optimisticTotal,
        annualTarget,
      }
    }
  }

  return NextResponse.json({
    months,
    latestMonth,
    prevMonth,
    staffBaseMonth,
    staffPrevMonth,
    staffPrev2Month,
    staffCurrentMonth,
    totalMonthly,
    storeByMonth,
    staffSummary,
    annualSummaries,
    projection,
  })
}
