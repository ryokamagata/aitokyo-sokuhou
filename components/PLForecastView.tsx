'use client'

import { useCallback, useEffect, useState } from 'react'

type PLLine = {
  code: string
  name: string
  category: 'revenue' | 'cogs' | 'sga' | 'non_op'
  subcategory: 'revenue' | 'material' | 'personnel' | 'promo' | 'rent' | 'utility' | 'other' | 'income' | 'expense'
  pl_order: number
  amount: number
  source: 'actual' | 'variable' | 'fixed' | 'default' | 'empty'
}

type PLForecast = {
  year: number
  month: number
  stage: 'month_start' | 'mid' | 'post_15' | 'post_17'
  confidence: 'low' | 'medium' | 'high' | 'final'
  revenue: number
  cogs: number
  sga: number
  grossProfit: number
  operatingProfit: number
  opMargin: number
  cogsMaterial: number
  cogsPersonnel: number
  cogsPromo: number
  sgaPersonnel: number
  sgaRent: number
  sgaUtility: number
  sgaPromo: number
  sgaOther: number
  lines: PLLine[]
  coverage: { actual: number; variable: number; fixed: number; default: number; empty: number }
  breakEvenRevenue: number
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
  month_start: '月初', mid: '月中', post_15: '15日以降', post_17: '確定',
}
const CONFIDENCE_LABEL: Record<PLForecast['confidence'], string> = {
  low: '低', medium: '中', high: '高', final: '確定',
}
const SOURCE_BADGE: Record<PLLine['source'], { label: string; cls: string }> = {
  actual:   { label: '実績', cls: 'bg-green-900/60 text-green-300' },
  fixed:    { label: '固定', cls: 'bg-blue-900/60 text-blue-300' },
  variable: { label: '変動', cls: 'bg-purple-900/60 text-purple-300' },
  default:  { label: '既定', cls: 'bg-gray-700 text-gray-400' },
  empty:    { label: '—',   cls: 'bg-gray-800 text-gray-600' },
}

const SUBCAT_LABEL: Record<string, string> = {
  material: '材料・仕入',
  personnel: '人件費',
  promo: '広告宣伝',
  rent: '家賃・リース',
  utility: '水道光熱',
  other: 'その他',
}

export default function PLForecastView() {
  const [data, setData] = useState<PLResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)

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

  const callApi = useCallback(async (url: string, body: object, label: string) => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setMsg(`${label} 失敗: ${j.error ?? res.statusText}`)
      } else {
        const s = j.summary ?? j
        const parts: string[] = []
        if (s.rowsImported !== undefined) parts.push(`${s.rowsImported}行`)
        if (s.monthsDetected?.length) parts.push(`${s.monthsDetected.length}ヶ月`)
        if (j.variableRates?.length !== undefined) parts.push(`変動率${j.variableRates.length}件`)
        if (j.fixedCosts?.length !== undefined) parts.push(`固定費${j.fixedCosts.length}件`)
        setMsg(`${label} 成功: ${parts.join(' / ') || 'OK'}`)
        await refresh()
      }
    } catch (e) {
      setMsg(`通信エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [refresh])

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">読み込み中...</div>
  if (err) return <div className="text-red-400 text-sm py-8 text-center">{err}</div>
  if (!data) return null

  const f = data.forecast
  const kpi = data.kpi

  // subcategory 別に集計
  const subcats: { cat: 'cogs' | 'sga'; subcat: string; lines: PLLine[]; total: number }[] = []
  for (const cat of ['cogs', 'sga'] as const) {
    const subMap = new Map<string, PLLine[]>()
    for (const l of f.lines) {
      if (l.category !== cat) continue
      if (!showEmpty && l.amount === 0) continue
      const key = l.subcategory
      if (!subMap.has(key)) subMap.set(key, [])
      subMap.get(key)!.push(l)
    }
    const order = ['material', 'personnel', 'promo', 'rent', 'utility', 'other']
    for (const sc of order) {
      const ls = subMap.get(sc)
      if (!ls || ls.length === 0) continue
      subcats.push({ cat, subcat: sc, lines: ls.sort((a, b) => a.pl_order - b.pl_order), total: ls.reduce((s, l) => s + l.amount, 0) })
    }
  }

  const breakEven = f.breakEvenRevenue
  const breakEvenGap = f.revenue - breakEven
  const breakEvenGapPct = f.revenue > 0 ? breakEvenGap / f.revenue : 0

  return (
    <div className="space-y-4">
      {/* サマリーカード */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 space-y-3 border border-gray-700/50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium text-gray-300">
            {data.year}年{data.month}月 予測PL
          </h2>
          <div className="flex gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded ${stageStyle(f.stage)}`}>段階: {STAGE_LABEL[f.stage]}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${confidenceStyle(f.confidence)}`}>精度: {CONFIDENCE_LABEL[f.confidence]}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <Card label="売上高" value={formatYenCompact(f.revenue)} />
          <Card label="粗利" value={formatYenCompact(f.grossProfit)} sub={pct(f.revenue > 0 ? f.grossProfit / f.revenue : 0)} />
          <Card label="営業利益" value={formatYenCompact(f.operatingProfit)}
                valueColor={f.operatingProfit >= 0 ? 'text-white' : 'text-red-400'} />
          <Card label="営業利益率" value={pct(f.opMargin)}
                sub={`目標 ${kpi.opMarginTargetPct}%`}
                valueColor={kpi.passed ? 'text-green-400' : 'text-yellow-400'} />
        </div>

        {/* 損益分岐点 */}
        {breakEven > 0 && (
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-gray-400">損益分岐点売上</p>
              <span className={`text-xs font-bold ${breakEvenGap >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatYenCompact(breakEven)} / ギャップ {breakEvenGap >= 0 ? '+' : ''}{formatYenCompact(breakEvenGap)}（{pct(breakEvenGapPct)}）
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full ${breakEvenGap >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                   style={{ width: `${Math.max(5, Math.min(100, (f.revenue / (breakEven || 1)) * 100))}%` }} />
            </div>
          </div>
        )}

        {/* KPI5% */}
        <div className="bg-gray-900/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-400">KPI 営業利益率 vs 目標{kpi.opMarginTargetPct}%</p>
            <span className={`text-xs font-bold ${kpi.passed ? 'text-green-400' : 'text-yellow-400'}`}>
              {kpi.diffPct >= 0 ? '+' : ''}{kpi.diffPct}pt {kpi.passed ? '✓ 達成' : '未達'}
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full transition-all ${kpi.passed ? 'bg-green-500' : 'bg-yellow-500'}`}
                 style={{ width: `${Math.max(0, Math.min(100, (kpi.opMarginPct / 10) * 100))}%` }} />
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            データソース: 実績{f.coverage.actual} / 固定{f.coverage.fixed} / 変動率{f.coverage.variable} / 既定値{f.coverage.default} / 未入力{f.coverage.empty}
          </p>
        </div>
      </div>

      {/* 取込/シード */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">確定PL データ操作</h2>
        <p className="text-[11px] text-gray-500">
          ★月次決算速報値シート (2025年9月期) からの取込、実績からの変動率/固定費シード、fixture取込の3系統。
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => callApi('/api/import-pl-spreadsheet', { fiscalStartYear: 2025, confirmedThrough: '2026-02' }, 'シート取込')}
                  disabled={busy} className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-md">
            シートから取込
          </button>
          <button onClick={() => callApi('/api/seed-pl-from-text', { useFixture: true, fiscalStartYear: 2025, confirmedThrough: '2026-02' }, 'fixture取込')}
                  disabled={busy} className="text-xs px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 text-white rounded-md">
            fixtureから取込 (オフライン)
          </button>
          <button onClick={() => callApi('/api/seed-pl-params', { fromYear: 2025, fromMonth: 9, toYear: 2026, toMonth: 2 }, '実績から自動算出')}
                  disabled={busy} className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-md">
            実績から変動率/固定費を自動算出
          </button>
          <a href={`https://docs.google.com/spreadsheets/d/12Jo2w0pjKi_cUongNdmtzFS0sHbuZDAhWnBSAKxgxBo/edit`}
             target="_blank" rel="noreferrer"
             className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md">
            シートを開く
          </a>
        </div>
        {msg && <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{msg}</p>}
      </div>

      {/* 科目別 PL テーブル (subcategory 階層) */}
      <div className="bg-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-300">科目別内訳</h2>
          <label className="text-[11px] text-gray-500 flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} className="accent-blue-500" />
            0円行も表示
          </label>
        </div>

        {/* 売上高 */}
        <div className="mb-4">
          <div className="flex items-center justify-between pb-1 border-b border-gray-700">
            <p className="text-sm font-bold text-gray-200">売上高</p>
            <p className="text-sm font-bold text-white">{formatYen(f.revenue)}</p>
          </div>
        </div>

        {/* 売上原価 */}
        <div className="mb-4">
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-gray-700">
            <p className="text-sm font-bold text-gray-200">売上原価</p>
            <p className="text-sm font-bold text-white">{formatYen(f.cogs)}</p>
          </div>
          {subcats.filter(s => s.cat === 'cogs').map(g => (
            <SubcatBlock key={g.subcat} label={SUBCAT_LABEL[g.subcat] ?? g.subcat} lines={g.lines} total={g.total} />
          ))}
        </div>

        {/* 粗利 */}
        <div className="flex items-center justify-between pb-1 mb-4 border-y border-gray-600 py-1">
          <p className="text-sm font-bold text-gray-300">売上総利益（粗利）</p>
          <p className={`text-sm font-bold ${f.grossProfit >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {formatYen(f.grossProfit)} ({pct(f.revenue > 0 ? f.grossProfit / f.revenue : 0)})
          </p>
        </div>

        {/* 販管費 */}
        <div className="mb-4">
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-gray-700">
            <p className="text-sm font-bold text-gray-200">販売費及び一般管理費</p>
            <p className="text-sm font-bold text-white">{formatYen(f.sga)}</p>
          </div>
          {subcats.filter(s => s.cat === 'sga').map(g => (
            <SubcatBlock key={g.subcat} label={SUBCAT_LABEL[g.subcat] ?? g.subcat} lines={g.lines} total={g.total} />
          ))}
        </div>

        {/* 営業利益 */}
        <div className="flex items-center justify-between py-2 border-y-2 border-gray-500 bg-gray-900/30 px-2 rounded">
          <p className="text-sm font-bold text-gray-200">営業利益</p>
          <p className={`text-base font-bold ${f.operatingProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatYen(f.operatingProfit)} ({pct(f.opMargin)})
          </p>
        </div>
      </div>

      {/* 直近月別PL推移 */}
      {data.trend.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-gray-300 mb-3">直近 月別PL推移</h2>
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
                    <td className={`py-2 text-right font-bold ${
                      t.opMargin >= 0.05 ? 'text-green-400' :
                      t.opMargin >= 0 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {pct(t.opMargin)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600 mt-2">
            目標 {kpi.opMarginTargetPct}% 達成=緑 / プラス=黄 / 赤字=赤
          </p>
        </div>
      )}
    </div>
  )
}

function SubcatBlock({ label, lines, total }: { label: string; lines: PLLine[]; total: number }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between px-1 py-0.5">
        <p className="text-[11px] font-medium text-gray-400">├ {label}</p>
        <p className="text-[11px] font-medium text-gray-300">{formatYen(total)}</p>
      </div>
      <div className="pl-4 space-y-0.5">
        {lines.map(l => (
          <div key={l.code} className="flex items-center justify-between text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{l.name}</span>
              <span className={`text-[9px] px-1 py-0.5 rounded ${SOURCE_BADGE[l.source].cls}`}>
                {SOURCE_BADGE[l.source].label}
              </span>
            </div>
            <span className="text-gray-400 text-right flex-shrink-0 ml-2">{formatYen(l.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Card({ label, value, sub, valueColor = 'text-white' }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-2.5 sm:p-3">
      <p className="text-[10px] sm:text-xs text-gray-400 mb-0.5 truncate">{label}</p>
      <p className={`text-sm sm:text-lg font-bold ${valueColor} truncate`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function stageStyle(s: PLForecast['stage']) {
  if (s === 'post_17') return 'bg-gray-700 text-gray-300'
  if (s === 'post_15') return 'bg-green-900/50 text-green-400'
  if (s === 'mid') return 'bg-yellow-900/50 text-yellow-400'
  return 'bg-gray-700 text-gray-400'
}

function confidenceStyle(c: PLForecast['confidence']) {
  if (c === 'final') return 'bg-gray-700 text-gray-300'
  if (c === 'high') return 'bg-green-900/50 text-green-400'
  if (c === 'medium') return 'bg-yellow-900/50 text-yellow-400'
  return 'bg-gray-700 text-gray-500'
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
