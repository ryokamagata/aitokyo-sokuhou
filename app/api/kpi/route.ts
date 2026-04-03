import { NextRequest, NextResponse } from 'next/server'
import {
  getAllKpiValues,
  setKpiValue,
  getMonthlyTotalSales,
  getPerStoreVisitors,
  getPerStoreCycle,
  getMonthlyStaffSales,
} from '@/lib/db'
import { EXECUTIVES, calculateScore, getScoreRank, getCurrentQuarter, getQuarterMonths } from '@/lib/kpiConfig'
import { isClosedStore } from '@/lib/stores'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const revalidate = 0

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const currentMonth = now.getMonth() + 1
  const currentQ = getCurrentQuarter(currentMonth)

  // 手動入力KPI値を取得
  const manualKpis = getAllKpiValues(year)

  // 自動計算KPI値を取得
  const autoKpis: Record<string, Record<number, number>> = {}

  // 年間売上
  const allMonthly = getMonthlyTotalSales(year, 1, year, 12)
  const annualRevenue = allMonthly.reduce((s, m) => s + m.sales, 0)
  autoKpis['annual_revenue'] = { 0: Math.round(annualRevenue / 100_000_000 * 100) / 100 } // 億円

  // 月別の新規人数・リターン率・生産性・客単価を計算
  for (let mo = 1; mo <= currentMonth; mo++) {
    // 新規人数（全店合計）
    const visitors = getPerStoreVisitors(year, mo)
    const totalNewCustomers = visitors
      .filter(v => !isClosedStore(v.store))
      .reduce((s, v) => s + v.new_customers, 0)
    if (totalNewCustomers > 0) {
      if (!autoKpis['new_customers']) autoKpis['new_customers'] = {}
      autoKpis['new_customers'][mo] = totalNewCustomers
    }

    // リターン率（全店平均）
    const cycles = getPerStoreCycle(year, mo)
    const returnRates = cycles
      .filter(c => !isClosedStore(c.store) && c.new_return_3m > 0)
      .map(c => c.new_return_3m)
    if (returnRates.length > 0) {
      if (!autoKpis['return_rate']) autoKpis['return_rate'] = {}
      autoKpis['return_rate'][mo] = Math.round(returnRates.reduce((a, b) => a + b, 0) / returnRates.length * 10) / 10
    }

    // 月間売上データ
    const monthSales = allMonthly.find(m => m.month === `${year}-${String(mo).padStart(2, '0')}`)

    // 生産性（1人あたり売上 = 売上 ÷ スタッフ数、万円単位）
    const staffData = getMonthlyStaffSales(year, mo, year, mo)
    const activeStaff = new Set<string>()
    for (const s of staffData) {
      const name = normalizeStaffName(s.staff)
      if (name && name !== 'フリー' && name !== '不明' && s.sales > 0) activeStaff.add(name)
    }
    if (monthSales && activeStaff.size > 0) {
      if (!autoKpis['productivity']) autoKpis['productivity'] = {}
      autoKpis['productivity'][mo] = Math.round(monthSales.sales / activeStaff.size / 10000)
    }

    // 平均客単価
    if (monthSales && monthSales.customers > 0) {
      if (!autoKpis['avg_unit_price']) autoKpis['avg_unit_price'] = {}
      autoKpis['avg_unit_price'][mo] = Math.round(monthSales.sales / monthSales.customers)
    }
  }

  // 各責任者のスコアカードを計算
  const executives = EXECUTIVES.map(exec => {
    const kpiResults = exec.kpis.map(kpi => {
      const source = kpi.source === 'auto' ? autoKpis : manualKpis
      const monthlyValues = source[kpi.key] ?? {}

      // Q期間の値を集計
      const qMonths = getQuarterMonths(currentQ)
      const qValues = qMonths
        .map(m => monthlyValues[m])
        .filter((v): v is number => v !== undefined && v !== null)

      let qValue: number | null = null
      if (qValues.length > 0) {
        qValue = kpi.mode === 'sum'
          ? qValues.reduce((a, b) => a + b, 0)
          : Math.round(qValues.reduce((a, b) => a + b, 0) / qValues.length * 10) / 10
      }

      // 特殊: annual_revenueは年間合計
      if (kpi.key === 'annual_revenue') {
        qValue = autoKpis['annual_revenue']?.[0] ?? null
      }

      // スコア計算
      const isReverse = kpi.key === 'turnover'
      const score = qValue !== null ? calculateScore(qValue, kpi.scoring, isReverse) : null
      const target = kpi.quarterTargets[currentQ] ?? null

      return {
        key: kpi.key,
        label: kpi.label,
        unit: kpi.unit,
        source: kpi.source,
        target,
        currentValue: qValue,
        score,
        maxScore: 30,
        monthlyValues,
        monthlyTargets: qMonths.map(m => ({
          month: m,
          value: monthlyValues[m] ?? null,
        })),
      }
    })

    const totalScore = kpiResults.reduce((s, k) => s + (k.score ?? 0), 0)
    const maxPossible = kpiResults.length * 30
    const rank = getScoreRank(totalScore, exec.scoreRanges)

    return {
      id: exec.id,
      name: exec.name,
      role: exec.role,
      description: exec.description,
      kpis: kpiResults,
      totalScore,
      maxScore: maxPossible,
      rank: rank.rank,
      reward: rank.reward,
    }
  })

  return NextResponse.json({
    year,
    currentQuarter: currentQ,
    currentMonth,
    quarterLabel: `${currentQ}Q（${getQuarterMonths(currentQ).join('・')}月）`,
    executives,
  })
}

// KPI手動入力
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { year, month, key, value } = body
  if (!year || !month || !key || value === undefined) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }
  setKpiValue(year, month, key, value)
  return NextResponse.json({ ok: true })
}
