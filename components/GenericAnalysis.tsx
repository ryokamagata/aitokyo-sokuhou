'use client'

interface GenericData {
  tables?: { headers: string[]; rows: string[][] }[]
  // Some types may have other shapes
  [key: string]: unknown
}

export default function GenericAnalysis({
  stores,
  label,
}: {
  stores: { store: string; data: GenericData }[]
  label: string
}) {
  if (stores.length === 0) {
    return (
      <p className="text-gray-500 text-sm text-center py-8">
        {label}データがありません。BM同期を実行してください。
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {stores.map((s) => (
        <div key={s.store} className="bg-gray-800 rounded-xl p-4">
          {stores.length > 1 && (
            <h3 className="text-sm font-medium text-gray-300 mb-3">{s.store}</h3>
          )}
          {s.data.tables && s.data.tables.length > 0 ? (
            s.data.tables.map((table, ti) => (
              <div key={ti} className="overflow-x-auto mb-3">
                <table className="w-full text-xs">
                  {table.headers.length > 0 && (
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700">
                        {table.headers.map((h, hi) => (
                          <th key={hi} className="text-left py-1.5 px-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {table.rows.slice(0, 30).map((row, ri) => (
                      <tr key={ri} className="border-b border-gray-700/50">
                        {row.map((cell, ci) => (
                          <td key={ci} className="py-1.5 px-2 text-gray-300">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {table.rows.length > 30 && (
                  <p className="text-gray-600 text-xs text-center mt-2">他 {table.rows.length - 30} 行</p>
                )}
              </div>
            ))
          ) : (
            <pre className="text-gray-400 text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(s.data, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
