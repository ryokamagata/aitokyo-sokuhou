'use client'

interface MenuData {
  menus: {
    name: string
    count: number
    sales: number
    ratio: number
  }[]
}

export default function MenuAnalysis({ stores }: { stores: { store: string; data: MenuData }[] }) {
  if (stores.length === 0) return <Empty />

  // Aggregate menus across stores
  const menuMap = new Map<string, { count: number; sales: number }>()
  for (const s of stores) {
    const menuList = Array.isArray(s.data?.menus) ? s.data.menus : []
    for (const m of menuList) {
      const prev = menuMap.get(m.name) || { count: 0, sales: 0 }
      menuMap.set(m.name, { count: prev.count + m.count, sales: prev.sales + m.sales })
    }
  }

  const sorted = Array.from(menuMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.sales - a.sales)

  const totalSales = sorted.reduce((s, m) => s + m.sales, 0)

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">メニュー別 売上ランキング</h3>
      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {sorted.slice(0, 30).map((m, i) => {
          const pct = totalSales > 0 ? (m.sales / totalSales) * 100 : 0
          return (
            <div key={m.name} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 w-5 text-right shrink-0">{i + 1}</span>
              <span className="text-gray-300 truncate flex-1">{m.name}</span>
              <span className="text-gray-400 shrink-0 w-14 text-right">{m.count}件</span>
              <span className="text-gray-400 shrink-0 w-20 text-right">¥{m.sales.toLocaleString()}</span>
              <span className="text-gray-500 shrink-0 w-12 text-right">{pct.toFixed(1)}%</span>
            </div>
          )
        })}
        {sorted.length > 30 && (
          <p className="text-gray-600 text-xs text-center pt-1">他 {sorted.length - 30} メニュー</p>
        )}
      </div>
      <div className="mt-3 text-xs text-gray-500 text-right">合計: ¥{totalSales.toLocaleString()}</div>
    </div>
  )
}

function Empty() {
  return <p className="text-gray-500 text-sm text-center py-8">メニュー分析データがありません。BM同期を実行してください。</p>
}
