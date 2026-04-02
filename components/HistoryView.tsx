'use client'

import { useEffect, useState } from 'react'

type TotalMonthly = { month: string; sales: number; customers: number }
type StoreMonthRow = { store: string; sales: number; customers: number }
type StaffSummary = {
  staff: string
  latestSales: number
  prevSales: number
  prev2Sales: number
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
}

type HistoryData = {
  months: string[]
  latestMonth: string
  prevMonth: string
  staffLatestMonth: string
  staffPrevMonth: string
  staffPrev2Month: string
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

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

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

      {subTab === 'total' && <TotalHistory data={data} />}
      {subTab === 'store' && (
        <StoreHistory data={data} selectedStore={selectedStore} onStoreChange={setSelectedStore} />
      )}
      {subTab === 'staff' && <StaffHistory data={data} />}
    </div>
  )
}

// ━━━ 年間合計 & 着地予測 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AnnualOverview({ data }: { data: HistoryData }) {
  const { annualSummaries, projection } = data
  if (!annualSummaries || annualSummaries.length === 0) return null

  // 前年（完全データ）のサマリーを探す
  const prevYearSummary = annualSummaries.find(s => s.isComplete)

  // 着地予測と前年の差額
  const projDiff = projection && prevYearSummary
    ? projection.projectedTotal - prevYearSummary.total
    : null

  return (
    <div className="space-y-3">
      {/* 年間合計カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 前年実績 */}
        {prevYearSummary && (
          <div className="bg-gray-700/50 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">{prevYearSummary.year}年 年間合計</p>
            <p className="text-xl font-bold text-white">
              ¥{prevYearSummary.total.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              客数: {prevYearSummary.customers.toLocaleString()}人
              {prevYearSummary.customers > 0 && (
                <> / 客単価: ¥{Math.round(prevYearSummary.total / prevYearSummary.customers).toLocaleString()}</>
              )}
            </p>
          </div>
        )}

        {/* 今年着地予測 */}
        {projection && (
          <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-700/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs text-blue-300">{projection.currentYear}年 着地予測</p>
              <span className="text-[10px] bg-blue-800/50 text-blue-300 px-1.5 py-0.5 rounded">
                予測
              </span>
            </div>
            <p className="text-xl font-bold text-white">
              ¥{projection.projectedTotal.toLocaleString()}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              {projection.yoyProjectedGrowth !== null && (
                <span className={`text-xs font-medium ${projection.yoyProjectedGrowth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  前年比 {projection.yoyProjectedGrowth >= 0 ? '+' : ''}{projection.yoyProjectedGrowth.toFixed(1)}%
                </span>
              )}
              {projDiff !== null && (
                <span className={`text-xs font-medium ${projDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ({projDiff >= 0 ? '+' : ''}¥{projDiff.toLocaleString()})
                </span>
              )}
              {projection.avgYoYGrowthRate !== null && (
                <span className="text-[10px] text-gray-500">
                  月平均成長率: {projection.avgYoYGrowthRate >= 0 ? '+' : ''}{projection.avgYoYGrowthRate.toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              実績: {projection.ytdMonths}ヶ月 (¥{projection.ytdTotal.toLocaleString()})
              {' / '}残り {12 - projection.ytdMonths}ヶ月は前年同月×成長率で予測
            </p>
          </div>
        )}
      </div>

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
                    {projDiff !== null && (
                      <span className={projDiff >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {projDiff >= 0 ? '+' : ''}¥{projDiff.toLocaleString()}
                      </span>
                    )}
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

      {/* 前年のみ完全データで着地予測がない場合: 年間合計テーブル */}
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

function TotalHistory({ data }: { data: HistoryData }) {
  if (data.totalMonthly.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">過去データがありません</p>
  }

  const maxSales = Math.max(...data.totalMonthly.map(m => m.sales))

  return (
    <div className="space-y-4">
      {/* 年間合計 & 着地予測 */}
      <AnnualOverview data={data} />

      {/* 月次推移テーブル */}
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
  // 全店舗リスト抽出
  const storeSet = new Set<string>()
  for (const rows of Object.values(data.storeByMonth)) {
    for (const r of rows) storeSet.add(r.store)
  }
  const stores = Array.from(storeSet).sort()

  // 選択店舗の月次データ
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
      {/* 店舗セレクター */}
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

      {/* 月次推移テーブル */}
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
  const [sortKey, setSortKey] = useState<'sales' | 'growth'>('sales')

  if (data.staffSummary.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">スタッフデータがありません</p>
  }

  // 売上順でランキング番号を付与
  const bySales = [...data.staffSummary].sort((a, b) => b.latestSales - a.latestSales)
  const salesRankMap = new Map<string, number>()
  bySales.forEach((s, i) => salesRankMap.set(s.staff, i + 1))

  const sorted = [...data.staffSummary].sort((a, b) => {
    if (sortKey === 'growth') {
      const aG = a.growthRate ?? -Infinity
      const bG = b.growthRate ?? -Infinity
      return bG - aG
    }
    return b.latestSales - a.latestSales
  })

  const maxSales = Math.max(...sorted.map(s => s.latestSales))

  const m2Label = data.staffPrev2Month ? formatMonth(data.staffPrev2Month) : '前々月'
  const m1Label = data.staffPrevMonth ? formatMonth(data.staffPrevMonth) : '前月'
  const m0Label = data.staffLatestMonth ? formatMonth(data.staffLatestMonth) : '今月'

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">
          スタッフ別 売上順位 & 上昇率
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => setSortKey('sales')}
            className={`text-xs px-2 py-1 rounded ${sortKey === 'sales' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
          >
            売上順
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
        {m2Label} → {m1Label} → {m0Label}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-2 px-1 w-6">順位</th>
              <th className="text-left py-2 px-1">スタッフ</th>
              <th className="text-right py-2 px-1">{m2Label}</th>
              <th className="text-right py-2 px-1">{m1Label}</th>
              <th className="text-right py-2 px-1">{m0Label}</th>
              <th className="text-right py-2 px-1">前月比</th>
              <th className="py-2 px-1 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const barPct = maxSales > 0 ? (s.latestSales / maxSales) * 100 : 0
              const isExpanded = expandedStaff === s.staff
              const diff = s.prevSales > 0 ? s.latestSales - s.prevSales : null
              const rank = salesRankMap.get(s.staff) ?? 0
              return (
                <tr key={s.staff} className="group">
                  <td colSpan={7} className="p-0">
                    <div
                      className="flex items-center border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer py-2 px-1"
                      onClick={() => setExpandedStaff(isExpanded ? null : s.staff)}
                    >
                      <span className={`w-6 text-right shrink-0 font-bold ${rank <= 3 ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {rank}
                      </span>
                      <span className="text-gray-300 truncate flex-1 px-1 min-w-0">{s.staff}</span>
                      <span className="text-gray-500 shrink-0 px-1 text-right w-20">
                        {s.prev2Sales > 0 ? `¥${s.prev2Sales.toLocaleString()}` : '—'}
                      </span>
                      <span className="text-gray-400 shrink-0 px-1 text-right w-20">
                        ¥{s.prevSales.toLocaleString()}
                      </span>
                      <span className="text-white font-bold shrink-0 px-1 text-right w-20">
                        ¥{s.latestSales.toLocaleString()}
                      </span>
                      <span className="shrink-0 px-1 text-right w-16">
                        {s.growthRate !== null ? (
                          <span className={s.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {s.growthRate >= 0 ? '+' : ''}{s.growthRate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </span>
                      <div className="w-16 shrink-0 px-1">
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                        </div>
                      </div>
                    </div>
                    {/* 展開: 月次推移 */}
                    {isExpanded && s.monthly.length > 0 && (
                      <div className="bg-gray-900/50 px-4 py-2 border-b border-gray-700/50">
                        <p className="text-xs text-gray-500 mb-1">月次推移</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                          {s.monthly.map((m, mi) => {
                            const prev = mi > 0 ? s.monthly[mi - 1] : null
                            const mg = prev && prev.sales > 0 ? ((m.sales - prev.sales) / prev.sales) * 100 : null
                            const md = prev ? m.sales - prev.sales : null
                            return (
                              <div key={m.month} className="bg-gray-800 rounded p-2">
                                <p className="text-gray-500 text-xs">{formatMonth(m.month)}</p>
                                <p className="text-white font-bold text-sm">¥{m.sales.toLocaleString()}</p>
                                {md !== null && (
                                  <p className={`text-[10px] ${md >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
                    )}
                  </td>
                </tr>
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

function shortenStoreName(name: string): string {
  return name
    .replace('AI TOKYO ', '')
    .replace('AITOKYO ', '')
    .replace("men's ", '')
    .replace('by AI TOKYO', '')
}
