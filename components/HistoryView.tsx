'use client'

import { useEffect, useState } from 'react'

type TotalMonthly = { month: string; sales: number; customers: number }
type StoreMonthRow = { store: string; sales: number; customers: number }
type StaffSummary = {
  staff: string
  latestSales: number
  prevSales: number
  growthRate: number | null
  monthly: { month: string; sales: number }[]
}

type HistoryData = {
  months: string[]
  latestMonth: string
  prevMonth: string
  totalMonthly: TotalMonthly[]
  storeByMonth: Record<string, StoreMonthRow[]>
  staffSummary: StaffSummary[]
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

// ━━━ 全店舗合計 過去実績 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TotalHistory({ data }: { data: HistoryData }) {
  if (data.totalMonthly.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">過去データがありません</p>
  }

  const maxSales = Math.max(...data.totalMonthly.map(m => m.sales))

  return (
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
              <th className="text-right py-2 px-2">前月比</th>
              <th className="py-2 px-2 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {data.totalMonthly.map((m, i) => {
              const prev = i > 0 ? data.totalMonthly[i - 1] : null
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
    // 全店舗 → totalMonthlyをそのまま
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
                  <th className="text-right py-2 px-2">前月比</th>
                  <th className="py-2 px-2 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {storeMonthlyData.map((m, i) => {
                  const prev = i > 0 ? storeMonthlyData[i - 1] : null
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

  const sorted = [...data.staffSummary].sort((a, b) => {
    if (sortKey === 'growth') {
      const aG = a.growthRate ?? -Infinity
      const bG = b.growthRate ?? -Infinity
      return bG - aG
    }
    return b.latestSales - a.latestSales
  })

  const maxSales = Math.max(...sorted.map(s => s.latestSales))

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">
          スタッフ別 売上推移 & 上昇率
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
        {data.latestMonth && `最新: ${formatMonth(data.latestMonth)}`}
        {data.prevMonth && ` / 前月比: vs ${formatMonth(data.prevMonth)}`}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-2 px-2 w-6">#</th>
              <th className="text-left py-2 px-2">スタッフ</th>
              <th className="text-right py-2 px-2">今月売上</th>
              <th className="text-right py-2 px-2">前月売上</th>
              <th className="text-right py-2 px-2">前月比</th>
              <th className="py-2 px-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => {
              const barPct = maxSales > 0 ? (s.latestSales / maxSales) * 100 : 0
              const isExpanded = expandedStaff === s.staff
              return (
                <tr key={s.staff} className="group">
                  <td colSpan={6} className="p-0">
                    <div
                      className="flex items-center border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer py-2 px-2"
                      onClick={() => setExpandedStaff(isExpanded ? null : s.staff)}
                    >
                      <span className="text-gray-500 w-6 text-right shrink-0">{i + 1}</span>
                      <span className="text-gray-300 truncate flex-1 px-2">{s.staff}</span>
                      <span className="text-white font-bold shrink-0 px-2 text-right w-24">
                        ¥{s.latestSales.toLocaleString()}
                      </span>
                      <span className="text-gray-400 shrink-0 px-2 text-right w-24">
                        ¥{s.prevSales.toLocaleString()}
                      </span>
                      <span className="shrink-0 px-2 text-right w-16">
                        {s.growthRate !== null ? (
                          <span className={s.growthRate >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {s.growthRate >= 0 ? '+' : ''}{s.growthRate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </span>
                      <div className="w-24 shrink-0 px-2">
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
                            return (
                              <div key={m.month} className="bg-gray-800 rounded p-2">
                                <p className="text-gray-500 text-xs">{formatMonth(m.month)}</p>
                                <p className="text-white font-bold text-sm">¥{m.sales.toLocaleString()}</p>
                                {mg !== null && (
                                  <p className={`text-xs ${mg >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
