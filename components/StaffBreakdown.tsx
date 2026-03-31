'use client'

import { useState } from 'react'

export default function StaffBreakdown({
  data,
  total,
}: {
  data: { staff: string; sales: number }[]
  total: number
}) {
  const [showAll, setShowAll] = useState(false)

  if (data.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-4">データがありません</p>
  }

  const display = showAll ? data : data.slice(0, 20)

  return (
    <div>
      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {display.map(({ staff, sales }, i) => {
          const pct = total > 0 ? (sales / total) * 100 : 0
          return (
            <div key={staff} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 w-5 text-right shrink-0">{i + 1}</span>
              <span className="text-gray-300 truncate flex-1">{staff}</span>
              <span className="text-gray-400 shrink-0">
                ¥{sales.toLocaleString()}
              </span>
              <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {!showAll && data.length > 20 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-blue-400 text-xs text-center w-full pt-2 hover:text-blue-300"
        >
          全{data.length}名を表示
        </button>
      )}
      {showAll && data.length > 20 && (
        <button
          onClick={() => setShowAll(false)}
          className="text-gray-500 text-xs text-center w-full pt-2 hover:text-gray-400"
        >
          折りたたむ
        </button>
      )}
    </div>
  )
}
