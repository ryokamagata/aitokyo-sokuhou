'use client'

import { useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────

type RepeatMonthly = {
  month: string
  nominated: number
  free: number
  newCustomers: number
  revisit: number
  total: number
  nominationRate: number
  freeRate: number
  newRate: number
}

type StoreReturnRanking = {
  store: string
  rate: number
  month: string
}

type ReturnRateTrend = {
  month: string
  avgRate: number
}

type CustomerRepeat = {
  monthly: RepeatMonthly[]
  storeReturnRanking: StoreReturnRanking[]
  returnRateTrend: ReturnRateTrend[]
}

type StaffProductivityCurrent = {
  staff: string
  store: string
  sales: number
}

type StaffGrowth = {
  staff: string
  store: string
  recentTotal: number
  prevTotal: number
  growthRate: number
}

type StaffMonthlyEntry = {
  months: Record<string, number>
  store: string
}

type StaffProductivity = {
  currentMonth: StaffProductivityCurrent[]
  growth: StaffGrowth[]
  monthlyTrends: Record<string, StaffMonthlyEntry>
}

type StoreBenchmarkRow = {
  store: string
  seats: number
  sales: number
  customers: number
  unitPrice: number
  revenuePerSeat: number
  utilization: number
  potential: number
  gap: number
  achievementRate: number
}

type SeasonalIndex = {
  month: number
  label: string
  index: number
  avgSales: number
}

type YoyGrowth = {
  month: string
  current: number
  prevYear: number
  growthRate: number
}

type HolidayImpact = {
  date: string
  name: string
  sales: number
  dow: number
  avgSameDow: number
  impact: number
}

type Seasonal = {
  seasonalIndex: SeasonalIndex[]
  yoyGrowth: YoyGrowth[]
  holidayImpact: HolidayImpact[]
}

type AbcStaff = {
  staff: string
  store: string
  sales: number
  cumPct: number
  grade: string
}

type AbcStore = {
  store: string
  sales: number
  cumPct: number
  grade: string
}

type Abc = {
  staff: AbcStaff[]
  stores: AbcStore[]
  staffAShare: number
  staffACount: number
  staffTotal: number
}

type ForecastDay = {
  day: number
  forecast: number
  accuracy: number
}

type ForecastMonth = {
  month: string
  actual: number
  forecasts: ForecastDay[]
}

type DowAccuracy = {
  dow: number
  label: string
  avgError: number
}

type ForecastAccuracy = {
  months: ForecastMonth[]
  dowAccuracy: DowAccuracy[]
}

type AnalyticsData = {
  customerRepeat: CustomerRepeat
  staffProductivity: StaffProductivity
  storeBenchmark: StoreBenchmarkRow[]
  seasonal: Seasonal
  abc: Abc
  forecastAccuracy: ForecastAccuracy
}

// ── Helpers ────────────────────────────────────────────────

function formatMan(n: number): string {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億`
  return `${Math.round(n / 10_000).toLocaleString()}万`
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

// ── Tab types ──────────────────────────────────────────────

type Tab = 'repeat' | 'staff' | 'benchmark' | 'seasonal' | 'abc' | 'forecast'

const TABS: { key: Tab; label: string }[] = [
  { key: 'repeat', label: '顧客リピート' },
  { key: 'staff', label: 'スタッフ生産性' },
  { key: 'benchmark', label: '店舗ベンチマーク' },
  { key: 'seasonal', label: '季節性分析' },
  { key: 'abc', label: 'ABC分析' },
  { key: 'forecast', label: '予測精度' },
]

// ── Placeholder panels ────────────────────────────────────

function RepeatPanel({ data }: { data: AnalyticsData }) {
  const monthly = data.customerRepeat.monthly
  const latest = monthly[monthly.length - 1]
  const storeRanking = data.customerRepeat.storeReturnRanking
  const latestReturn = data.customerRepeat.returnRateTrend
  const latestReturnRate = latestReturn.length > 0 ? latestReturn[latestReturn.length - 1].avgRate : null

  const stripMonth = (m: string) => {
    const parts = m.split('-')
    if (parts.length === 2) return `${parseInt(parts[1])}月`
    return m
  }

  const maxRate = Math.max(...storeRanking.map(s => s.rate), 1)

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-gray-400 text-xs mb-1">指名率</div>
          <div className="text-cyan-400 text-xl font-bold">{latest?.nominationRate?.toFixed(1) ?? '-'}%</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-gray-400 text-xs mb-1">フリー率</div>
          <div className="text-green-400 text-xl font-bold">{latest?.freeRate?.toFixed(1) ?? '-'}%</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 text-center">
          <div className="text-gray-400 text-xs mb-1">新規3ヶ月リピート率</div>
          <div className="text-red-400 text-xl font-bold">{latestReturnRate?.toFixed(1) ?? '-'}%</div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">指名率 = 指名客数 ÷ 総来店数。フリー率 = フリー客数 ÷ 総来店数。3ヶ月リピート率 = 新規来店後3ヶ月以内に再来店した割合（BM自動集計）。</p>
      </div>

      {/* Monthly trend table */}
      <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-gray-300 text-sm font-semibold mb-2">月別推移</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="py-1 px-2 text-left">月</th>
              <th className="py-1 px-2 text-right">指名</th>
              <th className="py-1 px-2 text-right">フリー</th>
              <th className="py-1 px-2 text-right">新規</th>
              <th className="py-1 px-2 text-right">指名率</th>
              <th className="py-1 px-2 text-right">フリー率</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((row) => (
              <tr key={row.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="py-1 px-2">{stripMonth(row.month)}</td>
                <td className="py-1 px-2 text-right">{row.nominated.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{row.free.toLocaleString()}</td>
                <td className="py-1 px-2 text-right">{row.newCustomers.toLocaleString()}</td>
                <td className="py-1 px-2 text-right text-cyan-400">{row.nominationRate.toFixed(1)}%</td>
                <td className="py-1 px-2 text-right text-green-400">{row.freeRate.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Store return ranking */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-gray-300 text-sm font-semibold mb-3">店舗別 3ヶ月リピート率ランキング</h3>
        <div className="space-y-2">
          {storeRanking.slice(0, 20).map((s, i) => (
            <div key={s.store} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
              <span className="text-gray-300 w-24 truncate shrink-0">{shortenStoreName(s.store)}</span>
              <div className="flex-1 bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-cyan-600 rounded-full flex items-center justify-end pr-1"
                  style={{ width: `${Math.max((s.rate / maxRate) * 100, 2)}%` }}
                >
                  {s.rate >= maxRate * 0.15 && (
                    <span className="text-[10px] text-white font-medium">{s.rate.toFixed(1)}%</span>
                  )}
                </div>
              </div>
              {s.rate < maxRate * 0.15 && (
                <span className="text-gray-400 text-[10px] shrink-0">{s.rate.toFixed(1)}%</span>
              )}
            </div>
          ))}
          {storeRanking.length > 20 && (
            <div className="text-gray-500 text-[10px] text-center pt-1">他 {storeRanking.length - 20} 店舗</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StaffPanel({ data }: { data: AnalyticsData }) {
  const growth = [...data.staffProductivity.growth].filter(g => g.growthRate !== null && g.growthRate !== undefined).sort((a, b) => (b.growthRate ?? 0) - (a.growthRate ?? 0))
  const currentMonth = [...data.staffProductivity.currentMonth].sort((a, b) => b.sales - a.sales)
  const top20 = currentMonth.slice(0, 20)
  const maxSales = Math.max(...top20.map(s => s.sales), 1)

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">直近3ヶ月の売上合計と前3ヶ月を比較し、成長率を算出。当月売上はスクレイピングデータから集計。</p>
      </div>
      {/* Growth ranking */}
      <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-gray-300 text-sm font-semibold mb-2">成長率ランキング</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="py-1 px-2 text-left">スタッフ</th>
              <th className="py-1 px-2 text-left">店舗</th>
              <th className="py-1 px-2 text-right">直近3ヶ月</th>
              <th className="py-1 px-2 text-right">前3ヶ月</th>
              <th className="py-1 px-2 text-right">成長率</th>
            </tr>
          </thead>
          <tbody>
            {growth.slice(0, 20).map((row) => (
              <tr key={`${row.staff}-${row.store}`} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="py-1 px-2">{row.staff}</td>
                <td className="py-1 px-2 text-gray-400">{shortenStoreName(row.store)}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.recentTotal)}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.prevTotal)}</td>
                <td className={`py-1 px-2 text-right font-medium ${row.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {row.growthRate >= 0 ? '+' : ''}{row.growthRate.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {growth.length > 20 && (
          <div className="text-gray-500 text-[10px] text-center pt-2">上位20名を表示（全{growth.length}名）</div>
        )}
      </div>

      {/* Current month bar chart */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-gray-300 text-sm font-semibold mb-3">当月売上ランキング TOP20</h3>
        <div className="space-y-1.5">
          {top20.map((s, i) => (
            <div key={`${s.staff}-${s.store}`} className="flex items-center gap-2 text-xs">
              <span className="text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
              <span className="text-gray-300 w-20 truncate shrink-0" title={s.staff}>{s.staff}</span>
              <div className="flex-1 bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-green-600 rounded-full"
                  style={{ width: `${(s.sales / maxSales) * 100}%` }}
                />
              </div>
              <span className="text-gray-300 text-[10px] w-14 text-right shrink-0">{formatMan(s.sales)}</span>
            </div>
          ))}
          {currentMonth.length > 20 && (
            <div className="text-gray-500 text-[10px] text-center pt-1">他 {currentMonth.length - 20} 名</div>
          )}
        </div>
      </div>
    </div>
  )
}

function BenchmarkPanel({ data }: { data: AnalyticsData }) {
  const rows = data.storeBenchmark
  const maxRPS = Math.max(...rows.map(r => r.revenuePerSeat))
  const sorted = [...rows].sort((a, b) => b.revenuePerSeat - a.revenuePerSeat)

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">席効率 = 店舗売上 ÷ 席数。ポテンシャル = 席数 × 120万円/席。達成率 = 売上 ÷ ポテンシャル × 100。Gap = ポテンシャル − 売上。稼働率はBM予約データから算出。</p>
      </div>
      {/* ── ベンチマーク表 ── */}
      <div className="bg-gray-800 rounded-xl p-3 overflow-x-auto">
        <h3 className="text-sm font-bold text-white mb-2">店舗ベンチマーク</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left py-1 pr-2">店舗</th>
              <th className="text-right py-1 px-1">席数</th>
              <th className="text-right py-1 px-1">売上</th>
              <th className="text-right py-1 px-1">客数</th>
              <th className="text-right py-1 px-1">客単価</th>
              <th className="text-right py-1 px-1">席効率</th>
              <th className="text-right py-1 px-1">稼働率%</th>
              <th className="py-1 px-1 text-right">達成率%</th>
              <th className="text-right py-1 px-1">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const barColor =
                r.achievementRate >= 70
                  ? 'bg-green-500'
                  : r.achievementRate >= 50
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              return (
                <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-1 pr-2 font-medium text-white whitespace-nowrap">
                    {shortenStoreName(r.store)}
                  </td>
                  <td className="text-right py-1 px-1">{r.seats}</td>
                  <td className="text-right py-1 px-1">{formatMan(r.sales)}</td>
                  <td className="text-right py-1 px-1">{r.customers.toLocaleString()}</td>
                  <td className="text-right py-1 px-1">{`¥${r.unitPrice.toLocaleString()}`}</td>
                  <td className="text-right py-1 px-1">{formatMan(r.revenuePerSeat)}</td>
                  <td className="text-right py-1 px-1">{r.utilization.toFixed(1)}%</td>
                  <td className="py-1 px-1">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="w-8 text-right">{r.achievementRate.toFixed(0)}%</span>
                      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${Math.min(r.achievementRate, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="text-right py-1 px-1">{formatMan(r.gap)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── 席効率ランキング ── */}
      <div className="bg-gray-800 rounded-xl p-3">
        <h3 className="text-sm font-bold text-white mb-2">席効率ランキング</h3>
        <div className="space-y-1.5">
          {sorted.map((r, i) => {
            const pct = maxRPS > 0 ? (r.revenuePerSeat / maxRPS) * 100 : 0
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-20 text-gray-300 truncate text-right">
                  {shortenStoreName(r.store)}
                </span>
                <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-20 text-gray-300 text-right">{formatMan(r.revenuePerSeat)} <span className="text-gray-500">({r.achievementRate.toFixed(0)}%)</span></span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SeasonalPanel({ data }: { data: AnalyticsData }) {
  const { seasonalIndex, yoyGrowth, holidayImpact } = data.seasonal

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">季節指数 = 各月の平均売上 ÷ 全月平均売上 × 100。100%が平均水準。前年比成長率は前年同月との比較。祝日インパクトは祝日の売上と同曜日の通常日売上との差分。</p>
      </div>
      {/* ── 季節指数 ── */}
      <div className="bg-gray-800 rounded-xl p-3">
        <h3 className="text-sm font-bold text-white mb-2">季節指数</h3>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {seasonalIndex.map((m) => {
            const bg =
              m.index >= 1.1
                ? 'bg-green-900/60 border-green-600'
                : m.index < 0.9
                ? 'bg-red-900/50 border-orange-600'
                : 'bg-gray-700 border-gray-600'
            const textColor =
              m.index >= 1.1
                ? 'text-green-300'
                : m.index < 0.9
                ? 'text-orange-300'
                : 'text-gray-300'
            return (
              <div
                key={m.month}
                className={`rounded-lg border p-2 text-center ${bg}`}
              >
                <div className="text-xs text-gray-400">{m.label}</div>
                <div className={`text-lg font-bold ${textColor}`}>
                  {(m.index * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-gray-400">{formatMan(m.avgSales)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 前年比成長率 ── */}
      <div className="bg-gray-800 rounded-xl p-3 overflow-x-auto">
        <h3 className="text-sm font-bold text-white mb-2">前年比成長率</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left py-1 px-2">月</th>
              <th className="text-right py-1 px-2">今年</th>
              <th className="text-right py-1 px-2">前年</th>
              <th className="text-right py-1 px-2">成長率%</th>
            </tr>
          </thead>
          <tbody>
            {yoyGrowth.map((row) => (
              <tr key={row.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="py-1 px-2">{row.month}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.current)}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.prevYear)}</td>
                <td className={`py-1 px-2 text-right font-medium ${row.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {row.growthRate >= 0 ? '+' : ''}{row.growthRate.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 祝日インパクト ── */}
      <div className="bg-gray-800 rounded-xl p-3 overflow-x-auto">
        <h3 className="text-sm font-bold text-white mb-2">祝日インパクト</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left py-1 px-2">日付</th>
              <th className="text-left py-1 px-2">祝日名</th>
              <th className="text-right py-1 px-2">売上</th>
              <th className="text-right py-1 px-2">同曜日平均</th>
              <th className="text-right py-1 px-2">インパクト%</th>
            </tr>
          </thead>
          <tbody>
            {holidayImpact.map((row) => (
              <tr key={row.date} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="py-1 px-2 whitespace-nowrap">{row.date}</td>
                <td className="py-1 px-2">{row.name}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.sales)}</td>
                <td className="py-1 px-2 text-right">{formatMan(row.avgSameDow)}</td>
                <td className={`py-1 px-2 text-right font-medium ${row.impact >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {row.impact >= 0 ? '+' : ''}{row.impact.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-gray-500 mt-2">※ 過去6ヶ月の祝日データから集計。今後の祝日は曜日別パターンの予測値を参照。</p>
      </div>
    </div>
  )
}

function AbcPanel({ data }: { data: AnalyticsData }) {
  const abc = data.abc
  const staffList = abc.staff ?? []
  const storeList = abc.stores ?? []
  const maxStaffSales = staffList.length > 0 ? Math.max(...staffList.map(s => s.sales)) : 1
  const maxStoreSales = storeList.length > 0 ? Math.max(...storeList.map(s => s.sales)) : 1

  const gradeBadge = (grade: string) => {
    const cls =
      grade === 'A'
        ? 'bg-green-700 text-green-100'
        : grade === 'B'
        ? 'bg-yellow-700 text-yellow-100'
        : 'bg-gray-600 text-gray-200'
    return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${cls}`}>{grade}</span>
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">ABC分析（パレート分析）: 売上上位から累積し、80%までをA評価、95%までをB評価、残りをC評価に分類。少数の重要スタッフ・店舗を特定する分析手法。</p>
      </div>
      {/* Summary card */}
      <div className="bg-gray-800 rounded-xl p-4">
        <p className="text-sm text-gray-200">
          上位<span className="text-blue-400 font-bold">{abc.staffACount}</span>人
          （<span className="text-blue-400 font-bold">{abc.staffAShare}</span>%）がA評価
          — 全体売上の80%を担当
        </p>
      </div>

      {/* Staff ABC table */}
      <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-bold text-gray-200 mb-2">スタッフ ABC分析（今月）</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="py-1 text-left">ランク</th>
              <th className="py-1 text-left">スタッフ</th>
              <th className="py-1 text-left">店舗</th>
              <th className="py-1 text-right">売上</th>
              <th className="py-1 text-right">累積%</th>
              <th className="py-1 text-center">評価</th>
            </tr>
          </thead>
          <tbody>
            {staffList.map((s, i) => (
              <tr key={i} className="border-b border-gray-700/50">
                <td className="py-1">{i + 1}</td>
                <td className="py-1">{s.staff}</td>
                <td className="py-1">{shortenStoreName(s.store)}</td>
                <td className="py-1 text-right">{formatMan(s.sales)}</td>
                <td className="py-1 text-right">{s.cumPct.toFixed(1)}%</td>
                <td className="py-1 text-center">{gradeBadge(s.grade)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pareto bar visualization */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-200 mb-2">パレート図（スタッフ）</h3>
        <div className="space-y-1">
          {staffList.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-300">
              <span className="w-20 truncate flex-shrink-0">{s.staff}</span>
              <div className="flex-1 relative h-4">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${
                    s.grade === 'A' ? 'bg-green-600' : s.grade === 'B' ? 'bg-yellow-600' : 'bg-gray-600'
                  }`}
                  style={{ width: `${(s.sales / maxStaffSales) * 100}%` }}
                />
                <div
                  className="absolute top-0 w-2 h-4 flex items-center justify-center"
                  style={{ left: `${Math.min(s.cumPct, 100)}%` }}
                >
                  <div className="w-2 h-2 rounded-full bg-blue-400 border border-blue-300" />
                </div>
              </div>
              <span className="w-12 text-right flex-shrink-0 text-gray-400">{s.cumPct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1 pl-[88px]">
          <span>0%</span>
          <span>累積 →</span>
          <span>100%</span>
        </div>
      </div>

      {/* Store ABC table */}
      <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
        <h3 className="text-sm font-bold text-gray-200 mb-2">店舗 ABC分析（今月）</h3>
        <table className="w-full text-xs text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="py-1 text-left">ランク</th>
              <th className="py-1 text-left">店舗</th>
              <th className="py-1 text-right">売上</th>
              <th className="py-1 text-right">累積%</th>
              <th className="py-1 text-center">評価</th>
            </tr>
          </thead>
          <tbody>
            {storeList.map((s, i) => (
              <tr key={i} className="border-b border-gray-700/50">
                <td className="py-1">{i + 1}</td>
                <td className="py-1">{shortenStoreName(s.store)}</td>
                <td className="py-1 text-right">{formatMan(s.sales)}</td>
                <td className="py-1 text-right">{s.cumPct.toFixed(1)}%</td>
                <td className="py-1 text-center">{gradeBadge(s.grade)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Store Pareto bars */}
        <div className="mt-3 space-y-1">
          {storeList.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-300">
              <span className="w-20 truncate flex-shrink-0">{shortenStoreName(s.store)}</span>
              <div className="flex-1 relative h-4">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${
                    s.grade === 'A' ? 'bg-green-600' : s.grade === 'B' ? 'bg-yellow-600' : 'bg-gray-600'
                  }`}
                  style={{ width: `${(s.sales / maxStoreSales) * 100}%` }}
                />
                <div
                  className="absolute top-0 w-2 h-4 flex items-center justify-center"
                  style={{ left: `${Math.min(s.cumPct, 100)}%` }}
                >
                  <div className="w-2 h-2 rounded-full bg-blue-400 border border-blue-300" />
                </div>
              </div>
              <span className="w-12 text-right flex-shrink-0 text-gray-400">{s.cumPct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ForecastPanel({ data }: { data: AnalyticsData }) {
  const fa = data.forecastAccuracy
  const months = fa?.months ?? []
  const dowAccuracy = fa?.dowAccuracy ?? []

  if (months.length === 0 && dowAccuracy.length === 0) {
    return <div className="text-gray-400 text-sm text-center py-8">データが不足しています</div>
  }

  const accColor = (acc: number) =>
    acc >= 95 ? 'text-green-400' : acc >= 90 ? 'text-yellow-400' : 'text-red-400'

  const maxDowError = dowAccuracy.length > 0 ? Math.max(...dowAccuracy.map(d => d.avgError)) : 1
  const dowBarColor = (err: number) =>
    err < 15 ? 'bg-green-600' : err <= 25 ? 'bg-yellow-600' : 'bg-red-600'
  const dowTextColor = (err: number) =>
    err < 15 ? 'text-green-400' : err <= 25 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-3">
        <p className="text-xs text-gray-400">各月について、Day10・15・20時点でのDOW（曜日別平均）予測と実績を比較。精度が高いほど予測モデルの信頼性が高い。当月は現ペースの着地予測を「実績」扱い。</p>
      </div>
      {/* Monthly forecast accuracy table */}
      {months.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4 overflow-x-auto">
          <h3 className="text-sm font-bold text-gray-200 mb-2">月別予測精度（{months[0].month}〜{months[months.length - 1].month}）</h3>
          <table className="w-full text-xs text-gray-300">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-1 text-left">月</th>
                <th className="py-1 text-right">実績</th>
                {months[0]?.forecasts?.map(f => (
                  <th key={f.day} className="py-1 text-right" colSpan={1}>
                    {f.day}日時点
                  </th>
                ))}
                {months[0]?.forecasts?.map(f => (
                  <th key={`acc-${f.day}`} className="py-1 text-right">
                    精度%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-gray-700/50">
                  <td className="py-1">{m.month}</td>
                  <td className="py-1 text-right">{formatMan(m.actual)}</td>
                  {m.forecasts.map(f => (
                    <td key={f.day} className="py-1 text-right">{formatMan(f.forecast)}</td>
                  ))}
                  {m.forecasts.map(f => (
                    <td key={`acc-${f.day}`} className={`py-1 text-right font-medium ${accColor(f.accuracy)}`}>
                      {f.accuracy.toFixed(1)}%
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}

// ── Main component ─────────────────────────────────────────

export default function AdvancedAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/analytics')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">分析データ読み込み中...</div>
  if (!data) return <div className="text-red-400 text-sm text-center py-8">データ取得に失敗しました</div>

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">顧客リピート</h3>
        <RepeatPanel data={data} />
      </section>
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">スタッフ生産性</h3>
        <StaffPanel data={data} />
      </section>
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">店舗ベンチマーク</h3>
        <BenchmarkPanel data={data} />
      </section>
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">季節性分析</h3>
        <SeasonalPanel data={data} />
      </section>
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">ABC分析</h3>
        <AbcPanel data={data} />
      </section>
      <section>
        <h3 className="text-sm font-bold text-gray-200 mb-3 pb-2 border-b border-gray-700">予測精度</h3>
        <ForecastPanel data={data} />
      </section>
    </div>
  )
}
