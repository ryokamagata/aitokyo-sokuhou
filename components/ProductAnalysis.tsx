'use client'

interface ProductData {
  products: {
    name: string
    count: number
    sales: number
    ratio: number
  }[]
}

export default function ProductAnalysis({ stores }: { stores: { store: string; data: ProductData }[] }) {
  if (stores.length === 0) return <Empty />

  // Aggregate products across stores
  const productMap = new Map<string, { count: number; sales: number }>()
  for (const s of stores) {
    const prodList = Array.isArray(s.data?.products) ? s.data.products : []
    for (const p of prodList) {
      const prev = productMap.get(p.name) || { count: 0, sales: 0 }
      productMap.set(p.name, { count: prev.count + p.count, sales: prev.sales + p.sales })
    }
  }

  const sorted = Array.from(productMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.sales - a.sales)

  const totalSales = sorted.reduce((s, p) => s + p.sales, 0)

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">店販 売上ランキング</h3>
      {sorted.length === 0 ? (
        <p className="text-gray-500 text-xs text-center py-4">店販データなし</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {sorted.slice(0, 20).map((p, i) => {
            const pct = totalSales > 0 ? (p.sales / totalSales) * 100 : 0
            return (
              <div key={p.name} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-5 text-right shrink-0">{i + 1}</span>
                <span className="text-gray-300 truncate flex-1">{p.name}</span>
                <span className="text-gray-400 shrink-0 w-12 text-right">{p.count}個</span>
                <span className="text-gray-400 shrink-0 w-20 text-right">¥{p.sales.toLocaleString()}</span>
                <span className="text-gray-500 shrink-0 w-12 text-right">{pct.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-3 text-xs text-gray-500 text-right">合計: ¥{totalSales.toLocaleString()}</div>
    </div>
  )
}

function Empty() {
  return <p className="text-gray-500 text-sm text-center py-8">店販分析データがありません。BM同期を実行してください。</p>
}
