'use client'

import { useCallback, useEffect, useState } from 'react'
import ScrapeButton from '@/components/ScrapeButton'

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

type DataSource = {
  lastScrapeAt: string | null
  scrapedDaysOfMonth: number | null
  plImport: {
    rowCount: number
    hasRevenue: boolean
    costAccountCount: number
    lastImportedAt: string | null
    source: string | null
  }
  revenueSource: 'pl_actual' | 'sales_forecast'
  overrides: { fixedCostCount: number; variableRateCount: number }
}

type PLResponse = {
  year: number
  month: number
  todayIsoDate: string
  forecast: PLForecast
  trend: { ym: string; revenue: number; opProfit: number; opMargin: number }[]
  kpi: { opMarginTargetPct: number; opMarginPct: number; diffPct: number; passed: boolean }
  monthlyTarget: number | null
  dataSource: DataSource
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

  // ── 動的な日付パラメータ（ハードコード排除） ──────────────────────
  // confirmedThrough: 「先月」までを確定扱い（今が4月なら 2026-03 まで確定）
  // paramRange: 直近6ヶ月（先月を末尾とする）を変動率/固定費の自動算出に使う
  // fiscalStartYear: 9月決算（AI TOKYOは9月期）を前提にした会計年度開始年
  const tokyoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const curY = tokyoNow.getFullYear()
  const curM = tokyoNow.getMonth() + 1
  const prev = (() => {
    const d = new Date(curY, curM - 2, 1) // curM-2 because Date months are 0-indexed
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const sixAgo = (() => {
    const d = new Date(prev.year, prev.month - 6, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const fiscalStartYear = curM >= 9 ? curY : curY - 1
  const confirmedThrough = `${prev.year}-${String(prev.month).padStart(2, '0')}`
  const paramRangeLabel = `${sixAgo.year}年${sixAgo.month}月〜${prev.year}年${prev.month}月`

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
      <div className="bg-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium text-gray-300">確定PL データ操作</h2>
          <a href={`https://docs.google.com/spreadsheets/d/12Jo2w0pjKi_cUongNdmtzFS0sHbuZDAhWnBSAKxgxBo/edit`}
             target="_blank" rel="noreferrer"
             className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md">
            元シートを開く ↗
          </a>
        </div>
        <p className="text-[11px] text-gray-500">
          通常運用フロー: <span className="text-gray-300 font-medium">⓪ 当月売上を取込 → ① 過去月実績を取込 → ③ 自動算出</span>。<br/>
          ⓪は「<span className="text-gray-300">{curY}年{curM}月</span>の売上速報」を、①は「<span className="text-gray-300">〜{prev.year}年{prev.month}月の確定値</span>」を取り込みます。
        </p>

        <div className="space-y-2">
          {/* ⓪ 当月の売上速報スクレイプ */}
          <div className="border border-emerald-700/40 bg-emerald-900/10 rounded-lg p-3 space-y-1.5">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div className="flex-1 min-w-0">
                <ScrapeButton
                  url="/api/scrape"
                  label={`⓪ 現在のダッシュボードから取り込み（${curY}年${curM}月の売上速報）`}
                  onDone={refresh}
                />
              </div>
              <span className="text-[10px] text-emerald-300/80 px-2 py-0.5 bg-emerald-900/40 rounded shrink-0">当月の売上予測に必須</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-gray-300">▶ 押すと:</span> ビューティメリットから当月({curY}年{curM}月)の日別売上を最新化し、<span className="text-gray-300">予測PLの売上高 = 売上速報の着地予測</span> として反映します。
            </p>
            <p className="text-[11px] text-gray-500">
              <span className="text-gray-400">▶ 効果:</span> 当月の売上高・粗利・営業利益が、ダッシュボードの売上予測と同じ最新の数字になります（① はGoogleシート未掲載の当月分には影響しません）。
            </p>
          </div>

          {/* ① 過去月の確定PL */}
          <div className="border border-gray-700 rounded-lg p-3 space-y-1.5">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <button onClick={() => callApi('/api/import-pl-spreadsheet', { fiscalStartYear, confirmedThrough }, `Googleシート取込（〜${prev.year}年${prev.month}月確定）`)}
                      disabled={busy} className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-md font-medium">
                ① Googleシートから過去月の実績PLを取込
              </button>
              <span className="text-[10px] text-blue-300/70 px-2 py-0.5 bg-blue-900/30 rounded">経理の月次更新後に実行</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-gray-300">▶ 押すと:</span> 月次決算速報値シートを読み込み、<span className="text-gray-300">過去月</span>の科目×店舗×月の金額を実績データとして DB 保存します（<span className="text-gray-300">〜{prev.year}年{prev.month}月</span>を「確定」、それ以降を「速報」扱い）。
            </p>
            <p className="text-[11px] text-gray-500">
              <span className="text-gray-400">▶ 効果:</span> 過去月の予測PLが実績値で上書きされ、「実績」バッジ付きで表示されるようになります。<span className="text-gray-400">当月({curY}年{curM}月)の売上には影響しません — そちらは⓪を使ってください。</span>
            </p>
          </div>

          {/* ② */}
          <div className="border border-gray-700 rounded-lg p-3 space-y-1.5 opacity-80">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <button onClick={() => callApi('/api/seed-pl-from-text', { useFixture: true, fiscalStartYear, confirmedThrough }, '同梱サンプル取込')}
                      disabled={busy} className="text-xs px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-700 text-white rounded-md font-medium">
                ② 同梱サンプルから取込
              </button>
              <span className="text-[10px] text-gray-400 px-2 py-0.5 bg-gray-700 rounded">通常使用しません</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-gray-300">▶ 押すと:</span> リポジトリ内の同梱サンプル(<code className="text-gray-300">seed-pl-fy25.tsv</code>)を①と同じテーブルに投入します。
            </p>
            <p className="text-[11px] text-gray-500">
              <span className="text-gray-400">▶ 用途:</span> シートにアクセスできない開発・検証時専用。本番運用では押さなくて OK。
            </p>
          </div>

          {/* ③ */}
          <div className="border border-gray-700 rounded-lg p-3 space-y-1.5">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <button onClick={() => callApi('/api/seed-pl-params', { fromYear: sixAgo.year, fromMonth: sixAgo.month, toYear: prev.year, toMonth: prev.month }, `変動率/固定費 自動算出（${paramRangeLabel}）`)}
                      disabled={busy} className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white rounded-md font-medium">
                ③ 実績から変動率/固定費を自動算出
              </button>
              <span className="text-[10px] text-purple-300/70 px-2 py-0.5 bg-purple-900/30 rounded">①の後に実行</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-gray-300">▶ 押すと:</span> ①で取込済みの過去実績(<span className="text-gray-300">{paramRangeLabel}</span>)を分析し、「材料費=売上の○%」のような変動率と「家賃=月○円」のような固定費を逆算して保存します。
            </p>
            <p className="text-[11px] text-gray-500">
              <span className="text-gray-400">▶ 効果:</span> 当月の予測PLのコスト計算が、最新の過去実績ベースに更新されます（営業利益の精度が上がる）。
            </p>
          </div>
        </div>

        {msg && <p className="text-xs text-gray-300 bg-gray-900/60 rounded p-2 whitespace-pre-wrap">{msg}</p>}
      </div>

      {/* データソース（売上・コストの出処） */}
      <DataSourceCard ds={data.dataSource} year={data.year} month={data.month} />

      {/* 固定費の手入力（新卒入社など PL に反映したい固定費を有効開始月とともに登録） */}
      <FixedCostEditor year={data.year} month={data.month} onSaved={refresh} />

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

// ─── データソースカード ──────────────────────────────────
function DataSourceCard({ ds, year, month }: { ds: DataSource; year: number; month: number }) {
  const fmtTs = (s: string | null) => {
    if (!s) return '—'
    // "2026-04-28T20:45:12" → "04/28 20:45"
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
    if (!m) return s
    return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`
  }
  const revenueSourceLabel = ds.revenueSource === 'pl_actual' ? 'PL確定値（シート取込）' : '売上速報スクレイプの予測値'
  const sourceColor = ds.revenueSource === 'pl_actual' ? 'text-green-400' : 'text-yellow-400'
  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-2 border border-gray-700/50">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-medium text-gray-300">データソース（{year}年{month}月）</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded bg-gray-900/60 ${sourceColor}`}>
          売上 = {revenueSourceLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
        <div className="bg-gray-900/40 rounded p-2">
          <div className="text-gray-500">売上速報スクレイプ</div>
          <div className="text-gray-200 font-medium">{fmtTs(ds.lastScrapeAt)}</div>
          <div className="text-gray-500 text-[10px]">
            当月取込日数: {ds.scrapedDaysOfMonth ?? '—'}日
          </div>
        </div>
        <div className="bg-gray-900/40 rounded p-2">
          <div className="text-gray-500">PL（Googleシート）</div>
          <div className="text-gray-200 font-medium">{fmtTs(ds.plImport.lastImportedAt)}</div>
          <div className="text-gray-500 text-[10px]">
            当月: {ds.plImport.rowCount}行 / {ds.plImport.costAccountCount}科目
            {ds.plImport.hasRevenue ? ' / 売上◎' : ' / 売上空欄'}
          </div>
        </div>
        <div className="bg-gray-900/40 rounded p-2">
          <div className="text-gray-500">手動上書き（当月）</div>
          <div className="text-gray-200 font-medium">
            固定費 {ds.overrides.fixedCostCount}件 / 変動率 {ds.overrides.variableRateCount}件
          </div>
          <div className="text-gray-500 text-[10px]">下のフォームで追加可能</div>
        </div>
      </div>
      {ds.revenueSource === 'sales_forecast' && (
        <p className="text-[10px] text-yellow-400/80 leading-relaxed">
          ⚠ 当月のシート売上が空欄のため、売上は <strong>売上速報スクレイプの着地予測</strong> を使用しています。
          画面の数字が動かない場合は <strong>「① Googleシートから実績PLを取込」</strong> を再実行するか、
          売上速報のスクレイプ最終時刻が古くないかを確認してください。
        </p>
      )}
    </div>
  )
}

// ─── 固定費の手入力 ──────────────────────────────────────
type FixedCostAccount = { code: string; name: string; category: string; subcategory: string | null }
type FixedCostRow = {
  account_code: string; store: string | null
  valid_from: string; valid_to: string | null
  amount: number; note: string | null
}

type ExtractCandidate = {
  amount: number
  expression: string
  snippet: string
  suggestedAccountCode: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
}
type ExtractedPage = {
  pageId: string; title: string; url: string; lastEdited: string
  candidates: ExtractCandidate[]
}

function FixedCostEditor({ year, month, onSaved }: { year: number; month: number; onSaved: () => Promise<void> | void }) {
  const [accounts, setAccounts] = useState<FixedCostAccount[]>([])
  const [active, setActive] = useState<FixedCostRow[]>([])
  const [accountCode, setAccountCode] = useState<string>('')
  const [validFrom, setValidFrom] = useState<string>(`${year}-${String(month).padStart(2, '0')}`)
  const [validTo, setValidTo] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [extractBusy, setExtractBusy] = useState(false)
  const [extractMsg, setExtractMsg] = useState<string | null>(null)
  const [extractedPages, setExtractedPages] = useState<ExtractedPage[]>([])

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/pl-fixed-cost?year=${year}&month=${month}`, { cache: 'no-store' })
    const j = await res.json()
    setAccounts(j.accounts ?? [])
    setActive(j.fixedCosts ?? [])
    if (!accountCode && j.accounts?.length > 0) {
      const def = j.accounts.find((a: FixedCostAccount) => a.code === 'cogs_salon_salary') ?? j.accounts[0]
      setAccountCode(def.code)
    }
  }, [year, month, accountCode])

  useEffect(() => { fetchData() }, [fetchData])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = parseFloat(amount.replace(/[,¥\s]/g, ''))
    if (!Number.isFinite(amt)) { setMsg('金額を入力してください'); return }
    if (!accountCode || !validFrom) { setMsg('科目と有効開始月を入力してください'); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/pl-fixed-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountCode, amount: amt, validFrom,
          validTo: validTo || null,
          note: note || null,
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setMsg(`保存失敗: ${j.error ?? res.statusText}`)
      } else {
        setMsg('保存しました')
        setAmount(''); setNote('')
        await fetchData()
        await onSaved()
      }
    } finally {
      setBusy(false)
    }
  }

  const runExtract = async () => {
    setExtractBusy(true); setExtractMsg(null)
    try {
      const res = await fetch('/api/pl-extract-from-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: 90, maxPages: 12 }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setExtractMsg(`抽出失敗: ${j.error ?? res.statusText}`)
        setExtractedPages([])
      } else {
        setExtractedPages(j.pages ?? [])
        setExtractMsg(`${j.pagesScanned}件のページから ${j.totalCandidates}件の候補を抽出（直近${j.daysBack}日）`)
      }
    } catch (e) {
      setExtractMsg(`通信エラー: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExtractBusy(false)
    }
  }

  const useCandidate = (page: ExtractedPage, c: ExtractCandidate) => {
    if (c.suggestedAccountCode) setAccountCode(c.suggestedAccountCode)
    setAmount(String(c.amount))
    setNote(`Notion議事録「${page.title}」より: ${c.expression}`)
    setMsg('候補をフォームに反映しました（保存ボタンで確定）')
  }

  const accountByCode = new Map(accounts.map(a => [a.code, a]))
  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-gray-300">固定費の手入力（新卒入社・人件費見直し等）</h2>
        <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
          科目を選んで「有効開始月」とともに登録すると、その月以降のPL予測に反映されます。
          終了月は空欄でOK（無期限）。例: アシスタント給与（22万 × 19人 = 418万）は <code>【原】給与手当(サロン社員)</code>、
          法定福利費（社会保険料）は <code>【原】法定福利費</code> に分けて登録。
        </p>
      </div>

      {/* 議事録（Notion）からの候補抽出 */}
      <div className="bg-gray-900/40 rounded-lg p-3 space-y-2 border border-gray-700/50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[11px] text-gray-400">
            <span className="text-gray-300 font-medium">📝 Notion議事録から候補抽出</span>
            <span className="text-gray-500 ml-2">直近90日のHD/サロン役員会議事録を検索 → 「給与」「人件費」「正社員」周辺の金額を抽出</span>
          </div>
          <button onClick={runExtract} disabled={extractBusy}
                  className="text-[11px] px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded-md whitespace-nowrap">
            {extractBusy ? '抽出中…' : '議事録から抽出'}
          </button>
        </div>
        {extractMsg && <p className="text-[10px] text-gray-400">{extractMsg}</p>}
        {extractedPages.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {extractedPages.map(page => (
              <div key={page.pageId} className="bg-gray-800/60 rounded p-2">
                <div className="text-[11px] text-gray-300 font-medium truncate">
                  <a href={page.url} target="_blank" rel="noreferrer" className="hover:text-blue-400">
                    {page.title}
                  </a>
                  <span className="text-gray-600 ml-2 text-[10px]">{page.lastEdited.slice(0, 10)}</span>
                </div>
                <div className="space-y-1 mt-1">
                  {page.candidates.map((c, i) => (
                    <div key={i} className="bg-gray-900/60 rounded px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[9px] px-1 py-0.5 rounded ${
                            c.confidence === 'high' ? 'bg-green-900/60 text-green-300'
                            : c.confidence === 'medium' ? 'bg-yellow-900/60 text-yellow-300'
                            : 'bg-gray-700 text-gray-400'
                          }`}>
                            {c.confidence === 'high' ? '高' : c.confidence === 'medium' ? '中' : '低'}
                          </span>
                          <span className="text-[11px] text-gray-200 font-medium">¥{c.amount.toLocaleString()}</span>
                          <span className="text-[10px] text-gray-500 truncate">{c.expression}</span>
                          {c.suggestedAccountCode && (
                            <span className="text-[9px] text-blue-300/80">→ {accountByCode.get(c.suggestedAccountCode)?.name ?? c.suggestedAccountCode}</span>
                          )}
                        </div>
                        <button onClick={() => useCandidate(page, c)}
                                className="text-[10px] px-2 py-0.5 bg-emerald-700/60 hover:bg-emerald-600 text-emerald-100 rounded">
                          採用 →フォームへ
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        <span className="text-gray-600">…</span>{c.snippet}<span className="text-gray-600">…</span>
                      </p>
                      <p className="text-[9px] text-gray-600 mt-0.5">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col text-[11px] text-gray-400 gap-0.5">
          <span>科目</span>
          <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
                  className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700">
            {accounts.map(a => (
              <option key={a.code} value={a.code}>
                [{a.category === 'cogs' ? '原価' : '販管'}/{subcatLabel(a.subcategory)}] {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-[11px] text-gray-400 gap-0.5">
          <span>金額（月額・円）</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="例: 4180000"
                 inputMode="numeric"
                 className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
        </label>
        <label className="flex flex-col text-[11px] text-gray-400 gap-0.5">
          <span>有効開始月（YYYY-MM）</span>
          <input value={validFrom} onChange={e => setValidFrom(e.target.value)} placeholder="2026-04"
                 className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
        </label>
        <label className="flex flex-col text-[11px] text-gray-400 gap-0.5">
          <span>有効終了月（任意・空欄で無期限）</span>
          <input value={validTo} onChange={e => setValidTo(e.target.value)} placeholder="2027-03"
                 className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
        </label>
        <label className="flex flex-col text-[11px] text-gray-400 gap-0.5 sm:col-span-2">
          <span>メモ（任意）</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="例: 4月新卒19名 22万×19=418万"
                 className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700" />
        </label>
        <div className="sm:col-span-2 flex items-center gap-2">
          <button type="submit" disabled={busy}
                  className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white rounded-md">
            保存
          </button>
          {msg && <span className="text-[11px] text-gray-400">{msg}</span>}
        </div>
      </form>

      {/* 当月有効な手入力固定費の一覧 */}
      {active.length > 0 && (
        <div className="border-t border-gray-700/50 pt-2">
          <p className="text-[11px] text-gray-500 mb-1">当月有効の手入力固定費（{active.length}件）</p>
          <div className="space-y-1">
            {active.map((f, i) => {
              const acc = accountByCode.get(f.account_code)
              return (
                <div key={i} className="flex items-center justify-between text-[11px] bg-gray-900/40 rounded px-2 py-1">
                  <div className="min-w-0 flex-1 truncate">
                    <span className="text-gray-300">{acc?.name ?? f.account_code}</span>
                    <span className="text-gray-500 ml-2">{f.valid_from} 〜 {f.valid_to ?? '無期限'}</span>
                    {f.note && <span className="text-gray-600 ml-2">／ {f.note}</span>}
                  </div>
                  <span className="text-gray-200 font-medium ml-2">¥{f.amount.toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function subcatLabel(s: string | null): string {
  if (!s) return '—'
  return ({ material: '材料', personnel: '人件費', promo: '広告', rent: '家賃', utility: '水光', other: 'その他', revenue: '売上', income: '収益', expense: '費用' } as Record<string, string>)[s] ?? s
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
