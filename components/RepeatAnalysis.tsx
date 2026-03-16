'use client'

interface RepeatData {
  baseMonth: string
  categories: {
    type: string
    count: number
    ratio: number
    months: { month: number; rate: number }[]
  }[]
}

const TYPE_COLORS: Record<string, string> = {
  '新規': 'text-green-400',
  '再来': 'text-blue-400',
  '固定': 'text-purple-400',
  'リターン': 'text-yellow-400',
}

export default function RepeatAnalysis({ stores }: { stores: { store: string; data: RepeatData }[] }) {
  if (stores.length === 0) return <Empty />

  // For repeat analysis, show per-store tables since cohort data doesn't aggregate well
  return (
    <div className="space-y-4">
      {stores.map((s) => (
        <div key={s.store} className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {stores.length > 1 ? s.store : 'リピート分析'}
            {s.data.baseMonth && (
              <span className="text-gray-500 text-xs ml-2">({s.data.baseMonth})</span>
            )}
          </h3>
          {(!Array.isArray(s.data?.categories) || s.data.categories.length === 0) ? (
            <p className="text-gray-500 text-xs">データなし</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-1.5 pr-3">区分</th>
                    <th className="text-right py-1.5 px-2">人数</th>
                    <th className="text-right py-1.5 px-2">構成比</th>
                    {s.data.categories[0]?.months.map((m) => (
                      <th key={m.month} className="text-right py-1.5 px-2">{m.month}ヶ月後</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.data.categories.map((cat) => (
                    <tr key={cat.type} className="border-b border-gray-700/50">
                      <td className={`py-1.5 pr-3 font-medium ${TYPE_COLORS[cat.type] ?? 'text-gray-300'}`}>
                        {cat.type}
                      </td>
                      <td className="text-right py-1.5 px-2 text-gray-300">{cat.count}</td>
                      <td className="text-right py-1.5 px-2 text-gray-400">{cat.ratio}%</td>
                      {cat.months.map((m) => (
                        <td key={m.month} className="text-right py-1.5 px-2">
                          <span className={m.rate >= 50 ? 'text-green-400' : m.rate >= 30 ? 'text-yellow-400' : 'text-gray-400'}>
                            {m.rate}%
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Empty() {
  return <p className="text-gray-500 text-sm text-center py-8">リピート分析データがありません。BM同期を実行してください。</p>
}
