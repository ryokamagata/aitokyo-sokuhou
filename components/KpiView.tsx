'use client'

import { useCallback, useEffect, useState } from 'react'

type KpiResult = {
  key: string; label: string; unit: string; source: 'auto' | 'manual'
  target: number | null; currentValue: number | null; score: number | null; maxScore: number
  monthlyValues: Record<number, number>
  monthlyTargets: { month: number; value: number | null }[]
}

type ExecData = {
  id: string; name: string; role: string; description: string
  kpis: KpiResult[]; totalScore: number; maxScore: number; rank: string; reward: string
}

type KpiData = {
  year: number; currentQuarter: number; currentMonth: number; quarterLabel: string
  executives: ExecData[]
}

const RANK_COLORS: Record<string, string> = {
  S: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  A: 'text-green-400 bg-green-400/10 border-green-400/30',
  B: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  C: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  D: 'text-red-400 bg-red-400/10 border-red-400/30',
}

export default function KpiView() {
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedExec, setSelectedExec] = useState<string | null>(null)
  const [editingKpi, setEditingKpi] = useState<{ key: string; month: number } | null>(null)
  const [editValue, setEditValue] = useState('')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/kpi')
    const d = await res.json()
    setData(d)
    setLoading(false)
    if (!selectedExec && d.executives.length > 0) setSelectedExec(d.executives[0].id)
  }, [selectedExec])

  useEffect(() => { fetchData() }, [fetchData])

  const saveKpi = async (key: string, month: number, value: number) => {
    if (!data) return
    await fetch('/api/kpi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: data.year, month, key, value }),
    })
    setEditingKpi(null)
    fetchData()
  }

  if (loading) return <div className="text-gray-400 text-sm text-center py-8">KPIデータ読み込み中...</div>
  if (!data) return <div className="text-red-400 text-sm text-center py-8">データ取得に失敗しました</div>

  const exec = data.executives.find(e => e.id === selectedExec)

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-gray-300">責任者別KPI評価</h3>
            <p className="text-[10px] text-gray-500">{data.year}年 {data.quarterLabel}</p>
          </div>
        </div>

        {/* 責任者カード一覧 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {data.executives.map(e => (
            <button
              key={e.id}
              onClick={() => setSelectedExec(e.id)}
              className={`p-3 rounded-lg border transition-colors text-left ${
                selectedExec === e.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-700 bg-gray-700/30 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">{e.name}</span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${RANK_COLORS[e.rank] ?? 'text-gray-400'}`}>
                  {e.rank}
                </span>
              </div>
              <div className="text-[10px] text-gray-500">{e.role}</div>
              <div className="text-xs font-bold text-cyan-400 mt-1">{e.totalScore}/{e.maxScore}点</div>
            </button>
          ))}
        </div>
      </div>

      {/* 選択した責任者の詳細 */}
      {exec && (
        <>
          {/* プロフィール・総合スコア */}
          <div className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">{exec.name} {exec.role}</h3>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded border ${RANK_COLORS[exec.rank]}`}>
                    {exec.rank}評価
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{exec.description}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-cyan-400">{exec.totalScore}<span className="text-sm text-gray-500">/{exec.maxScore}</span></div>
                <div className="text-xs text-gray-500">{exec.reward}</div>
              </div>
            </div>

            {/* スコアバー */}
            <div className="mt-3 h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  exec.totalScore >= 81 ? 'bg-yellow-500' :
                  exec.totalScore >= 71 ? 'bg-green-500' :
                  exec.totalScore >= 61 ? 'bg-blue-500' :
                  exec.totalScore >= 51 ? 'bg-gray-500' : 'bg-red-500'
                }`}
                style={{ width: `${(exec.totalScore / exec.maxScore) * 100}%` }}
              />
            </div>
          </div>

          {/* KPI詳細カード */}
          {exec.kpis.map(kpi => (
            <div key={kpi.key} className="bg-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-medium text-gray-300">{kpi.label}</h4>
                  <p className="text-[10px] text-gray-500">
                    {kpi.source === 'auto' ? 'BMデータから自動取得' : '手動入力'}
                    {kpi.target !== null && ` / Q目標: ${kpi.target.toLocaleString()}${kpi.unit}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">
                      {kpi.currentValue !== null ? `${kpi.currentValue.toLocaleString()}${kpi.unit}` : '—'}
                    </div>
                    <div className="text-[10px] text-gray-500">現在値</div>
                  </div>
                  <div className={`text-center min-w-[48px] py-1 px-2 rounded-lg ${
                    kpi.score !== null && kpi.score >= 25 ? 'bg-green-500/20 text-green-400' :
                    kpi.score !== null && kpi.score >= 15 ? 'bg-yellow-500/20 text-yellow-400' :
                    kpi.score !== null ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-700 text-gray-500'
                  }`}>
                    <div className="text-sm font-bold">{kpi.score ?? '—'}</div>
                    <div className="text-[9px]">/{kpi.maxScore}</div>
                  </div>
                </div>
              </div>

              {/* 月別データ */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700">
                      <th className="text-left py-1.5 px-1">月</th>
                      <th className="text-right py-1.5 px-1">実績</th>
                      {kpi.source === 'manual' && <th className="text-right py-1.5 px-1"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {kpi.monthlyTargets.map(mt => (
                      <tr key={mt.month} className="border-b border-gray-700/30">
                        <td className="py-1.5 px-1 text-gray-400">{mt.month}月</td>
                        <td className="py-1.5 px-1 text-right">
                          {editingKpi?.key === kpi.key && editingKpi?.month === mt.month ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                const v = parseFloat(editValue)
                                if (!isNaN(v)) saveKpi(kpi.key, mt.month, v)
                              }}
                              className="flex items-center gap-1 justify-end"
                            >
                              <input
                                type="number"
                                step="any"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                className="w-20 bg-gray-700 text-white text-xs px-2 py-1 rounded"
                                autoFocus
                              />
                              <button type="submit" className="text-green-400 text-[10px] px-1">保存</button>
                              <button type="button" onClick={() => setEditingKpi(null)} className="text-gray-500 text-[10px] px-1">取消</button>
                            </form>
                          ) : (
                            <span className={mt.value !== null ? 'text-white font-medium' : 'text-gray-600'}>
                              {mt.value !== null ? `${mt.value.toLocaleString()}${kpi.unit}` : '—'}
                            </span>
                          )}
                        </td>
                        {kpi.source === 'manual' && (
                          <td className="py-1.5 px-1 text-right">
                            {!(editingKpi?.key === kpi.key && editingKpi?.month === mt.month) && (
                              <button
                                onClick={() => {
                                  setEditingKpi({ key: kpi.key, month: mt.month })
                                  setEditValue(mt.value?.toString() ?? '')
                                }}
                                className="text-[10px] text-blue-400 hover:text-blue-300"
                              >
                                編集
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* 評価ランク表 */}
          <div className="bg-gray-800 rounded-xl p-4">
            <h4 className="text-xs font-medium text-gray-400 mb-2">評価ランク・報酬変動</h4>
            <div className="grid grid-cols-5 gap-1 text-center text-xs">
              {[
                { min: 81, max: 90, rank: 'S', reward: '+15万', color: 'bg-yellow-500/20 text-yellow-400' },
                { min: 71, max: 80, rank: 'A', reward: '+10万', color: 'bg-green-500/20 text-green-400' },
                { min: 61, max: 70, rank: 'B', reward: '+5万', color: 'bg-blue-500/20 text-blue-400' },
                { min: 51, max: 60, rank: 'C', reward: '±0', color: 'bg-gray-500/20 text-gray-400' },
                { min: 0, max: 50, rank: 'D', reward: '-5万', color: 'bg-red-500/20 text-red-400' },
              ].map(r => (
                <div
                  key={r.rank}
                  className={`py-2 rounded-lg ${r.color} ${exec.rank === r.rank ? 'ring-2 ring-white/30' : ''}`}
                >
                  <div className="font-bold text-sm">{r.rank}</div>
                  <div className="text-[9px] opacity-70">{r.min}-{r.max}点</div>
                  <div className="text-[9px] font-medium mt-0.5">{r.reward}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
