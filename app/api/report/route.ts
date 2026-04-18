import { NextResponse } from 'next/server'
import {
  getMonthlyTotalSales,
  getMonthlyStoreSales,
  getMonthlyStaffSales,
  getAnnualTarget,
  getMonthlyTargets,
  getPerStoreVisitors,
  getPerStoreCycle,
} from '@/lib/db'
import { STORES, MAX_REVENUE_PER_SEAT, isClosedStore, getStoreRevenueCap } from '@/lib/stores'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const revalidate = 0

function shortenStoreName(name: string): string {
  return name
    .replace(/^AI\s*TOKYO\s*/i, '')
    .replace(/^AITOKYO\s*\+?\s*/i, '')
    .replace(/^ams by AI\s*TOKYO\s*/i, 'ams ')
    .replace("men's ", '')
    .replace(' men', '')
    .trim()
}

export async function GET() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const today = now.getDate()
  const daysInMonth = new Date(year, month, 0).getDate()
  const remaining = daysInMonth - today
  const prevMonth = month === 1 ? 12 : month - 1
  const prevMonthYear = month === 1 ? year - 1 : year

  const currentMonthData = getMonthlyTotalSales(year, month, year, month)
  const prevMonthData = getMonthlyTotalSales(prevMonthYear, prevMonth, prevMonthYear, prevMonth)
  const prevYearSameMonth = getMonthlyTotalSales(year - 1, month, year - 1, month)

  const currentSales = currentMonthData[0]?.sales ?? 0
  const currentCustomers = currentMonthData[0]?.customers ?? 0
  const prevSales = prevMonthData[0]?.sales ?? 0
  const prevCustomers = prevMonthData[0]?.customers ?? 0
  const prevYearSales = prevYearSameMonth[0]?.sales ?? 0

  const unitPrice = currentCustomers > 0 ? Math.round(currentSales / currentCustomers) : 0
  const prevUnitPrice = prevCustomers > 0 ? Math.round(prevSales / prevCustomers) : 0

  const monthlyTargets = getMonthlyTargets(year)
  const monthTarget = monthlyTargets[month] ?? null
  const annualTarget = getAnnualTarget(year)
  const achievementRate = monthTarget && monthTarget > 0 ? Math.round((currentSales / monthTarget) * 100) : null

  const ytdData = getMonthlyTotalSales(year, 1, year, month)
  const ytdSales = ytdData.reduce((s, m) => s + m.sales, 0)
  const ytdCustomers = ytdData.reduce((s, m) => s + m.customers, 0)

  // ── 着地予測 ──────────────────────────────────────────────────
  const dailyAvg = today > 0 ? Math.round(currentSales / today) : 0
  const paceEstimate = Math.round(dailyAvg * daysInMonth)

  // YoY成長率
  let yoyRate: number | null = null
  if (month > 1) {
    const curYearMonths = getMonthlyTotalSales(year, 1, year, month - 1)
    const prevYearMonths = getMonthlyTotalSales(year - 1, 1, year - 1, 12)
    const rates: number[] = []
    for (const cm of curYearMonths) {
      const [, mStr] = cm.month.split('-')
      const mo = parseInt(mStr)
      const pm = prevYearMonths.find(p => p.month.endsWith(`-${String(mo).padStart(2, '0')}`))
      if (pm && pm.sales > 0) rates.push((cm.sales - pm.sales) / pm.sales)
    }
    if (rates.length > 0) yoyRate = rates.reduce((a, b) => a + b, 0) / rates.length
  }

  const yoyEstimate = prevYearSales > 0 && yoyRate !== null
    ? Math.round(prevYearSales * (1 + yoyRate))
    : null

  // ブレンド: 当月データがあればペース100%、無い時のみYoY100%にフォールバック
  const paceWeight = currentSales > 0 ? 1.0 : 0.0

  const totalSeats = STORES.filter(s => !isClosedStore(s.name)).reduce((s, st) => s + st.seats, 0)
  const totalCeiling = totalSeats * MAX_REVENUE_PER_SEAT

  let standardForecast: number
  if (yoyEstimate !== null && yoyEstimate > 0) {
    standardForecast = Math.min(Math.round(paceEstimate * paceWeight + yoyEstimate * (1 - paceWeight)), totalCeiling)
  } else {
    standardForecast = Math.min(paceEstimate, totalCeiling)
  }
  const conservativeForecast = Math.round(standardForecast * 0.95)
  let optimisticForecast: number
  if (yoyEstimate !== null && yoyEstimate > 0) {
    optimisticForecast = Math.min(Math.round(Math.max(paceEstimate, yoyEstimate) * 1.03), totalCeiling)
  } else {
    optimisticForecast = Math.min(Math.round(standardForecast * 1.05), totalCeiling)
  }

  // ── 店舗別（着地予測付き） ─────────────────────────────────────
  const storeCurrentMonth = getMonthlyStoreSales(year, month, year, month)
  const storePrevYear = getMonthlyStoreSales(year - 1, month, year - 1, month)

  const storeData = storeCurrentMonth
    .filter(s => !isClosedStore(s.store))
    .sort((a, b) => b.sales - a.sales)
    .map(s => {
      const cap = getStoreRevenueCap(s.store)
      const storeDaily = today > 0 ? Math.round(s.sales / today) : 0
      let storeForecast = Math.round(storeDaily * daysInMonth)
      if (cap) storeForecast = Math.min(storeForecast, Math.round(cap * 0.85))
      const prevY = storePrevYear.find(p => p.store === s.store)
      const storeYoY = prevY && prevY.sales > 0 ? ((s.sales - prevY.sales) / prevY.sales * 100) : null
      return {
        store: shortenStoreName(s.store),
        sales: s.sales,
        customers: s.customers,
        unitPrice: s.customers > 0 ? Math.round(s.sales / s.customers) : 0,
        forecast: storeForecast,
        yoyGrowth: storeYoY,
      }
    })

  // ── スタッフTOP10 ─────────────────────────────────────────────
  const staffRaw = getMonthlyStaffSales(year, month, year, month)
  const staffMap = new Map<string, number>()
  for (const s of staffRaw) {
    const name = normalizeStaffName(s.staff)
    if (!name || name === 'フリー' || name === '不明') continue
    staffMap.set(name, (staffMap.get(name) ?? 0) + s.sales)
  }
  const topStaff = Array.from(staffMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, sales]) => ({ name, sales }))

  const momGrowth = prevSales > 0 ? (currentSales - prevSales) / prevSales * 100 : null
  const yoyGrowth = prevYearSales > 0 ? (currentSales - prevYearSales) / prevYearSales * 100 : null

  const seatUtilization = totalSeats > 0 && currentSales > 0
    ? Math.round((currentSales / (totalSeats * MAX_REVENUE_PER_SEAT)) * 100)
    : null

  // 月別推移
  const monthlyTrend = ytdData.map(m => {
    const [, mStr] = m.month.split('-')
    const mo = parseInt(mStr)
    const target = monthlyTargets[mo] ?? null
    const rate = target && target > 0 ? Math.round(m.sales / target * 100) : null
    return {
      month: mo,
      sales: m.sales,
      customers: m.customers,
      unitPrice: m.customers > 0 ? Math.round(m.sales / m.customers) : 0,
      target,
      rate,
    }
  })

  // ── 分析コラム（経営者目線の自動生成コメント） ─────────────────
  const analysisColumns: { title: string; body: string; priority: 'high' | 'medium' | 'low' }[] = []

  // 1. 目標進捗
  if (monthTarget && monthTarget > 0) {
    const forecastRate = (standardForecast / monthTarget) * 100
    if (forecastRate < 90) {
      const dailyNeeded = remaining > 0 ? Math.round((monthTarget - currentSales) / remaining) : 0
      analysisColumns.push({
        title: `目標未達リスク: 着地${Math.round(forecastRate)}%（残${remaining}日）`,
        body: `現ペース日平均${Math.round(dailyAvg / 10000)}万に対し達成には${Math.round(dailyNeeded / 10000)}万/日が必要。週末予約枠の最大化、ホットペッパークーポン配信、オプション提案の徹底を全店に指示。`,
        priority: 'high',
      })
    } else if (forecastRate < 100) {
      analysisColumns.push({
        title: `目標射程圏内: 着地${Math.round(forecastRate)}%`,
        body: `残${remaining}日で日平均${Math.round(((monthTarget - currentSales) / Math.max(remaining, 1)) / 10000)}万を確保すれば達成。LINEクーポンで空き枠を埋め、オプション追加提案で客単価UPを。`,
        priority: 'medium',
      })
    } else {
      analysisColumns.push({
        title: `目標達成ペース: 着地${Math.round(forecastRate)}%`,
        body: `超過達成を狙い、トリートメント・ヘッドスパの追加提案で客単価UPに注力。好調要因を分析し他店舗に横展開。`,
        priority: 'low',
      })
    }
  }

  // 2. 前年同月比
  if (yoyGrowth !== null) {
    if (yoyGrowth < -5) {
      analysisColumns.push({
        title: `前年同月比${yoyGrowth.toFixed(1)}%ダウン`,
        body: unitPrice < 8000
          ? `客単価${unitPrice.toLocaleString()}円が課題。カラー+トリートメントのセット率向上、オプション提案研修の実施を推奨。`
          : `客数減少が主因。HPBクーポン設計の見直し、紹介カード配布目標の設定、SNS集客強化を検討。`,
        priority: 'high',
      })
    } else if (yoyGrowth > 10) {
      analysisColumns.push({
        title: `前年同月比+${yoyGrowth.toFixed(1)}%の好調`,
        body: `成長要因を分析し、好調店舗の施策を全店に横展開。成長の持続性を確認するため、新規/リピート比率の推移をモニタリング。`,
        priority: 'low',
      })
    }
  }

  // 3. 客単価分析
  const prevYearUnitPrice = prevYearSameMonth[0] && prevYearSameMonth[0].customers > 0
    ? Math.round(prevYearSameMonth[0].sales / prevYearSameMonth[0].customers)
    : null
  if (prevYearUnitPrice && unitPrice > 0) {
    const upChange = ((unitPrice - prevYearUnitPrice) / prevYearUnitPrice * 100)
    if (upChange < -3) {
      analysisColumns.push({
        title: `客単価が前年比${upChange.toFixed(1)}%低下（${unitPrice.toLocaleString()}円）`,
        body: `メニュー単価の見直しか、高単価メニュー比率の低下が原因の可能性。店舗別の客単価を比較し、低い店舗でのカウンセリング改善を優先。`,
        priority: 'high',
      })
    }
  }

  // 4. 店舗間格差
  if (storeData.length >= 3) {
    const avgStoreSales = storeData.reduce((s, st) => s + st.sales, 0) / storeData.length
    const weakStores = storeData.filter(s => s.sales < avgStoreSales * 0.7)
    if (weakStores.length > 0) {
      analysisColumns.push({
        title: `${weakStores.length}店舗が全店平均の70%未満`,
        body: `${weakStores.map(s => s.store).join('、')}が低迷。集客施策（HPBクーポン・SNS投稿）の実行状況と予約充足率を店長ヒアリング。エリア特性に合わせた施策調整が必要。`,
        priority: 'high',
      })
    }
  }

  // 5. 季節要因
  const seasonalMonths: Record<number, string> = {
    1: '年始は客足が鈍る傾向。成人式・新年会需要を取りこぼさないよう早期予約促進を。',
    2: '閑散期。バレンタイン・卒業シーズン前のカラー需要を先取り。SNSでのスタイル提案を強化。',
    3: '卒業・送別シーズンで需要増。新生活前の駆け込み需要を逃さないよう、予約枠を最大化。',
    4: '新年度スタート。新規顧客獲得のチャンス。初回クーポンの設計を最適化し、2回目来店へ繋げる導線を。',
    5: 'GW明けの閑散期に注意。リピーターへのDM送付、次回予約の提案を徹底。',
    6: '梅雨時期。縮毛矯正・トリートメント需要を積極提案。湿気対策メニューの訴求を強化。',
    7: '夏本番。カラー・パーマ需要が高い。夏限定メニューやSNS映えスタイルの発信で集客。',
    8: 'お盆期間の来店減に注意。お盆前の駆け込み予約を最大化。夏の傷み修復メニューを訴求。',
    9: '秋カラーの提案時期。ヘアケア意識の高い顧客にトリートメントセットを推奨。',
    10: '年末に向けた仕込み月。12月の予約を前倒しで確保。ハロウィンイベント活用も有効。',
    11: '12月繁忙期の準備。スタッフシフト調整、資材の在庫確認。年末ギフトセットの準備を。',
    12: '年間最大の繁忙期。予約枠の最大化・客単価UPが最重要。年始予約の同時確保で1月の落ち込みを緩和。',
  }
  if (seasonalMonths[month]) {
    analysisColumns.push({
      title: `${month}月の季節要因`,
      body: seasonalMonths[month],
      priority: 'medium',
    })
  }

  // 6. 席稼働率
  if (seatUtilization !== null && seatUtilization < 50) {
    analysisColumns.push({
      title: `席稼働率${seatUtilization}% — 伸びしろあり`,
      body: `${totalSeats}席に対し稼働率が低い。空き枠のリアルタイム共有、当日予約クーポンの配信、アシスタントの積極活用で回転数向上を。`,
      priority: 'medium',
    })
  }

  return NextResponse.json({
    year,
    month,
    today,
    daysInMonth,
    remaining,
    dateLabel: `${month}/${today}時点`,
    currentSales,
    currentCustomers,
    unitPrice,
    prevUnitPrice,
    monthTarget,
    achievementRate,
    momGrowth,
    yoyGrowth,
    ytdSales,
    ytdCustomers,
    annualTarget,
    seatUtilization,
    totalSeats,
    // 着地予測
    forecast: {
      standard: standardForecast,
      conservative: conservativeForecast,
      optimistic: optimisticForecast,
      dailyAvg,
      paceEstimate,
      yoyEstimate,
      paceWeight,
    },
    stores: storeData,
    topStaff,
    monthlyTrend,
    analysisColumns,
  })
}
