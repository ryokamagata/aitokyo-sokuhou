'use client'

const COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-yellow-500',
  'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
  'bg-red-500', 'bg-cyan-500',
]

interface ReserveData {
  total: number
  channels: { name: string; count: number; ratio: number }[]
  daily: { date: string; channels: Record<string, number> }[]
}

export default function ReserveAnalysis({ stores }: { stores: { store: string; data: ReserveData }[] }) {
  if (stores.length === 0) return <Empty />

  // Aggregate across stores (defensive: channels may be missing/empty)
  const channelTotals: Record<string, number> = {}
  let grandTotal = 0
  for (const s of stores) {
    const chs = Array.isArray(s.data?.channels) ? s.data.channels : []
    for (const ch of chs) {
      channelTotals[ch.name] = (channelTotals[ch.name] || 0) + ch.count
      grandTotal += ch.count
    }
  }

  const sorted = Object.entries(channelTotals).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">予約経路 構成比</h3>
        <div className="space-y-2.5">
          {sorted.map(([name, count], i) => {
            const pct = grandTotal > 0 ? (count / grandTotal) * 100 : 0
            return (
              <div key={name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-300">{name}</span>
                  <span className="text-gray-400">{count}件 ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${COLORS[i % COLORS.length]} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 text-xs text-gray-500 text-right">合計: {grandTotal}件</div>
      </div>

      {/* Store breakdown */}
      {stores.length > 1 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">店舗別 予約件数</h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {stores.map((s) => {
              const chs = Array.isArray(s.data?.channels) ? s.data.channels : []
              const total = chs.reduce((sum: number, ch: { count: number }) => sum + ch.count, 0)
              return (
                <div key={s.store} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-300 truncate flex-1">{s.store}</span>
                  <span className="text-gray-400 shrink-0">{total}件</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Empty() {
  return <p className="text-gray-500 text-sm text-center py-8">予約分析データがありません。BM同期を実行してください。</p>
}
