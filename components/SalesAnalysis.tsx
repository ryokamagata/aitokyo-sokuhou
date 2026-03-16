'use client'

interface AccountData {
  summary: {
    pureSales: number
    avgSpend: number
    totalCustomers: number
    namedSales: number
    namedCount: number
    totalSales: number
  }
  daily: {
    date: string
    pureSales: number
    avgSpend: number
    customers: number
    namedSales: number
    namedSpend: number
    namedCount: number
    totalSales: number
  }[]
}

export default function SalesAnalysis({ stores }: { stores: { store: string; data: AccountData }[] }) {
  if (stores.length === 0) return <Empty />

  // Aggregate
  const agg = {
    pureSales: 0, avgSpend: 0, totalCustomers: 0,
    namedSales: 0, namedCount: 0, totalSales: 0,
  }
  for (const s of stores) {
    const sum = s.data?.summary ?? { pureSales: 0, totalCustomers: 0, namedSales: 0, namedCount: 0, totalSales: 0 }
    agg.pureSales += sum.pureSales || 0
    agg.totalCustomers += sum.totalCustomers || 0
    agg.namedSales += sum.namedSales || 0
    agg.namedCount += sum.namedCount || 0
    agg.totalSales += sum.totalSales || 0
  }
  agg.avgSpend = agg.totalCustomers > 0 ? Math.round(agg.pureSales / agg.totalCustomers) : 0

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Kpi label="純売上" value={`¥${agg.pureSales.toLocaleString()}`} />
        <Kpi label="客単価" value={`¥${agg.avgSpend.toLocaleString()}`} />
        <Kpi label="総客数" value={`${agg.totalCustomers}人`} />
        <Kpi label="指名売上" value={`¥${agg.namedSales.toLocaleString()}`} />
        <Kpi label="指名数" value={`${agg.namedCount}人`} />
        <Kpi label="総売上" value={`¥${agg.totalSales.toLocaleString()}`} />
      </div>

      {/* Store breakdown */}
      {stores.length > 1 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">店舗別 売上</h3>
          <div className="space-y-2">
            {stores
              .sort((a, b) => (b.data?.summary?.pureSales || 0) - (a.data?.summary?.pureSales || 0))
              .map((s) => {
                const ps = s.data?.summary?.pureSales || 0
                const pct = agg.pureSales > 0 ? (ps / agg.pureSales) * 100 : 0
                return (
                  <div key={s.store}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 truncate max-w-[55%]">{s.store}</span>
                      <span className="text-gray-400">
                        ¥{ps.toLocaleString()} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </div>
  )
}

function Empty() {
  return <p className="text-gray-500 text-sm text-center py-8">売上分析データがありません。BM同期を実行してください。</p>
}
