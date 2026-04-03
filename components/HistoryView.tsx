'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import AnnualReviewPanel from './AnnualReviewPanel'
import MonthlyTargetPanel from './MonthlyTargetPanel'
import { isClosedStore } from '@/lib/stores'

type TotalMonthly = { month: string; sales: number; customers: number }
type StoreMonthRow = { store: string; sales: number; customers: number }
type StaffSummary = {
  staff: string
  baseSales: number       // 前月（完了・ランキング基準）
  prevSales: number       // 前々月
  prev2Sales: number      // 3ヶ月前
  currentSales: number    // 今月（進行中）
  growthRate: number | null
  monthly: { month: string; sales: number }[]
}

type AnnualMonthDetail = {
  month: number
  sales: number
  customers: number
  isProjected: boolean
}

type AnnualSummary = {
  year: number
  total: number
  customers: number
  monthDetails: AnnualMonthDetail[]
  isComplete: boolean
  actualMonths: number
}

type Projection = {
  currentYear: number
  projectedTotal: number
  projectedCustomers: number
  ytdTotal: number
  ytdCustomers: number
  ytdMonths: number
  avgYoYGrowthRate: number | null
  monthDetails: AnnualMonthDetail[]
  prevYearTotal: number
  yoyProjectedGrowth: number | null
  currentMonthEstimate: number | null
  conservativeTotal: number
  optimisticTotal: number
  annualTarget: number | null
  newStoreTotal?: number
}

type StoreOpeningPlan = {
  id: number
  year: number
  opening_month: number
  store_name: string
  max_monthly_revenue: number
  seats: number
}

type HistoryData = {
  months: string[]
  latestMonth: string
  prevMonth: string
  staffBaseMonth: string
  staffPrevMonth: string
  staffPrev2Month: string
  staffCurrentMonth: string
  totalMonthly: TotalMonthly[]
  storeByMonth: Record<string, StoreMonthRow[]>
  staffSummary: StaffSummary[]
  annualSummaries: AnnualSummary[]
  projection: Projection | null
  storeOpeningPlans?: StoreOpeningPlan[]
  seasonalIndex?: Record<number, number>
  storeProjections?: StoreProjectionData[]
}

type StoreProjectionData = {
  store: string
  ytdTotal: number
  projectedTotal: number
  avgGrowthRate: number | null
  monthDetails: { month: number; sales: number; isProjected: boolean }[]
  isClosed: boolean
  revenueCap: number | null
}

type SubTab = 'total' | 'store' | 'staff'

export default function HistoryView() {
  const [data, setData] = useState<HistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('total')
  const [selectedStore, setSelectedStore] = useState<string>('all')

  const refresh = useCallback(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">読み込み中...</div>
  if (!data) return <div className="text-red-400 text-sm text-center py-8">データ取得に失敗しました</div>

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'total', label: '全店舗合計' },
    { key: 'store', label: '店舗別' },
    { key: 'staff', label: 'スタッフ別' },
  ]

  return (
    <div className="space-y-4">
      {/* サブタブ */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {subTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex-1 text-xs py-2 px-3 rounded-md transition-colors ${
              subTab === t.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'total' && <TotalHistory data={data} onRefresh={refresh} />}
      {subTab === 'store' && (
        <StoreHistory data={data} selectedStore={selectedStore} onStoreChange={setSelectedStore} />
      )}
      {subTab === 'staff' && <StaffHistory data={data} />}
    </div>
  )
}

// ━━━ 年間合計 & 着地予測 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AnnualOverview({ data, onRefresh }: { data: HistoryData; onRefresh: () => void }) {
  const { annualSummaries, projection } = data

  if (!annualSummaries || annualSummaries.length === 0) return null

  const prevYearSummary = annualSummaries.find(s => s.isComplete)

  return (
    <div className="space-y-3">
      {/* 前年実績カード */}
      {prevYearSummary && (
        <div className="bg-gray-700/50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">{prevYearSummary.year}年 年間実績</p>
          <p className="text-xl font-bold text-white">
            {formatOkuMan(prevYearSummary.total)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            客数: {prevYearSummary.customers.toLocaleString()}人
            {prevYearSummary.customers > 0 && (
              <> / 客単価: ¥{Math.round(prevYearSummary.total / prevYearSummary.customers).toLocaleString()}</>
            )}
          </p>
        </div>
      )}

      {/* 今年着地予測 3パターン */}
      {projection && (
        <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-700/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-medium text-blue-300">{projection.currentYear}年 着地予測</p>
            <span className="text-[10px] bg-blue-800/50 text-blue-300 px-1.5 py-0.5 rounded">
              完了{projection.ytdMonths}ヶ月基準
            </span>
          </div>

          {/* 年間目標（月別目標の合計から自動算出） */}
          {projection.annualTarget && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-3 bg-gray-800/60 rounded-lg p-2">
              <span className="text-xs text-yellow-400 whitespace-nowrap">年間目標</span>
              <span className="text-sm font-bold text-yellow-400">{formatOkuMan(projection.annualTarget)}</span>
              <span className="text-[10px] text-gray-500">（月別目標の合計 / 下の「月別売上目標」で編集）</span>
            </div>
          )}

          {/* 3パターン表示 */}
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-3">
            {/* 高め見込み */}
            <div className="bg-emerald-900/20 rounded-lg p-2 sm:p-3 text-center border border-emerald-700/30">
              <p className="text-[10px] text-emerald-400 mb-0.5">高め見込み</p>
              <p className="text-xs sm:text-sm font-bold text-emerald-400">
                {formatOkuMan(projection.optimisticTotal)}
              </p>
              {projection.annualTarget && (
                <p className={`text-[10px] mt-0.5 ${projection.optimisticTotal >= projection.annualTarget ? 'text-green-400' : 'text-red-400'}`}>
                  目標差 {projection.optimisticTotal >= projection.annualTarget ? '+' : ''}{formatOkuMan(projection.optimisticTotal - projection.annualTarget)}
                </p>
              )}
            </div>
            {/* 着地予測（標準） */}
            <div className="bg-blue-900/30 rounded-lg p-2 sm:p-3 text-center border border-blue-600/30">
              <p className="text-[10px] text-blue-300 mb-0.5">着地予測</p>
              <p className="text-xs sm:text-sm font-bold text-white">
                {formatOkuMan(projection.projectedTotal)}
              </p>
              {projection.annualTarget && (
                <p className={`text-[10px] mt-0.5 ${projection.projectedTotal >= projection.annualTarget ? 'text-green-400' : 'text-red-400'}`}>
                  目標差 {projection.projectedTotal >= projection.annualTarget ? '+' : ''}{formatOkuMan(projection.projectedTotal - projection.annualTarget)}
                </p>
              )}
            </div>
            {/* 堅実ライン */}
            <div className="bg-gray-800/60 rounded-lg p-2 sm:p-3 text-center border border-gray-700/50">
              <p className="text-[10px] text-gray-400 mb-0.5">堅実ライン</p>
              <p className="text-xs sm:text-sm font-bold text-gray-300">
                {formatOkuMan(projection.conservativeTotal)}
              </p>
              {projection.annualTarget && (
                <p className={`text-[10px] mt-0.5 ${projection.conservativeTotal >= projection.annualTarget ? 'text-green-400' : 'text-red-400'}`}>
                  目標差 {projection.conservativeTotal >= projection.annualTarget ? '+' : ''}{formatOkuMan(projection.conservativeTotal - projection.annualTarget)}
                </p>
              )}
            </div>
          </div>

          {/* 根拠 */}
          <div className="text-[10px] text-gray-500 space-y-0.5">
            {projection.avgYoYGrowthRate !== null && (
              <p>完了月平均成長率: {projection.avgYoYGrowthRate >= 0 ? '+' : ''}{projection.avgYoYGrowthRate.toFixed(1)}%（前年同月比）</p>
            )}
            <p>完了実績: {projection.ytdMonths}ヶ月 {formatOkuMan(projection.ytdTotal)} / 今月+残り月は前年同月×成長率で予測</p>
            <p>高め見込み = 標準予測の105% / 堅実ライン = 標準予測の95%</p>
            {prevYearSummary && (
              <p>前年実績: {formatOkuMan(prevYearSummary.total)}
                {projection.yoyProjectedGrowth !== null && (
                  <> → 予測前年比 {projection.yoyProjectedGrowth >= 0 ? '+' : ''}{projection.yoyProjectedGrowth.toFixed(1)}%</>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 月別内訳（実績 + 予測） */}
      {projection && projection.monthDetails.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {projection.currentYear}年 月別内訳（着地予測）
          </h3>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-1 sm:px-2">月</th>
                  <th className="text-right py-2 px-1 sm:px-2">売上</th>
                  <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">前年同月</th>
                  <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">差額</th>
                  <th className="text-right py-2 px-1 sm:px-2">前年比</th>
                  <th className="py-2 px-1 sm:px-2 w-16 sm:w-24"></th>
                </tr>
              </thead>
              <tbody>
                {projection.monthDetails.map((d) => {
                  const prevYearMonth = annualSummaries
                    .find(s => s.year === projection.currentYear - 1)
                    ?.monthDetails.find(m => m.month === d.month)
                  const prevSales = prevYearMonth?.sales ?? 0
                  const diff = prevSales > 0 ? d.sales - prevSales : null
                  const yoy = prevSales > 0 ? ((d.sales - prevSales) / prevSales) * 100 : null
                  const maxSales = Math.max(...projection.monthDetails.map(m => m.sales))
                  const barPct = maxSales > 0 ? (d.sales / maxSales) * 100 : 0

                  return (
                    <tr
                      key={d.month}
                      className={`border-b border-gray-700/50 ${
                        d.isProjected ? 'opacity-60' : 'hover:bg-gray-700/30'
                      }`}
                    >
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-gray-300 font-medium whitespace-nowrap">
                        {d.month}月
                        {d.isProjected && (
                          <span className="text-[10px] text-blue-400 ml-0.5 sm:ml-1">予測</span>
                        )}
                      </td>
                      <td className={`py-1.5 sm:py-2 px-1 sm:px-2 text-right font-bold whitespace-nowrap ${d.isProjected ? 'text-blue-300' : 'text-white'}`}>
                        ¥{d.sales.toLocaleString()}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-500 hidden sm:table-cell">
                        {prevSales > 0 ? `¥${prevSales.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden sm:table-cell">
                        {diff !== null ? (
                          <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right">
                        {yoy !== null ? (
                          <span className={yoy >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2">
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${d.isProjected ? 'bg-blue-500/50' : 'bg-blue-500'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {/* 年間合計行 */}
                <tr className="border-t-2 border-gray-600 font-bold">
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-yellow-400">年間合計</td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-yellow-400 whitespace-nowrap">
                    ¥{projection.projectedTotal.toLocaleString()}
                  </td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400 hidden sm:table-cell">
                    ¥{projection.prevYearTotal.toLocaleString()}
                  </td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden sm:table-cell">
                    {(() => {
                      const projDiff = projection.projectedTotal - projection.prevYearTotal
                      return (
                        <span className={projDiff >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {projDiff >= 0 ? '+' : ''}¥{projDiff.toLocaleString()}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right">
                    {projection.yoyProjectedGrowth !== null && (
                      <span className={projection.yoyProjectedGrowth >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {projection.yoyProjectedGrowth >= 0 ? '+' : ''}{projection.yoyProjectedGrowth.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 前年のみ完全データで着地予測がない場合 */}
      {!projection && prevYearSummary && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {prevYearSummary.year}年 月別内訳
          </h3>
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-1 sm:px-2">月</th>
                  <th className="text-right py-2 px-1 sm:px-2">売上</th>
                  <th className="text-right py-2 px-1 sm:px-2">客数</th>
                  <th className="py-2 px-1 sm:px-2 w-16 sm:w-28"></th>
                </tr>
              </thead>
              <tbody>
                {prevYearSummary.monthDetails.map((d) => {
                  const maxSales = Math.max(...prevYearSummary.monthDetails.map(m => m.sales))
                  const barPct = maxSales > 0 ? (d.sales / maxSales) * 100 : 0
                  return (
                    <tr key={d.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-gray-300 font-medium">{d.month}月</td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-white font-bold whitespace-nowrap">¥{d.sales.toLocaleString()}</td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400">{d.customers.toLocaleString()}人</td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2">
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-gray-600 font-bold">
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-yellow-400">年間合計</td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-yellow-400 whitespace-nowrap">¥{prevYearSummary.total.toLocaleString()}</td>
                  <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400">{prevYearSummary.customers.toLocaleString()}人</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ━━━ 全店舗合計 過去実績 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TotalHistory({ data, onRefresh }: { data: HistoryData; onRefresh: () => void }) {
  if (data.totalMonthly.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">過去データがありません</p>
  }

  const maxSales = Math.max(...data.totalMonthly.map(m => m.sales))

  return (
    <div className="space-y-4">
      <AnnualOverview data={data} onRefresh={onRefresh} />

      {/* 月別売上目標 & 達成率 */}
      {data.projection && (
        <MonthlyTargetPanel
          currentYear={data.projection.currentYear}
          monthDetails={data.projection.monthDetails}
          projectedTotal={data.projection.projectedTotal}
          onRefresh={onRefresh}
        />
      )}

      {/* 年間レビュー */}
      <AnnualReviewPanel
        projection={data.projection}
        annualSummaries={data.annualSummaries}
        staffSummary={data.staffSummary}
        totalMonthly={data.totalMonthly}
      />

      {/* 出店計画 */}
      <StoreOpeningPlanSection
        plans={data.storeOpeningPlans ?? []}
        currentYear={data.projection?.currentYear ?? new Date().getFullYear()}
        newStoreTotal={data.projection?.newStoreTotal}
        seasonalIndex={data.seasonalIndex}
        onRefresh={onRefresh}
      />

      <div className="bg-gray-800 rounded-xl p-3 sm:p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">全店舗合計 月次推移</h3>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 px-1 sm:px-2">月</th>
                <th className="text-right py-2 px-1 sm:px-2">売上</th>
                <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">客数</th>
                <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">客単価</th>
                <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">差額</th>
                <th className="text-right py-2 px-1 sm:px-2">前月比</th>
                <th className="py-2 px-1 sm:px-2 w-16 sm:w-28"></th>
              </tr>
            </thead>
            <tbody>
              {data.totalMonthly.map((m, i) => {
                const prev = i > 0 ? data.totalMonthly[i - 1] : null
                const diff = prev ? m.sales - prev.sales : null
                const growth = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null
                const avgSpend = m.customers > 0 ? Math.round(m.sales / m.customers) : 0
                const barPct = maxSales > 0 ? (m.sales / maxSales) * 100 : 0
                return (
                  <tr key={m.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-gray-300 font-medium whitespace-nowrap">{formatMonth(m.month)}</td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-white font-bold whitespace-nowrap">¥{m.sales.toLocaleString()}</td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400 hidden sm:table-cell">{m.customers.toLocaleString()}人</td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400 hidden sm:table-cell">¥{avgSpend.toLocaleString()}</td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden sm:table-cell">
                      {diff !== null ? (
                        <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right">
                      {growth !== null ? (
                        <span className={growth >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 sm:py-2 px-1 sm:px-2">
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ━━━ 店舗別 過去実績 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function StoreHistory({
  data,
  selectedStore,
  onStoreChange,
}: {
  data: HistoryData
  selectedStore: string
  onStoreChange: (s: string) => void
}) {
  const storeSet = new Set<string>()
  for (const rows of Object.values(data.storeByMonth)) {
    for (const r of rows) storeSet.add(r.store)
  }
  // 閉店店舗を末尾に
  const stores = Array.from(storeSet).sort((a, b) => {
    const aClosed = isClosedStore(a)
    const bClosed = isClosedStore(b)
    if (aClosed !== bClosed) return aClosed ? 1 : -1
    return a.localeCompare(b)
  })

  // 選択店舗の実績データ
  const storeMonthlyData: { month: string; sales: number; customers: number }[] = []
  if (selectedStore === 'all') {
    for (const m of data.totalMonthly) {
      storeMonthlyData.push({ month: m.month, sales: m.sales, customers: m.customers })
    }
  } else {
    for (const month of data.months) {
      const rows = data.storeByMonth[month] || []
      const row = rows.find(r => r.store === selectedStore)
      if (row) {
        storeMonthlyData.push({ month, sales: row.sales, customers: row.customers })
      }
    }
  }

  // 選択店舗の未来予測を取得
  const projection = selectedStore !== 'all'
    ? (data.storeProjections ?? []).find(p => p.store === selectedStore)
    : null

  // 全店舗合計の場合はdata.projectionを使う
  const allProjection = selectedStore === 'all' ? data.projection : null

  // 未来月を追加（実績にない月だけ）
  type MonthRow = { month: string; sales: number; customers: number; isProjected: boolean }
  const combinedData: MonthRow[] = storeMonthlyData.map(m => ({ ...m, isProjected: false }))

  if (projection) {
    for (const pd of projection.monthDetails) {
      if (pd.isProjected) {
        const monthKey = `${new Date().getFullYear()}-${String(pd.month).padStart(2, '0')}`
        if (!combinedData.some(m => m.month === monthKey)) {
          combinedData.push({ month: monthKey, sales: pd.sales, customers: 0, isProjected: true })
        }
      }
    }
  } else if (allProjection) {
    for (const pd of allProjection.monthDetails) {
      if (pd.isProjected) {
        const monthKey = `${allProjection.currentYear}-${String(pd.month).padStart(2, '0')}`
        if (!combinedData.some(m => m.month === monthKey)) {
          combinedData.push({ month: monthKey, sales: pd.sales, customers: pd.customers, isProjected: true })
        }
      }
    }
  }

  combinedData.sort((a, b) => a.month.localeCompare(b.month))

  const maxSales = combinedData.length > 0 ? Math.max(...combinedData.map(m => m.sales)) : 0
  const isClosed = selectedStore !== 'all' && isClosedStore(selectedStore)
  const projectedTotal = projection?.projectedTotal
  const growthRate = projection?.avgGrowthRate
  const revenueCap = projection?.revenueCap

  return (
    <div className="space-y-3">
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">店舗選択</h3>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onStoreChange('all')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              selectedStore === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            全店舗合計
          </button>
          {stores.map(store => {
            const closed = isClosedStore(store)
            return (
              <button
                key={store}
                onClick={() => onStoreChange(store)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  selectedStore === store
                    ? 'bg-blue-600 text-white'
                    : closed
                    ? 'bg-gray-800 text-gray-600 hover:text-gray-500'
                    : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {shortenStoreName(store)}{closed ? ' (閉店)' : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-300">
              {selectedStore === 'all' ? '全店舗合計' : shortenStoreName(selectedStore)} 月別内訳・着地予測
            </h3>
            {isClosed && (
              <span className="text-[10px] bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded">閉店</span>
            )}
          </div>
          {projectedTotal !== undefined && !isClosed && (
            <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
              <span className="text-gray-500">年間着地</span>
              <span className="font-bold text-cyan-400">{formatOkuMan(projectedTotal)}</span>
              {growthRate != null && (
                <span className={`text-[10px] ${growthRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {growthRate >= 0 ? '+' : ''}{growthRate.toFixed(1)}%
                </span>
              )}
              {revenueCap && (
                <span className="text-[10px] text-orange-400/70">
                  上限 {formatOkuMan(revenueCap)}/月
                </span>
              )}
            </div>
          )}
        </div>
        {combinedData.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">データがありません</p>
        ) : (
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-1 sm:px-2">月</th>
                  <th className="text-right py-2 px-1 sm:px-2">売上</th>
                  <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">客数</th>
                  <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">客単価</th>
                  <th className="text-right py-2 px-1 sm:px-2 hidden sm:table-cell">差額</th>
                  <th className="text-right py-2 px-1 sm:px-2">前月比</th>
                  <th className="py-2 px-1 sm:px-2 w-16 sm:w-28"></th>
                </tr>
              </thead>
              <tbody>
                {combinedData.map((m, i) => {
                  const prev = i > 0 ? combinedData[i - 1] : null
                  const diff = prev ? m.sales - prev.sales : null
                  const growth = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null
                  const avgSpend = m.customers > 0 ? Math.round(m.sales / m.customers) : 0
                  const barPct = maxSales > 0 ? (m.sales / maxSales) * 100 : 0
                  return (
                    <tr
                      key={m.month}
                      className={`border-b border-gray-700/50 ${
                        m.isProjected ? 'opacity-60' : 'hover:bg-gray-700/30'
                      }`}
                    >
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-gray-300 font-medium whitespace-nowrap">
                        {formatMonth(m.month)}
                        {m.isProjected && (
                          <span className="text-[10px] text-cyan-400 ml-0.5 sm:ml-1">予測</span>
                        )}
                      </td>
                      <td className={`py-1.5 sm:py-2 px-1 sm:px-2 text-right font-bold whitespace-nowrap ${m.isProjected ? 'text-cyan-400' : 'text-white'}`}>
                        ¥{m.sales.toLocaleString()}
                        {m.isProjected && revenueCap && m.sales >= revenueCap && (
                          <span className="text-[9px] text-orange-400 ml-0.5">上限</span>
                        )}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400 hidden sm:table-cell">
                        {m.customers > 0 ? `${m.customers.toLocaleString()}人` : m.isProjected ? '—' : '0人'}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right text-gray-400 hidden sm:table-cell">
                        {avgSpend > 0 ? `¥${avgSpend.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right hidden sm:table-cell">
                        {diff !== null ? (
                          <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2 text-right">
                        {growth !== null ? (
                          <span className={growth >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-1.5 sm:py-2 px-1 sm:px-2">
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${m.isProjected ? 'bg-cyan-600/60' : 'bg-blue-500'}`} style={{ width: `${barPct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ━━━ スタッフ別 過去売上 & 上昇率 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function StaffHistory({ data }: { data: HistoryData }) {
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'current' | 'sales' | 'growth'>('current')

  if (data.staffSummary.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">スタッフデータがありません</p>
  }

  const hasCurrentMonth = !!data.staffCurrentMonth

  // 前月売上ランキング
  const byBaseSales = [...data.staffSummary].sort((a, b) => b.baseSales - a.baseSales)
  const baseRankMap = new Map<string, number>()
  byBaseSales.forEach((s, i) => baseRankMap.set(s.staff, i + 1))

  // 今月売上ランキング
  const byCurrentSales = [...data.staffSummary]
    .filter(s => s.currentSales > 0)
    .sort((a, b) => b.currentSales - a.currentSales)
  const currentRankMap = new Map<string, number>()
  byCurrentSales.forEach((s, i) => currentRankMap.set(s.staff, i + 1))

  // ソートキーがcurrentだけど今月データがなければsalesにフォールバック
  const effectiveSortKey = sortKey === 'current' && !hasCurrentMonth ? 'sales' : sortKey

  const sorted = [...data.staffSummary].sort((a, b) => {
    if (effectiveSortKey === 'growth') {
      const aG = a.growthRate ?? -Infinity
      const bG = b.growthRate ?? -Infinity
      return bG - aG
    }
    if (effectiveSortKey === 'current') {
      // 今月売上0のスタッフは下に
      if (a.currentSales === 0 && b.currentSales === 0) return b.baseSales - a.baseSales
      if (a.currentSales === 0) return 1
      if (b.currentSales === 0) return -1
      return b.currentSales - a.currentSales
    }
    return b.baseSales - a.baseSales
  })

  const maxSales = effectiveSortKey === 'current'
    ? Math.max(...sorted.map(s => s.currentSales), 1)
    : Math.max(...sorted.map(s => s.baseSales), 1)

  const prevShort = data.staffPrevMonth ? formatShortMonth(data.staffPrevMonth) : '前々月'
  const baseShort = data.staffBaseMonth ? formatShortMonth(data.staffBaseMonth) : '前月'
  const currentShort = data.staffCurrentMonth ? formatShortMonth(data.staffCurrentMonth) : '今月'
  const baseLabel = data.staffBaseMonth ? formatMonth(data.staffBaseMonth) : '前月'
  const currentLabel = data.staffCurrentMonth ? formatMonth(data.staffCurrentMonth) : '今月'

  const comparisonLabel = data.staffPrevMonth && data.staffBaseMonth
    ? `${prevShort}▶${baseShort}`
    : '前月比'

  const colCount = hasCurrentMonth ? 7 : 6

  // ランキング基準の表示テキスト
  const rankBasisLabel = effectiveSortKey === 'current'
    ? `${currentLabel}現状基準`
    : effectiveSortKey === 'growth'
    ? '上昇率基準'
    : `${baseLabel}基準`

  return (
    <div className="bg-gray-800 rounded-xl p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-medium text-gray-300">
          スタッフ別 売上順位 & 上昇率
        </h3>
        <div className="flex gap-1">
          {hasCurrentMonth && (
            <button
              onClick={() => setSortKey('current')}
              className={`text-xs px-2 py-1 rounded ${sortKey === 'current' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              {currentShort}順
            </button>
          )}
          <button
            onClick={() => setSortKey('sales')}
            className={`text-xs px-2 py-1 rounded ${sortKey === 'sales' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >
            {baseShort}順
          </button>
          <button
            onClick={() => setSortKey('growth')}
            className={`text-xs px-2 py-1 rounded ${sortKey === 'growth' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >
            上昇率順
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {rankBasisLabel}のランキング{hasCurrentMonth && effectiveSortKey !== 'current' && <> ・ {currentShort}は進行中</>}
      </p>

      <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-right py-2 px-1 w-6 sm:w-7">#</th>
              <th className="text-left py-2 px-1">スタッフ</th>
              {hasCurrentMonth && (
                <th className={`text-right py-2 px-1 ${effectiveSortKey === 'current' ? 'text-blue-300' : 'text-gray-500'}`}>
                  {currentShort}{effectiveSortKey === 'current' && <span className="text-yellow-400">★</span>}
                </th>
              )}
              <th className={`text-right py-2 px-1 ${effectiveSortKey === 'sales' ? 'text-white' : 'text-gray-500'}`}>
                {baseShort}{effectiveSortKey === 'sales' && <span className="text-yellow-400">★</span>}
              </th>
              <th className="text-right py-2 px-1 hidden sm:table-cell">{prevShort}</th>
              <th className="text-right py-2 px-1">{comparisonLabel}</th>
              <th className="py-2 px-1 w-10 sm:w-14"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const barValue = effectiveSortKey === 'current' ? s.currentSales : s.baseSales
              const barPct = maxSales > 0 ? (barValue / maxSales) * 100 : 0
              const isExpanded = expandedStaff === s.staff
              const rank = effectiveSortKey === 'current'
                ? (currentRankMap.get(s.staff) ?? '—')
                : effectiveSortKey === 'sales'
                ? (baseRankMap.get(s.staff) ?? 0)
                : (baseRankMap.get(s.staff) ?? 0)
              const salesDiff = s.baseSales - s.prevSales
              return (
                <Fragment key={s.staff}>
                  <tr
                    className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                    onClick={() => setExpandedStaff(isExpanded ? null : s.staff)}
                  >
                    <td className="py-1.5 sm:py-2 px-1 text-right">
                      <span className={`font-bold ${typeof rank === 'number' && rank <= 3 ? 'text-yellow-400' : 'text-gray-500'}`}>{rank}</span>
                    </td>
                    <td className="py-1.5 sm:py-2 px-1 text-gray-300 truncate max-w-[80px] sm:max-w-none">{s.staff}</td>
                    {hasCurrentMonth && (
                      <td className={`py-1.5 sm:py-2 px-1 text-right tabular-nums whitespace-nowrap ${effectiveSortKey === 'current' ? 'text-blue-300 font-bold' : 'text-blue-300'}`}>
                        {s.currentSales > 0 ? `¥${s.currentSales.toLocaleString()}` : '—'}
                      </td>
                    )}
                    <td className={`py-1.5 sm:py-2 px-1 text-right tabular-nums whitespace-nowrap ${effectiveSortKey === 'sales' ? 'text-white font-bold' : 'text-gray-400'}`}>
                      ¥{s.baseSales.toLocaleString()}
                    </td>
                    <td className="py-1.5 sm:py-2 px-1 text-right text-gray-500 tabular-nums hidden sm:table-cell">
                      {s.prevSales > 0 ? `¥${s.prevSales.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-1.5 sm:py-2 px-1 text-right whitespace-nowrap">
                      {s.growthRate !== null ? (
                        <div className="leading-tight">
                          <span className={`${s.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.growthRate >= 0 ? '+' : ''}{s.growthRate.toFixed(1)}%
                          </span>
                          <br className="hidden sm:block" />
                          <span className={`text-[10px] hidden sm:inline ${salesDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {salesDiff >= 0 ? '+' : ''}¥{salesDiff.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 sm:py-2 px-1">
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                    </td>
                  </tr>
                  {isExpanded && s.monthly.length > 0 && (
                    <tr>
                      <td colSpan={colCount} className="p-0">
                        <div className="bg-gray-900/50 px-4 py-2 border-b border-gray-700/50">
                          <p className="text-xs text-gray-500 mb-1">月次推移</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                            {s.monthly.map((m, mi) => {
                              const prev = mi > 0 ? s.monthly[mi - 1] : null
                              const mg = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null
                              const md = prev ? m.sales - prev.sales : null
                              const pLabel = prev ? formatShortMonth(prev.month) : ''
                              const cLabel = formatShortMonth(m.month)
                              return (
                                <div key={m.month} className="bg-gray-800 rounded p-2">
                                  <p className="text-gray-500 text-xs">{formatMonth(m.month)}</p>
                                  <p className="text-white font-bold text-sm">¥{m.sales.toLocaleString()}</p>
                                  {md !== null && (
                                    <p className={`text-[10px] ${md >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      <span className="text-gray-600">{pLabel}▶{cLabel}</span>{' '}
                                      {md >= 0 ? '+' : ''}¥{md.toLocaleString()}
                                    </p>
                                  )}
                                  {mg !== null && (
                                    <p className={`text-[10px] ${mg >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {mg >= 0 ? '+' : ''}{mg.toFixed(1)}%
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ━━━ ユーティリティ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatMonth(m: string): string {
  const [y, mo] = m.split('-')
  return `${y}年${parseInt(mo)}月`
}

function formatShortMonth(m: string): string {
  const [, mo] = m.split('-')
  return `${parseInt(mo)}月`
}

/** 億万表記（¥9億8,200万 形式） */
function formatOkuMan(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const oku = Math.floor(abs / 100000000)
  const man = Math.round((abs % 100000000) / 10000)
  if (oku > 0 && man > 0) return `${sign}¥${oku}億${man.toLocaleString()}万`
  if (oku > 0) return `${sign}¥${oku}億`
  return `${sign}¥${man.toLocaleString()}万`
}

function shortenStoreName(name: string): string {
  return name
    .replace('AI TOKYO ', '')
    .replace('AITOKYO ', '')
    .replace("men's ", '')
    .replace('by AI TOKYO', '')
}

// ━━━ 出店計画 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function StoreOpeningPlanSection({
  plans,
  currentYear,
  newStoreTotal,
  seasonalIndex,
  onRefresh,
}: {
  plans: StoreOpeningPlan[]
  currentYear: number
  newStoreTotal?: number
  seasonalIndex?: Record<number, number>
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(currentYear)
  const [storeName, setStoreName] = useState('')
  const [openingMonth, setOpeningMonth] = useState(1)
  const [maxRevenue, setMaxRevenue] = useState('')
  const [seats, setSeats] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const yearPlans = plans.filter(p => p.year === year)

  const growthCurve = [0.30, 0.50, 0.70, 0.85, 0.95, 1.0]

  const resetForm = () => {
    setStoreName('')
    setMaxRevenue('')
    setSeats('')
    setOpeningMonth(1)
    setEditingId(null)
  }

  const startEdit = (plan: StoreOpeningPlan) => {
    setEditingId(plan.id)
    setStoreName(plan.store_name)
    setOpeningMonth(plan.opening_month)
    setMaxRevenue(String(Math.round(plan.max_monthly_revenue / 10000)))
    setSeats(plan.seats > 0 ? String(plan.seats) : '')
    setYear(plan.year)
  }

  const handleSave = async () => {
    if (!storeName || !maxRevenue) return
    let revenue = parseInt(maxRevenue.replace(/[,¥\s万億]/g, ''))
    if (isNaN(revenue) || revenue <= 0) return
    if (revenue < 10000) revenue = revenue * 10000

    const seatNum = parseInt(seats) || 0
    setSaving(true)
    try {
      await fetch('/api/store-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          opening_month: openingMonth,
          store_name: storeName,
          max_monthly_revenue: revenue,
          seats: seatNum,
        }),
      })
      resetForm()
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    await fetch(`/api/store-plans?id=${id}`, { method: 'DELETE' })
    if (editingId === id) resetForm()
    onRefresh()
  }

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">
            出店計画
          </span>
          {plans.length > 0 && (
            <span className="text-xs bg-purple-900/50 text-purple-400 px-1.5 py-0.5 rounded">
              {plans.length}件
            </span>
          )}
          {newStoreTotal && newStoreTotal > 0 && (
            <span className="text-xs text-gray-500">
              (新店舗 年間+{formatOkuMan(newStoreTotal)})
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* 年切替 */}
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-400">対象年:</span>
            {[currentYear, currentYear + 1, currentYear + 2].map(y => (
              <button
                key={y}
                onClick={() => { setYear(y); resetForm() }}
                className={`text-xs px-2 py-1 rounded ${
                  year === y
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {y}年
              </button>
            ))}
          </div>

          {/* 既存の出店計画 */}
          {yearPlans.length > 0 && (
            <div className="space-y-2">
              {yearPlans.map(plan => {
                const monthsActive = 12 - plan.opening_month + 1
                const yearRevenue = Array.from({ length: monthsActive }, (_, i) => {
                  const rate = i < growthCurve.length ? growthCurve[i] : 1.0
                  return Math.round(plan.max_monthly_revenue * rate)
                }).reduce((s, v) => s + v, 0)
                const isEditing = editingId === plan.id

                return (
                  <div key={plan.id} className={`rounded-lg p-3 ${isEditing ? 'bg-purple-900/30 border border-purple-700/50' : 'bg-gray-700/50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">
                          {plan.store_name}
                          <span className="text-xs text-gray-400 ml-1 sm:ml-2">
                            {plan.year}年{plan.opening_month}月開店
                          </span>
                          {plan.seats > 0 && (
                            <span className="text-xs text-gray-500 ml-1 sm:ml-2">
                              {plan.seats}席
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          MAX月売上: {formatOkuMan(plan.max_monthly_revenue)}
                          <span className="text-gray-500 mx-1">|</span>
                          {plan.year}年 寄与: {formatOkuMan(yearRevenue)}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5 hidden sm:block">
                          成長カーブ: 1ヶ月目30% → 50% → 70% → 85% → 95% → 6ヶ月目〜季節変動反映
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => isEditing ? resetForm() : startEdit(plan)}
                          className={`text-xs px-2 py-1 rounded ${
                            isEditing
                              ? 'text-gray-400 hover:text-gray-200 bg-gray-600'
                              : 'text-blue-400 hover:text-blue-300'
                          }`}
                        >
                          {isEditing ? 'キャンセル' : '編集'}
                        </button>
                        <button
                          onClick={() => handleDelete(plan.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 季節変動率 */}
          {seasonalIndex && Object.keys(seasonalIndex).length > 0 && (
            <div className="bg-gray-700/30 rounded-lg p-3">
              <p className="text-xs text-gray-400 font-medium mb-2">
                季節変動率（前年実績ベース / 6ヶ月目以降に適用）
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                  const rate = seasonalIndex[mo]
                  if (rate === undefined) return null
                  const pct = Math.round(rate * 100)
                  const color = pct >= 110 ? 'text-emerald-400 bg-emerald-900/30'
                    : pct >= 95 ? 'text-gray-300 bg-gray-700/50'
                    : 'text-orange-400 bg-orange-900/30'
                  return (
                    <div key={mo} className={`text-center rounded px-1 py-1 ${color}`}>
                      <p className="text-[10px] text-gray-500">{mo}月</p>
                      <p className="text-xs font-bold">{pct}%</p>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-gray-600 mt-1.5">
                ※ 100%=年間平均 / 繁忙月は100%超、閑散月は100%未満で出店計画の予測売上に反映
              </p>
            </div>
          )}

          {/* 追加/編集フォーム */}
          <div className={`rounded-lg p-3 space-y-3 ${editingId ? 'bg-purple-900/20 border border-purple-700/30' : 'bg-gray-700/30'}`}>
            <p className="text-xs text-gray-400 font-medium">
              {editingId ? '出店計画を編集' : '新規出店を追加'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500">店舗名</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="例: AI TOKYO 新宿店"
                  className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">開店月</label>
                <select
                  value={openingMonth}
                  onChange={e => setOpeningMonth(parseInt(e.target.value))}
                  className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 mt-0.5"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{m}月</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500">MAX月売上（万円）</label>
                <input
                  type="text"
                  value={maxRevenue}
                  onChange={e => setMaxRevenue(e.target.value)}
                  placeholder="例: 200（= 200万）"
                  className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 mt-0.5"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">席数（任意）</label>
                <input
                  type="text"
                  value={seats}
                  onChange={e => setSeats(e.target.value)}
                  placeholder="例: 5"
                  className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 mt-0.5"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !storeName || !maxRevenue}
                className="text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-1.5 rounded"
              >
                {saving ? '保存中...' : editingId ? '更新' : '追加'}
              </button>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="text-xs text-gray-400 hover:text-gray-200 px-4 py-1.5"
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
