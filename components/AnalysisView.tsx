'use client'

import { useEffect, useState } from 'react'
import { StaffPanel, ForecastPanel, type AnalyticsData } from './AdvancedAnalytics'

type DecompositionRow = {
  month: string
  sales: number
  customers: number
  unitPrice: number
  priceEffect: number | null
  volumeEffect: number | null
}

type DowRow = {
  dow: number
  label: string
  days: number
  avgSales: number
  avgCustomers: number
  avgUnitPrice: number
}

type TargetSuggestion = {
  month: number
  suggested: number
  existing: number | null
  rationale: string[]
  newStoreRevenue: number
  newStoreDetail: { name: string; revenue: number }[]
  commentary: string | null
  basis: {
    prevYear: number | null
    yoyRate: number | null
    seasonal: number | null
    ceiling: number
    monthSeats: number
    monthCeiling: number
  }
}

type StorePlanSummary = {
  name: string
  month: number
  revenue: number
  seats: number
}

type UtilRow = { dow: number; label: string; avgRate: number; days: number }

type WeekDay = {
  date: string
  dow: number
  dowLabel: string
  sales: number
  customers: number
  holiday: string | null
  forecast: number
  forecastCustomers: number
  isFuture: boolean
  isToday: boolean
}

type WeekData = {
  label: string
  from: string
  to: string
  days: WeekDay[]
  storeData: Record<string, Record<string, { sales: number; customers: number }>>
}

type WeeklyData = {
  thisWeek: WeekData
  lastWeek: WeekData
  prevMonthWeek: WeekData
  holidayMap: Record<string, string>
  dowAvgByStore?: Record<string, Record<number, number>>
  dowAvgCustomersByStore?: Record<string, Record<number, number>>
}

type AnalysisData = {
  priceVolumeDecomposition: DecompositionRow[]
  storeDecomposition: Record<string, DecompositionRow[]>
  dowSummary: DowRow[]
  dowByStore: Record<string, DowRow[]>
  dowUtilization: UtilRow[]
  dowUtilByStore: Record<string, UtilRow[]>
  weeklyData: WeeklyData
  targetSuggestions: TargetSuggestion[]
  suggestedAnnualTotal: number
  existingAnnualTarget: number | null
  realisticCeiling: number
  totalSeats: number
  storePlansSummary: StorePlanSummary[]
}

type SubTab = 'dow' | 'target' | 'staff' | 'forecast'

function formatMan(n: number): string {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億`
  return `${Math.round(n / 10_000).toLocaleString()}万`
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString()}`
}

function shortenStoreName(name: string): string {
  return name
    .replace(/^AI\s*TOKYO\s*/i, '')
    .replace(/^AITOKYO\s*\+?\s*/i, '')
    .replace(/^ams by AI\s*TOKYO\s*/i, 'ams ')
    .replace("men's ", '')
    .replace(' men', '')
    .trim()
}

export default function AnalysisView() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('dow')
  const [selectedStore, setSelectedStore] = useState<string>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/analysis').then(r => r.json()),
      fetch('/api/analytics').then(r => r.json()),
    ])
      .then(([a, b]) => { setData(a); setAnalyticsData(b); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">分析データ読み込み中...</div>
  if (!data) return <div className="text-red-400 text-sm text-center py-8">データ取得に失敗しました</div>

  return (
    <div className="space-y-4">
      {/* サブタブ */}
      <div className="grid grid-cols-4 gap-1 bg-gray-800 rounded-lg p-1">
        {([
          ['dow', '曜日別パターン'],
          ['target', '目標サジェスト'],
          ['staff', 'スタッフ生産性'],
          ['forecast', '予測精度'],
        ] as [SubTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`text-xs sm:text-sm py-2 px-2 sm:px-4 rounded-md transition-colors font-medium ${
              subTab === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'dow' && (
        <DowPanel data={data} selectedStore={selectedStore} onStoreChange={setSelectedStore} />
      )}
      {subTab === 'target' && (
        <TargetSuggestPanel data={data} />
      )}
      {subTab === 'staff' && (
        analyticsData ? <StaffPanel data={analyticsData} /> : <div className="text-gray-400 text-sm text-center py-8">読み込み中...</div>
      )}
      {subTab === 'forecast' && (
        analyticsData ? <ForecastPanel data={analyticsData} /> : <div className="text-gray-400 text-sm text-center py-8">読み込み中...</div>
      )}
    </div>
  )
}

// ─── 曜日別（週単位）パターン ──────────────────────────────────────────────

function DowPanel({
  data, selectedStore, onStoreChange,
}: {
  data: AnalysisData
  selectedStore: string
  onStoreChange: (s: string) => void
}) {
  const weekly = data.weeklyData
  const stores = Object.keys(data.dowByStore)
  const DOW_COLORS = ['text-red-400', 'text-gray-300', 'text-gray-300', 'text-gray-300', 'text-gray-300', 'text-gray-300', 'text-blue-400']
  const DOW_BG = ['bg-red-500/70', 'bg-gray-500/70', 'bg-gray-500/70', 'bg-gray-500/70', 'bg-gray-500/70', 'bg-gray-500/70', 'bg-blue-500/70']

  // 店舗別のときは日別データを店舗でフィルタ。予測値も店舗別の曜日平均を使う
  const getWeekDays = (week: WeekData): WeekDay[] => {
    if (selectedStore === 'all') return week.days
    const storeMap = week.storeData[selectedStore] ?? {}
    const storeDowAvg = weekly.dowAvgByStore?.[selectedStore] ?? {}
    const storeDowCustAvg = weekly.dowAvgCustomersByStore?.[selectedStore] ?? {}
    return week.days.map(d => ({
      ...d,
      sales: storeMap[d.date]?.sales ?? 0,
      customers: storeMap[d.date]?.customers ?? 0,
      forecast: storeDowAvg[d.dow] ?? 0,
      forecastCustomers: storeDowCustAvg[d.dow] ?? 0,
    }))
  }

  const thisWeekDays = getWeekDays(weekly.thisWeek)
  const lastWeekDays = getWeekDays(weekly.lastWeek)
  const prevMonthDays = getWeekDays(weekly.prevMonthWeek)

  // 実績 + 未来日は予測を加算
  const weekTotal = (days: WeekDay[]) => days.reduce((s, d) => s + d.sales, 0)
  const weekCustomers = (days: WeekDay[]) => days.reduce((s, d) => s + d.customers, 0)
  const weekTotalWithForecast = (days: WeekDay[]) =>
    days.reduce((s, d) => s + ((d.isFuture || (d.isToday && d.sales === 0)) ? d.forecast : d.sales), 0)
  const weekCustomersWithForecast = (days: WeekDay[]) =>
    days.reduce((s, d) => s + ((d.isFuture || (d.isToday && d.sales === 0)) ? d.forecastCustomers : d.customers), 0)

  const thisActualTotal = weekTotal(thisWeekDays)
  const thisForecastTotal = weekTotalWithForecast(thisWeekDays)
  const thisTotal = thisForecastTotal
  const lastTotal = weekTotal(lastWeekDays)
  const prevTotal = weekTotal(prevMonthDays)
  const hasFutureDays = thisWeekDays.some(d => d.isFuture)

  const diffPct = (current: number, prev: number) => {
    if (prev === 0) return null
    return Math.round((current - prev) / prev * 1000) / 10
  }

  const maxSalesInWeeks = Math.max(
    ...thisWeekDays.map(d => (d.isFuture || (d.isToday && d.sales === 0)) ? d.forecast : d.sales),
    ...lastWeekDays.map(d => d.sales),
    ...prevMonthDays.map(d => d.sales),
    1
  )

  return (
    <div className="space-y-3">
      {/* 店舗セレクタ */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onStoreChange('all')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              selectedStore === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            全店舗合計
          </button>
          {stores.map(store => (
            <button
              key={store}
              onClick={() => onStoreChange(store)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                selectedStore === store ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {shortenStoreName(store)}
            </button>
          ))}
        </div>
      </div>

      {/* 週間サマリーカード */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-800 rounded-xl p-3 border border-cyan-500/30">
          <p className="text-[10px] text-gray-500">今週{hasFutureDays ? '（実績+予測）' : ''}</p>
          <p className="text-lg font-bold text-cyan-400">{formatMan(thisForecastTotal)}</p>
          {hasFutureDays && (
            <p className="text-[10px] text-gray-500">
              実績 {formatMan(thisActualTotal)}
              <span className="text-yellow-400 ml-1">+ 予測 {formatMan(thisForecastTotal - thisActualTotal)}</span>
            </p>
          )}
          <p className="text-[10px] text-gray-500">{weekCustomersWithForecast(thisWeekDays).toLocaleString()}人</p>
        </div>
        {[
          { label: '先週', total: lastTotal, customers: weekCustomers(lastWeekDays), color: 'text-gray-300', border: 'border-gray-600' },
          { label: '前月同週', total: prevTotal, customers: weekCustomers(prevMonthDays), color: 'text-gray-400', border: 'border-gray-700' },
        ].map(w => (
          <div key={w.label} className={`bg-gray-800 rounded-xl p-3 border ${w.border}`}>
            <p className="text-[10px] text-gray-500">{w.label}</p>
            <p className={`text-lg font-bold ${w.color}`}>{formatMan(w.total)}</p>
            <p className="text-[10px] text-gray-500">{w.customers.toLocaleString()}人</p>
          </div>
        ))}
      </div>

      {/* 差分サマリー */}
      <div className="bg-gray-800 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-gray-400">先週比:</span>
        {(() => {
          const pct = diffPct(thisTotal, lastTotal)
          if (pct === null) return <span className="text-gray-600">—</span>
          return <span className={`font-bold ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>
        })()}
        <span className="text-gray-600">|</span>
        <span className="text-gray-400">前月同週比:</span>
        {(() => {
          const pct = diffPct(thisTotal, prevTotal)
          if (pct === null) return <span className="text-gray-600">—</span>
          return <span className={`font-bold ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>
        })()}
      </div>

      {/* 日別比較チャート */}
      <div className="bg-gray-800 rounded-xl p-3 sm:p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-1">日別売上比較</h3>
        <p className="text-[10px] text-gray-500 mb-3">今週 vs 先週 vs 前月同週</p>

        {/* バーチャート: 曜日ごとに3本のバー + 未来日は予測バー */}
        <div className="grid grid-cols-7 gap-1 mb-4">
          {thisWeekDays.map((d, i) => {
            const lastD = lastWeekDays[i]
            const prevD = prevMonthDays[i]
            const showForecast = d.isFuture || (d.isToday && d.sales === 0)
            const displaySales = showForecast ? d.forecast : d.sales
            const pctThis = maxSalesInWeeks > 0 ? (displaySales / maxSalesInWeeks) * 100 : 0
            const pctLast = maxSalesInWeeks > 0 ? ((lastD?.sales ?? 0) / maxSalesInWeeks) * 100 : 0
            const pctPrev = maxSalesInWeeks > 0 ? ((prevD?.sales ?? 0) / maxSalesInWeeks) * 100 : 0
            return (
              <div key={d.date} className="flex flex-col items-center">
                <div className="w-full h-20 flex items-end justify-center gap-[2px]">
                  <div className="w-2 bg-gray-600/60 rounded-t" style={{ height: `${pctPrev}%` }} title={`前月同週 ${formatMan(prevD?.sales ?? 0)}`} />
                  <div className="w-2 bg-gray-400/60 rounded-t" style={{ height: `${pctLast}%` }} title={`先週 ${formatMan(lastD?.sales ?? 0)}`} />
                  {showForecast ? (
                    <div className="w-2 rounded-t bg-yellow-500/50 border border-dashed border-yellow-400/60" style={{ height: `${pctThis}%` }} title={`予測 ${formatMan(d.forecast)}`} />
                  ) : (
                    <div className={`w-2 rounded-t ${DOW_BG[d.dow]}`} style={{ height: `${pctThis}%` }} title={`今週 ${formatMan(d.sales)}`} />
                  )}
                </div>
                <span className={`text-xs font-bold mt-1 ${showForecast ? 'text-yellow-400/60' : DOW_COLORS[d.dow]}`}>{d.dowLabel}</span>
                {d.holiday && (
                  <span className="text-[8px] text-red-400 truncate max-w-[48px]">{d.holiday}</span>
                )}
                {showForecast ? (
                  <span className="text-[10px] text-yellow-400/60">{d.forecast > 0 ? formatMan(d.forecast) : '—'}</span>
                ) : (
                  <span className="text-[10px] text-gray-400">{d.sales > 0 ? formatMan(d.sales) : '—'}</span>
                )}
                {d.isToday && <span className="text-[8px] text-cyan-400">今日</span>}
              </div>
            )
          })}
        </div>

        {/* 凡例 */}
        <div className="flex flex-wrap gap-4 text-[10px] text-gray-500 mb-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-gray-600/60 inline-block" /> 前月同週</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-gray-400/60 inline-block" /> 先週</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cyan-500/70 inline-block" /> 今週実績</span>
          {hasFutureDays && (
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-yellow-500/50 border border-dashed border-yellow-400/60 inline-block" /> 曜日別予測</span>
          )}
        </div>

        {/* 詳細テーブル */}
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 px-1">曜日</th>
                <th className="text-right py-2 px-1">今週</th>
                <th className="text-right py-2 px-1">先週</th>
                <th className="text-right py-2 px-1">差分</th>
                <th className="text-right py-2 px-1">前月同週</th>
                <th className="text-right py-2 px-1">客数</th>
              </tr>
            </thead>
            <tbody>
              {thisWeekDays.map((d, i) => {
                const lastD = lastWeekDays[i]
                const prevD = prevMonthDays[i]
                const showForecast = d.isFuture || (d.isToday && d.sales === 0)
                const displaySales = showForecast ? d.forecast : d.sales
                const displayCustomers = showForecast ? d.forecastCustomers : d.customers
                const salesDiff = displaySales - (lastD?.sales ?? 0)
                const salesDiffPct = diffPct(displaySales, lastD?.sales ?? 0)
                return (
                  <tr key={d.date} className={`border-b border-gray-700/50 hover:bg-gray-700/30 ${showForecast ? 'opacity-75' : ''} ${d.isToday ? 'bg-cyan-900/10' : ''}`}>
                    <td className="py-1.5 px-1">
                      <div className="flex items-center gap-1">
                        <span className={`font-bold ${showForecast ? 'text-yellow-400/60' : DOW_COLORS[d.dow]}`}>{d.dowLabel}</span>
                        <span className="text-[10px] text-gray-600">{d.date.slice(5)}</span>
                        {d.isToday && <span className="text-[9px] text-cyan-400 bg-cyan-900/30 px-1 rounded">今日</span>}
                        {showForecast && <span className="text-[9px] text-yellow-400 bg-yellow-900/30 px-1 rounded">予測</span>}
                        {d.holiday && (
                          <span className="text-[9px] text-red-400 bg-red-900/30 px-1 rounded">{d.holiday}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-1 text-right font-bold">
                      {showForecast ? (
                        <span className="text-yellow-400/80">{d.forecast > 0 ? formatMan(d.forecast) : '—'}</span>
                      ) : d.sales > 0 ? (
                        <span className="text-white">{formatMan(d.sales)}</span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right text-gray-400">
                      {(lastD?.sales ?? 0) > 0 ? formatMan(lastD.sales) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right">
                      {displaySales > 0 && (lastD?.sales ?? 0) > 0 ? (
                        <span className={salesDiff >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {salesDiff >= 0 ? '+' : ''}{formatMan(salesDiff)}
                          {salesDiffPct !== null && (
                            <span className="text-[10px] ml-0.5">({salesDiffPct >= 0 ? '+' : ''}{salesDiffPct}%)</span>
                          )}
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right text-gray-500">
                      {(prevD?.sales ?? 0) > 0 ? formatMan(prevD.sales) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right text-gray-400">
                      {displayCustomers > 0 ? `${displayCustomers}人` : <span className="text-gray-600">—</span>}
                    </td>
                  </tr>
                )
              })}
              {/* 合計行 */}
              <tr className="border-t border-gray-600 font-bold">
                <td className="py-2 px-1 text-gray-300">合計{hasFutureDays ? '(実績+予測)' : ''}</td>
                <td className="py-2 px-1 text-right text-cyan-400">{thisForecastTotal > 0 ? formatMan(thisForecastTotal) : '—'}</td>
                <td className="py-2 px-1 text-right text-gray-400">{lastTotal > 0 ? formatMan(lastTotal) : '—'}</td>
                <td className="py-2 px-1 text-right">
                  {thisForecastTotal > 0 && lastTotal > 0 ? (
                    <span className={thisForecastTotal - lastTotal >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {thisForecastTotal - lastTotal >= 0 ? '+' : ''}{formatMan(thisForecastTotal - lastTotal)}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 px-1 text-right text-gray-500">{prevTotal > 0 ? formatMan(prevTotal) : '—'}</td>
                <td className="py-2 px-1 text-right text-gray-400">
                  {weekCustomersWithForecast(thisWeekDays) > 0 ? `${weekCustomersWithForecast(thisWeekDays)}人` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── 目標サジェスト ──────────────────────────────────────────────────

function TargetSuggestPanel({ data }: { data: AnalysisData }) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const applyAll = async () => {
    setApplying(true)
    try {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
      const year = now.getFullYear()
      const targets: Record<number, number> = {}
      for (const s of data.targetSuggestions) {
        targets[s.month] = s.suggested
      }
      await fetch('/api/monthly-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, targets }),
      })
      setApplied(true)
    } finally {
      setApplying(false)
    }
  }

  const hasStorePlans = data.storePlansSummary && data.storePlansSummary.length > 0

  return (
    <div className="space-y-3">
      {/* サマリー */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-300">目標自動サジェスト</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              既存{data.totalSeats}席{hasStorePlans ? ` + 新店${data.storePlansSummary.reduce((s: number, p: StorePlanSummary) => s + p.seats, 0)}席` : ''} / 前年実績+成長率+季節変動+出店計画で算出
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] text-gray-500">提案年間合計</div>
              <div className="text-lg font-bold text-cyan-400">{formatMan(data.suggestedAnnualTotal)}</div>
            </div>
            {data.existingAnnualTarget && (
              <div className="text-right">
                <div className="text-[10px] text-gray-500">現在の目標</div>
                <div className="text-lg font-bold text-gray-300">{formatMan(data.existingAnnualTarget)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 出店計画カード（ある場合） */}
      {hasStorePlans && (
        <div className="bg-gray-800 rounded-xl p-3 sm:p-4 border border-purple-500/20">
          <h4 className="text-xs font-medium text-purple-400 mb-2">出店計画（目標に自動反映中）</h4>
          <div className="flex flex-wrap gap-2">
            {data.storePlansSummary.map((p: StorePlanSummary, i: number) => (
              <div key={i} className="bg-purple-500/10 rounded-lg px-3 py-2 text-xs">
                <div className="font-bold text-purple-300">{p.name}</div>
                <div className="text-[10px] text-gray-400">
                  {p.month}月開業 / {p.seats}席 / 上限{formatMan(p.revenue)}/月
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            出店計画を変更すると提案目標が自動的に再計算されます（成長カーブ: 30%→50%→70%→85%→95%→100%）
          </p>
        </div>
      )}

      {/* 月別サジェスト */}
      <div className="bg-gray-800 rounded-xl p-3 sm:p-4">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 px-1">月</th>
                <th className="text-right py-2 px-1">提案目標</th>
                <th className="text-right py-2 px-1">現在目標</th>
                <th className="text-right py-2 px-1">前年実績</th>
                <th className="text-right py-2 px-1 hidden sm:table-cell">季節</th>
                {hasStorePlans && <th className="text-right py-2 px-1 hidden sm:table-cell">新店</th>}
                <th className="text-left py-2 px-1">分析</th>
              </tr>
            </thead>
            <tbody>
              {data.targetSuggestions.map(s => {
                const diff = s.existing ? s.suggested - s.existing : null
                return (
                  <tr key={s.month} className={`border-b border-gray-700/50 hover:bg-gray-700/30 ${s.newStoreRevenue > 0 ? 'bg-purple-500/5' : ''}`}>
                    <td className="py-1.5 px-1 text-gray-300 font-bold">
                      {s.month}月
                      {s.newStoreDetail.length > 0 && (
                        <span className="text-[8px] text-purple-400 ml-0.5">NEW</span>
                      )}
                    </td>
                    <td className="py-1.5 px-1 text-right text-cyan-400 font-bold">{formatMan(s.suggested)}</td>
                    <td className="py-1.5 px-1 text-right">
                      {s.existing ? (
                        <div>
                          <span className="text-gray-300">{formatMan(s.existing)}</span>
                          {diff !== null && (
                            <span className={`ml-1 text-[10px] ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {diff >= 0 ? '+' : ''}{formatMan(diff)}
                            </span>
                          )}
                        </div>
                      ) : <span className="text-gray-600">未設定</span>}
                    </td>
                    <td className="py-1.5 px-1 text-right text-gray-400">
                      {s.basis.prevYear ? formatMan(s.basis.prevYear) : '—'}
                    </td>
                    <td className="py-1.5 px-1 text-right hidden sm:table-cell">
                      {s.basis.seasonal !== null ? (
                        <span className={s.basis.seasonal >= 1 ? 'text-green-400' : 'text-orange-400'}>
                          {(s.basis.seasonal * 100).toFixed(0)}%
                        </span>
                      ) : '—'}
                    </td>
                    {hasStorePlans && (
                      <td className="py-1.5 px-1 text-right hidden sm:table-cell">
                        {s.newStoreRevenue > 0 ? (
                          <span className="text-purple-400">+{formatMan(s.newStoreRevenue)}</span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                    )}
                    <td className="py-1.5 px-1">
                      {s.commentary ? (
                        <span className="text-[10px] text-gray-400">{s.commentary}</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {s.rationale.slice(0, 2).map((r, i) => (
                            <span key={i} className="text-[10px] text-gray-500">{r}</span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 一括適用ボタン */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={applyAll}
            disabled={applying || applied}
            className={`text-xs px-4 py-2 rounded-lg font-medium transition-colors ${
              applied
                ? 'bg-green-700 text-green-200 cursor-default'
                : applying
                ? 'bg-gray-600 text-gray-400 cursor-wait'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            {applied ? '適用済み' : applying ? '適用中...' : '提案をすべて目標に適用'}
          </button>
        </div>
      </div>

      {/* 計算根拠の説明 */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-2">計算ロジック</h4>
        <div className="text-[10px] text-gray-500 space-y-1">
          <p>1. ベース = 前年同月売上 × (1 + YoY平均成長率{data.targetSuggestions[0]?.basis.yoyRate != null ? ` ${data.targetSuggestions[0].basis.yoyRate}%` : ''})</p>
          <p>2. 季節変動指数で補正（前年の月別売上÷平均から算出）</p>
          {hasStorePlans && <p>3. 出店計画の売上寄与を加算（成長カーブ: 開業→6ヶ月で100%到達）</p>}
          <p>{hasStorePlans ? '4' : '3'}. 月別席数上限チェック（既存+新店の席数 × 120万/席 × 稼働85%）</p>
          <p>{hasStorePlans ? '5' : '4'}. 攻めの目標として+8%上乗せ</p>
        </div>
      </div>
    </div>
  )
}
