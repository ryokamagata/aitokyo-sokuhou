'use client'

import { useCallback, useEffect, useState } from 'react'

type PLLine = {
  code: string
  name: string
  category: string
  pl_order: number
  amount: number
  source: 'actual' | 'variable' | 'fixed' | 'default'
}

type PLForecast = {
  year: number
  month: number
  stage: 'month_start' | 'mid' | 'post_15' | 'post_17'
  confidence: 'low' | 'medium' | 'high' | 'final'
  revenue: number
  cogs: number
  grossProfit: number
  personnel: number
  rent: number
  promo: number
  utility: number
  otherSga: number
  operatingProfit: number
  opMargin: number
  lines: PLLine[]
  coverage: { actual: number; variable: number; fixed: number; default: number }
}

type PLResponse = {
  year: number
  month: number
  todayIsoDate: string
  forecast: PLForecast
  trend: { ym: string; revenue: number; opProfit: number; opMargin: number }[]
  kpi: { opMarginTargetPct: number; opMarginPct: number; diffPct: number; passed: boolean }
  monthlyTarget: number | null
}

const STAGE_LABEL: Record<PLForecast['stage'], string> = {
  month_start: '月初',
  mid: '月中',
  post_15: '15日以降',
  post_17: '確定',
}

const CONFIDENCE_LABEL: Record<PLForecast['confidence'], string> = {
  low: '低',
  medium: '中',
  high: '高',
  final: '確定',
}

const SOURCE_BADGE: Record<PLLine['source'], { label: string; cls: string }> = {
  actual: { label: '実績', cls: 'bg-green-900/60 text-green-300' },
  fixed: { label: '固定', cls: 'bg-blue-900/60 text-blue-300' },
  variable: { label: '変動', cls: 'bg-purple-900/60 text-purple-300' },
  default: { label: '既定値', cls: 'bg-gray-700 text-gray-400' },
}

const CATEGORY_ORDER = ['revenue', 'cogs', 'personnel', 'rent', 'utility', 'promo', 'other_sga'] as const
const CATEGORY_LABEL: Record<string, string> = {
  revenue: '売上高',
  cogs: '原価',
  personnel: '人件費',
  rent: '家賃',
  utility: '水道光熱費',
  promo: '販促・広告',
  other_sga: 'その他販管費',
}

export default function PLForecastView() {
  const [data, setData] = useState<PLResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pl-forecast', { cache: 'no-store' })
      if (!res.ok) throw new Error('予測PL取得に失敗しました')
      setData(await res.json())
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const importActuals = useCallback(async () => {
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/import-pl-spreadsheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedThrough: '2026-02' }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setImportMsg(`取込失敗: ${j.error ?? res.statusText}`)
      } else {
        setImportMsg(`取込成功: ${j.summary.rowsImported}件 / ${j.summary.monthsDetected.length}月分`)
        await refresh()
      }
    } catch (e) {
      setImportMsg(`通信エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }, [refresh])

  const seedParams = useCallback(async () => {
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/seed-pl-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromYear: 2025, fromMonth: 9, toYear: 2026, toMonth: 2 }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setImportMsg(`シード失敗: ${j.error ?? res.statusText}`)
      } else {
        setImportMsg(`シード成功: 変動率${j.variableRates.length}件 / 固定費${j.fixedCosts.length}件`)
        await refresh()
      }
    } catch (e) {
      setImportMsg(`通信エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }, [refresh])

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">読み込み中...</div>
  if (err) return <div className="text-red-400 text-sm py-8 text-center">{err}</div>
  if (!data) return null

  const f = data.forecast
  const kpi = data.kpi

  const linesByCategory = new Map<string, PLLine[]>()
  for (const l of f.lines) {
    if (!linesByCategory.has(l.category)) linesByCategory.set(l.category, [])
    linesByCategory.get(l.category)!.push(l)
  }

  return (
    <div className="space-y-4">
      {/* サマリーカード */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 space-y-3 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">
            {data.year}年{data.month}月 予測PL
          </h2>
          <div className="flex gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded ${
              f.stage === 'post_17' ? 'bg-gray-700 text-gray-300' :
              f.stage === 'post_15' ? 'bg-green-900/50 text-green-400' :
              f.stage === 'mid' ? 'bg-yellow-900/50 text-yellow-400' :
              'bg-gray-700 text-gray-400'
            }`}>
              段階: {STAGE_LABEL[f.stage]}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${
              f.confidence === 'final' ? 'bg-gray-700 text-gray-300' :
              f.confidence === 'high' ? 'bg-green-900/50 text-green-400' :
              f.confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-400' :
              'bg-gray-700 text-gray-500'
            }`}>
              精度: {CONFIDENCE_LABEL[f.confidence]}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <PLKpiCard label="売上高" value={formatYenCompact(f.revenue)} />
          <PLKpiCard label="粗利" value={formatYenCompact(f.grossProfit)} sub={`${pct(f.revenue > 0 ? f.grossProfit / f.revenue : 0)}`} />
          <PLKpiCard
            label="営業利益"
            value={formatYenCompact(f.operatingProfit)}
            valueColor={f.operatingProfit >= 0 ? 'text-white' : 'text-red-400'}
          />
          <PLKpiCard
            label="営業利益率"
            value={`${pct(f.opMargin)}`}
            sub={`目標 ${kpi.opMarginTargetPct}%`}
            valueColor={kpi.passed ? 'text-green-400' : 'text-yellow-400'}
          />
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-400">KPI 営業利益率 vs 目標5%</p>
            <span className={`text-xs font-bold ${kpi.passed ? 'text-green-400' : 'text-yellow-400'}`}>
              {kpi.diffPct >= 0 ? '+' : ''}{kpi.diffPct}pt {kpi.passed ? '✓ 達成' : '未達'}
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${kpi.passed ? 'bg-green-500' : 'bg-yellow-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, (kpi.opMarginPct / 10) * 100))}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            データソース内訳: 実績 {f.coverage.actual} / 固定 {f.coverage.fixed} / 変動率 {f.coverage.variable} / 既定値 {f.coverage.default}
          </p>
        </div>
      </div>

      {/* 取込/シード操作 */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">確定PLスプレッドシート</h2>
        <p className="text-[11px] text-gray-500">
          取込対象: 売上速報PL (2025年9月〜2026年3月)。シートを「リンクを知っている全員 閲覧者」で共有してください。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={importActuals}
            disabled={importing}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-md"
          >
            {importing ? '処理中...' : '確定PLを取込'}
          </button>
          <button
            onClick={seedParams}
            disabled={importing}
            className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-md"
          >
            実績から変動率/固定費を自動算出
          </button>
          <a
            href={`https://docs.google.com/spreadsheets/d/12Jo2w0pjKi_cUongNdmtzFS0sHbuZDAhWnBSAKxgxBo/edit`}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md"
          >
            シートを開く
          </a>
        </div>
        {importMsg && (
          <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{importMsg}</p>
        )}
      </div>

      {/* 科目別 PL テーブル */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3">科目別内訳</h2>
        <div className="space-y-4">
          {CATEGORY_ORDER.map(cat => {
            const lines = linesByCategory.get(cat) ?? []
            if (lines.length === 0) return null
            const subtotal = lines.reduce((s, l) => s + l.amount, 0)
            return (
              <div key={cat}>
                <div className="flex items-center justify-between mb-1 pb-1 border-b border-gray-700">
                  <p className="text-xs font-bold text-gray-300">{CATEGORY_LABEL[cat]}</p>
                  <p className="text-xs font-bold text-white">{formatYen(subtotal)}</p>
                </div>
                <div className="space-y-0.5">
                  {lines.sort((a, b) => a.pl_order - b.pl_order).map(l => (
                    <div key={l.code} className="flex items-center justify-between text-[11px] text-gray-400">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{l.name}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded ${SOURCE_BADGE[l.source].cls}`}>
                          {SOURCE_BADGE[l.source].label}
                        </span>
                      </div>
                      <span className="text-gray-300 text-right flex-shrink-0 ml-2">{formatYen(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* 集計行 */}
          <div className="pt-3 border-t border-gray-600 space-y-1">
            <SummaryRow label="粗利" value={f.grossProfit} />
            <SummaryRow label="販管費合計"
              value={f.personnel + f.rent + f.utility + f.promo + f.otherSga} />
            <SummaryRow
              label="営業利益"
              value={f.operatingProfit}
              highlight={f.operatingProfit >= 0 ? 'text-green-400' : 'text-red-400'}
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>営業利益率</span>
              <span className={`font-bold ${kpi.passed ? 'text-green-400' : 'text-yellow-400'}`}>
                {pct(f.opMargin)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 過去6ヶ月推移 */}
      {data.trend.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-gray-300 mb-3">直近6ヶ月 PL推移</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 pr-2">年月</th>
                  <th className="text-right py-2 pr-2">売上</th>
                  <th className="text-right py-2 pr-2">営業利益</th>
                  <th className="text-right py-2">利益率</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map(t => (
                  <tr key={t.ym} className="border-b border-gray-700/50">
                    <td className="py-2 pr-2 text-gray-300">{t.ym}</td>
                    <td className="py-2 pr-2 text-right text-gray-300">{formatYenCompact(t.revenue)}</td>
                    <td className={`py-2 pr-2 text-right ${t.opProfit >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
                      {formatYenCompact(t.opProfit)}
                    </td>
                    <td className={`py-2 text-right font-bold ${t.opMargin >= 0.05 ? 'text-green-400' : 'text-yellow-400'}`}>
                      {pct(t.opMargin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PLKpiCard({ label, value, sub, valueColor = 'text-white' }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-2.5 sm:p-3">
      <p className="text-[10px] sm:text-xs text-gray-400 mb-0.5 truncate">{label}</p>
      <p className={`text-sm sm:text-lg font-bold ${valueColor} truncate`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function SummaryRow({ label, value, highlight }: { label: string; value: number; highlight?: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`font-bold ${highlight ?? 'text-white'}`}>{formatYen(value)}</span>
    </div>
  )
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString()}`
}

function formatYenCompact(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 100_000_000) {
    const oku = Math.floor(abs / 100_000_000)
    const man = Math.floor((abs % 100_000_000) / 10_000)
    return `${sign}¥${oku}億${man > 0 ? man.toLocaleString() + '万' : ''}`
  }
  if (abs >= 10_000) {
    return `${sign}¥${Math.round(abs / 10_000).toLocaleString()}万`
  }
  return `${sign}¥${abs.toLocaleString()}`
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
