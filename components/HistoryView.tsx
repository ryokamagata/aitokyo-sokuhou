'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import AnnualReviewPanel from './AnnualReviewPanel'

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
  const [annualTargetValue, setAnnualTargetValue] = useState('')
  const [annualTargetSaving, setAnnualTargetSaving] = useState(false)
  const [annualTargetSaved, setAnnualTargetSaved] = useState(false)

  // 年間目標の初期値をセット
  useEffect(() => {
    if (projection?.annualTarget) {
      setAnnualTargetValue(projection.annualTarget.toLocaleString())
    }
  }, [projection?.annualTarget])

  if (!annualSummaries || annualSummaries.length === 0) return null

  const prevYearSummary = annualSummaries.find(s => s.isComplete)

  const saveAnnualTarget = async () => {
    const target = parseInt(annualTargetValue.replace(/[,¥\s万億]/g, ''))
    if (isNaN(target) || target <= 0 || !projection) return

    // 万を入力した場合の補正: 100未満なら億として、10000未満なら万として扱う
    let finalTarget = target
    if (target < 100) {
      finalTarget = target * 100000000 // 億
    } else if (target < 100000) {
      finalTarget = target * 10000 // 万
    }

    setAnnualTargetSaving(true)
    try {
      await fetch('/api/annual-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: projection.currentYear, target: finalTarget }),
      })
      setAnnualTargetSaved(true)
      setTimeout(() => setAnnualTargetSaved(false), 2000)
      onRefresh()
    } finally {
      setAnnualTargetSaving(false)
    }
  }

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

          {/* 年間目標入力 */}
          <div className="flex items-center gap-2 mb-3 bg-gray-800/60 rounded-lg p-2">
            <span className="text-xs text-yellow-400 whitespace-nowrap">年間目標</span>
            <span className="text-xs text-gray-500">¥</span>
            <input
              type="text"
              value={annualTargetValue}
              onChange={(e) => setAnnualTargetValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveAnnualTarget() }}
              placeholder="10億 or 1,000,000,000"
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs
                         w-36 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={saveAnnualTarget}
              disabled={annualTargetSaving}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-xs
                         px-2 py-1 rounded transition-colors whitespace-nowrap"
            >
              {annualTargetSaving ? '保存中' : annualTargetSaved ? '保存済み' : '保存'}
            </button>
            {projection.annualTarget && (
              <span className="text-[10px] text-yellow-400/70 whitespace-nowrap">
                現在: {formatOkuMan(projection.annualTarget)}
              </span>
            )}
          </div>

          {/* 3パターン表示 */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {/* 高め見込み */}
            <div className="bg-emerald-900/20 rounded-lg p-3 text-center border border-emerald-700/30">
              <p className="text-[10px] text-emerald-400 mb-1">高め見込み</p>
              <p className="text-sm font-bold text-emerald-400">
                {formatOkuMan(projection.optimisticTotal)}
              </p>
              {projection.annualTarget && (
                <p className={`text-[10px] mt-0.5 ${projection.optimisticTotal >= projection.annualTarget ? 'text-green-400' : 'text-red-400'}`}>
                  目標差 {projection.optimisticTotal >= projection.annualTarget ? '+' : ''}{formatOkuMan(projection.optimisticTotal - projection.annualTarget)}
                </p>
              )}
            </div>
            {/* 着地予測（標準） */}
            <div className="bg-blue-900/30 rounded-lg p-3 text-center border border-blue-600/30">
              <p className="text-[10px] text-blue-300 mb-1">着地予測</p>
              <p className="text-sm font-bold text-white">
                {formatOkuMan(projection.projectedTotal)}
              </p>
              {projection.annualTarget && (
                <p className={`text-[10px] mt-0.5 ${projection.projectedTotal >= projection.annualTarget ? 'text-green-400' : 'text-red-400'}`}>
                  目標差 {projection.projectedTotal >= projection.annualTarget ? '+' : ''}{formatOkuMan(projection.projectedTotal - projection.annualTarget)}
                </p>
              )}
            </div>
            {/* 堅実ライン */}
            <div className="bg-gray-800/60 rounded-lg p-3 text-center border border-gray-700/50">
              <p className="text-[10px] text-gray-400 mb-1">堅実ライン</p>
              <p className="text-sm font-bold text-gray-300">
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-2">月</th>
                  <th className="text-right py-2 px-2">売上</th>
                  <th className="text-right py-2 px-2">前年同月</th>
                  <th className="text-right py-2 px-2">差額</th>
                  <th className="text-right py-2 px-2">前年比</th>
                  <th className="py-2 px-2 w-24"></th>
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
                      <td className="py-2 px-2 text-gray-300 font-medium">
                        {d.month}月
                        {d.isProjected && (
                          <span className="text-[10px] text-blue-400 ml-1">予測</span>
                        )}
                      </td>
                      <td className={`py-2 px-2 text-right font-bold ${d.isProjected ? 'text-blue-300' : 'text-white'}`}>
                        ¥{d.sales.toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-500">
                        {prevSales > 0 ? `¥${prevSales.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {diff !== null ? (
                          <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {yoy !== null ? (
                          <span className={yoy >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
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
                  <td className="py-2 px-2 text-yellow-400">年間合計</td>
                  <td className="py-2 px-2 text-right text-yellow-400">
                    ¥{projection.projectedTotal.toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-400">
                    ¥{projection.prevYearTotal.toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {(() => {
                      const projDiff = projection.projectedTotal - projection.prevYearTotal
                      return (
                        <span className={projDiff >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {projDiff >= 0 ? '+' : ''}¥{projDiff.toLocaleString()}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="py-2 px-2 text-right">
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
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-2">月</th>
                  <th className="text-right py-2 px-2">売上</th>
                  <th className="text-right py-2 px-2">客数</th>
                  <th className="py-2 px-2 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {prevYearSummary.monthDetails.map((d) => {
                  const maxSales = Math.max(...prevYearSummary.monthDetails.map(m => m.sales))
                  const barPct = maxSales > 0 ? (d.sales / maxSales) * 100 : 0
                  return (
                    <tr key={d.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-2 text-gray-300 font-medium">{d.month}月</td>
                      <td className="py-2 px-2 text-right text-white font-bold">¥{d.sales.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-gray-400">{d.customers.toLocaleString()}人</td>
                      <td className="py-2 px-2">
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-gray-600 font-bold">
                  <td className="py-2 px-2 text-yellow-400">年間合計</td>
                  <td className="py-2 px-2 text-right text-yellow-400">¥{prevYearSummary.total.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right text-gray-400">{prevYearSummary.customers.toLocaleString()}人</td>
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

      {/* 年間レビュー */}
      <AnnualReviewPanel
        projection={data.projection}
        annualSummaries={data.annualSummaries}
        staffSummary={data.staffSummary}
        totalMonthly={data.totalMonthly}
      />

      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">全店舗合計 月次推移</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-2 px-2">月</th>
                <th className="text-right py-2 px-2">売上</th>
                <th className="text-right py-2 px-2">客数</th>
                <th className="text-right py-2 px-2">客単価</th>
                <th className="text-right py-2 px-2">差額</th>
                <th className="text-right py-2 px-2">前月比</th>
                <th className="py-2 px-2 w-28"></th>
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
                    <td className="py-2 px-2 text-gray-300 font-medium">{formatMonth(m.month)}</td>
                    <td className="py-2 px-2 text-right text-white font-bold">¥{m.sales.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right text-gray-400">{m.customers.toLocaleString()}人</td>
                    <td className="py-2 px-2 text-right text-gray-400">¥{avgSpend.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right">
                      {diff !== null ? (
                        <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {growth !== null ? (
                        <span className={growth >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
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
  const stores = Array.from(storeSet).sort()

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

  const maxSales = storeMonthlyData.length > 0 ? Math.max(...storeMonthlyData.map(m => m.sales)) : 0

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

      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">
          {selectedStore === 'all' ? '全店舗合計' : shortenStoreName(selectedStore)} 月次推移
        </h3>
        {storeMonthlyData.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">データがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 px-2">月</th>
                  <th className="text-right py-2 px-2">売上</th>
                  <th className="text-right py-2 px-2">客数</th>
                  <th className="text-right py-2 px-2">客単価</th>
                  <th className="text-right py-2 px-2">差額</th>
                  <th className="text-right py-2 px-2">前月比</th>
                  <th className="py-2 px-2 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {storeMonthlyData.map((m, i) => {
                  const prev = i > 0 ? storeMonthlyData[i - 1] : null
                  const diff = prev ? m.sales - prev.sales : null
                  const growth = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null
                  const avgSpend = m.customers > 0 ? Math.round(m.sales / m.customers) : 0
                  const barPct = maxSales > 0 ? (m.sales / maxSales) * 100 : 0
                  return (
                    <tr key={m.month} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 px-2 text-gray-300 font-medium">{formatMonth(m.month)}</td>
                      <td className="py-2 px-2 text-right text-white font-bold">¥{m.sales.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right text-gray-400">{m.customers.toLocaleString()}人</td>
                      <td className="py-2 px-2 text-right text-gray-400">¥{avgSpend.toLocaleString()}</td>
                      <td className="py-2 px-2 text-right">
                        {diff !== null ? (
                          <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {growth !== null ? (
                          <span className={growth >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
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
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
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

      <div className="overflow-x-auto">
        <table className="w-full text-xs table-fixed">
          <colgroup>
            <col style={{ width: '28px' }} />
            <col />
            {hasCurrentMonth && <col style={{ width: '90px' }} />}
            <col style={{ width: '100px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '56px' }} />
          </colgroup>
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-right py-2 px-1">#</th>
              <th className="text-left py-2 px-1">スタッフ</th>
              {hasCurrentMonth && (
                <th className={`text-right py-2 px-1 ${effectiveSortKey === 'current' ? 'text-blue-300' : 'text-gray-500'}`}>
                  {currentShort}現状{effectiveSortKey === 'current' && <span className="text-yellow-400">★</span>}
                </th>
              )}
              <th className={`text-right py-2 px-1 ${effectiveSortKey === 'sales' ? 'text-white' : 'text-gray-500'}`}>
                {baseShort}{effectiveSortKey === 'sales' && <span className="text-yellow-400">★</span>}
              </th>
              <th className="text-right py-2 px-1">{prevShort}</th>
              <th className="text-right py-2 px-1">{comparisonLabel}</th>
              <th className="py-2 px-1"></th>
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
                    <td className="py-2 px-1 text-right">
                      <span className={`font-bold ${typeof rank === 'number' && rank <= 3 ? 'text-yellow-400' : 'text-gray-500'}`}>{rank}</span>
                    </td>
                    <td className="py-2 px-1 text-gray-300 truncate">{s.staff}</td>
                    {hasCurrentMonth && (
                      <td className={`py-2 px-1 text-right tabular-nums ${effectiveSortKey === 'current' ? 'text-blue-300 font-bold' : 'text-blue-300'}`}>
                        {s.currentSales > 0 ? `¥${s.currentSales.toLocaleString()}` : '—'}
                      </td>
                    )}
                    <td className={`py-2 px-1 text-right tabular-nums ${effectiveSortKey === 'sales' ? 'text-white font-bold' : 'text-gray-400'}`}>
                      ¥{s.baseSales.toLocaleString()}
                    </td>
                    <td className="py-2 px-1 text-right text-gray-500 tabular-nums">
                      {s.prevSales > 0 ? `¥${s.prevSales.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-2 px-1 text-right">
                      {s.growthRate !== null ? (
                        <div className="leading-tight">
                          <span className={`${s.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.growthRate >= 0 ? '+' : ''}{s.growthRate.toFixed(1)}%
                          </span>
                          <br />
                          <span className={`text-[10px] ${salesDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {salesDiff >= 0 ? '+' : ''}¥{salesDiff.toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-1">
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
