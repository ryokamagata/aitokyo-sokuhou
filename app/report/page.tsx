'use client'

import { useEffect, useState } from 'react'

type StoreRow = { store: string; sales: number; customers: number; unitPrice: number; forecast: number; yoyGrowth: number | null }
type StaffRow = { name: string; sales: number }
type TrendRow = { month: number; sales: number; customers: number; unitPrice: number; target: number | null; rate: number | null }
type AnalysisColumn = { title: string; body: string; priority: 'high' | 'medium' | 'low' }
type ForecastData = { standard: number; conservative: number; optimistic: number; dailyAvg: number; paceEstimate: number; yoyEstimate: number | null; paceWeight: number }

type ReportData = {
  year: number; month: number; today: number; daysInMonth: number; remaining: number; dateLabel: string
  currentSales: number; currentCustomers: number; unitPrice: number; prevUnitPrice: number
  monthTarget: number | null; achievementRate: number | null; momGrowth: number | null; yoyGrowth: number | null
  ytdSales: number; ytdCustomers: number; annualTarget: number | null
  seatUtilization: number | null; totalSeats: number
  forecast: ForecastData
  stores: StoreRow[]; topStaff: StaffRow[]; monthlyTrend: TrendRow[]; analysisColumns: AnalysisColumn[]
}

function fmtMan(n: number): string {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億`
  return `${Math.round(n / 10_000).toLocaleString()}万円`
}
function fmtYen(n: number): string { return `¥${n.toLocaleString()}` }

export default function ReportPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/report')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>レポート生成中...</div>
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#c00' }}>データ取得に失敗しました</div>

  const priorityColor = (p: string) => p === 'high' ? '#dc2626' : p === 'medium' ? '#d97706' : '#2563eb'
  const priorityLabel = (p: string) => p === 'high' ? '要対応' : p === 'medium' ? '改善余地' : '好調'

  return (
    <>
      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
        }
        .report { font-family: 'Helvetica Neue', Arial, 'Hiragino Sans', 'Meiryo', sans-serif; max-width: 820px; margin: 0 auto; padding: 20px; background: #fff; color: #1a1a1a; font-size: 11px; line-height: 1.5; }
        .rpt-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 16px; }
        .rpt-header h1 { font-size: 20px; margin: 0; }
        .rpt-header .date { font-size: 13px; color: #666; }
        .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
        .kpi-card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center; }
        .kpi-card .label { font-size: 9px; color: #888; margin-bottom: 2px; }
        .kpi-card .value { font-size: 18px; font-weight: bold; }
        .kpi-card .sub { font-size: 9px; color: #666; margin-top: 2px; }
        .section { margin-bottom: 14px; }
        .section h2 { font-size: 13px; border-left: 4px solid #2563eb; padding-left: 8px; margin: 0 0 6px; }
        .rpt-table { width: 100%; border-collapse: collapse; font-size: 10px; }
        .rpt-table th { background: #f5f5f5; text-align: left; padding: 4px 6px; border-bottom: 2px solid #ddd; font-weight: 600; }
        .rpt-table td { padding: 3px 6px; border-bottom: 1px solid #eee; }
        .text-right { text-align: right; }
        .text-green { color: #16a34a; }
        .text-red { color: #dc2626; }
        .print-btn { position: fixed; bottom: 20px; right: 20px; background: #2563eb; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.2); z-index: 100; }
        .print-btn:hover { background: #1d4ed8; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px; }
        .highlight { background: #eff6ff; padding: 10px; border-radius: 6px; margin-bottom: 14px; }
        .highlight p { margin: 3px 0; font-size: 10px; }
        .forecast-box { border: 2px solid #2563eb; border-radius: 8px; padding: 10px; text-align: center; }
        .forecast-box .val { font-size: 22px; font-weight: bold; color: #2563eb; }
        .forecast-box .lbl { font-size: 9px; color: #666; }
        .analysis-card { border-left: 3px solid; padding: 8px 10px; margin-bottom: 8px; background: #fafafa; border-radius: 0 6px 6px 0; }
        .analysis-card .tag { display: inline-block; font-size: 8px; font-weight: bold; color: #fff; padding: 1px 6px; border-radius: 3px; margin-right: 6px; }
        .analysis-card h4 { margin: 0 0 4px; font-size: 11px; }
        .analysis-card p { margin: 0; font-size: 10px; color: #444; }
      `}</style>

      <button className="print-btn no-print" onClick={() => window.print()}>PDF出力 / 印刷</button>

      <div className="report">
        <div className="rpt-header">
          <h1>AITOKYO 月次経営レポート</h1>
          <div className="date">{data.year}年{data.month}月度（{data.dateLabel}）</div>
        </div>

        {/* KPIカード - 5列 */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="label">月間売上（{data.today}日時点）</div>
            <div className="value">{fmtMan(data.currentSales)}</div>
            <div className="sub">目標 {data.monthTarget ? fmtMan(data.monthTarget) : '未設定'}</div>
          </div>
          <div className="kpi-card">
            <div className="label">達成率</div>
            <div className="value" style={{
              color: data.achievementRate && data.achievementRate >= 100 ? '#16a34a'
                : data.achievementRate && data.achievementRate >= 80 ? '#2563eb' : '#dc2626'
            }}>
              {data.achievementRate ? `${data.achievementRate}%` : '—'}
            </div>
            <div className="sub">残 {data.remaining}日</div>
          </div>
          <div className="kpi-card">
            <div className="label">着地予測（標準）</div>
            <div className="value" style={{ color: '#2563eb' }}>{fmtMan(data.forecast.standard)}</div>
            <div className="sub">
              {data.monthTarget ? `目標比 ${Math.round(data.forecast.standard / data.monthTarget * 100)}%` : ''}
            </div>
          </div>
          <div className="kpi-card">
            <div className="label">客単価</div>
            <div className="value">{fmtYen(data.unitPrice)}</div>
            <div className="sub">前月 {fmtYen(data.prevUnitPrice)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">席稼働率</div>
            <div className="value">{data.seatUtilization ? `${data.seatUtilization}%` : '—'}</div>
            <div className="sub">{data.totalSeats}席</div>
          </div>
        </div>

        {/* 着地予測3パターン */}
        <div className="three-col">
          <div className="forecast-box" style={{ borderColor: '#d97706' }}>
            <div className="lbl">堅実予測</div>
            <div className="val" style={{ color: '#d97706' }}>{fmtMan(data.forecast.conservative)}</div>
            <div className="lbl">標準×95%</div>
          </div>
          <div className="forecast-box">
            <div className="lbl">標準予測</div>
            <div className="val">{fmtMan(data.forecast.standard)}</div>
            <div className="lbl">ペース{Math.round(data.forecast.paceWeight * 100)}% + YoY{Math.round((1 - data.forecast.paceWeight) * 100)}%</div>
          </div>
          <div className="forecast-box" style={{ borderColor: '#16a34a' }}>
            <div className="lbl">高め見込み</div>
            <div className="val" style={{ color: '#16a34a' }}>{fmtMan(data.forecast.optimistic)}</div>
            <div className="lbl">max(ペース,YoY)×103%</div>
          </div>
        </div>

        {/* サマリー */}
        <div className="highlight">
          <p>
            <strong>前月比:</strong>{' '}
            {data.momGrowth !== null ? (
              <span className={data.momGrowth >= 0 ? 'text-green' : 'text-red'}>
                {data.momGrowth >= 0 ? '+' : ''}{data.momGrowth.toFixed(1)}%
              </span>
            ) : '—'}
            {' / '}
            <strong>前年同月比:</strong>{' '}
            {data.yoyGrowth !== null ? (
              <span className={data.yoyGrowth >= 0 ? 'text-green' : 'text-red'}>
                {data.yoyGrowth >= 0 ? '+' : ''}{data.yoyGrowth.toFixed(1)}%
              </span>
            ) : '—'}
            {' / '}
            <strong>日平均:</strong> {fmtMan(data.forecast.dailyAvg)}
          </p>
          <p>
            <strong>年間累計:</strong> {fmtMan(data.ytdSales)}（{data.ytdCustomers.toLocaleString()}人）
            / 年間目標 {data.annualTarget ? fmtMan(data.annualTarget) : '未設定'}
            / 進捗 {data.annualTarget ? `${Math.round(data.ytdSales / data.annualTarget * 100)}%` : '—'}
          </p>
        </div>

        <div className="two-col">
          {/* 店舗別（着地予測付き） */}
          <div className="section">
            <h2>店舗別売上・着地予測</h2>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>店舗</th>
                  <th className="text-right">実績</th>
                  <th className="text-right">着地予測</th>
                  <th className="text-right">前年比</th>
                </tr>
              </thead>
              <tbody>
                {data.stores.map(s => (
                  <tr key={s.store}>
                    <td>{s.store}</td>
                    <td className="text-right">{fmtMan(s.sales)}</td>
                    <td className="text-right" style={{ color: '#2563eb', fontWeight: 'bold' }}>{fmtMan(s.forecast)}</td>
                    <td className="text-right">
                      {s.yoyGrowth !== null ? (
                        <span className={s.yoyGrowth >= 0 ? 'text-green' : 'text-red'}>
                          {s.yoyGrowth >= 0 ? '+' : ''}{s.yoyGrowth.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スタッフTOP10 */}
          <div className="section">
            <h2>スタッフ売上 TOP10</h2>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>スタッフ</th>
                  <th className="text-right">売上</th>
                </tr>
              </thead>
              <tbody>
                {data.topStaff.map((s, i) => (
                  <tr key={s.name}>
                    <td>{i + 1}</td>
                    <td>{s.name}</td>
                    <td className="text-right">{fmtMan(s.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 月別推移 */}
        <div className="section">
          <h2>月別推移（{data.year}年）</h2>
          <table className="rpt-table">
            <thead>
              <tr>
                <th>月</th>
                <th className="text-right">売上</th>
                <th className="text-right">客数</th>
                <th className="text-right">客単価</th>
                <th className="text-right">目標</th>
                <th className="text-right">達成率</th>
              </tr>
            </thead>
            <tbody>
              {data.monthlyTrend.map(m => (
                <tr key={m.month}>
                  <td>{m.month}月</td>
                  <td className="text-right">{fmtMan(m.sales)}</td>
                  <td className="text-right">{m.customers.toLocaleString()}人</td>
                  <td className="text-right">{fmtYen(m.unitPrice)}</td>
                  <td className="text-right">{m.target ? fmtMan(m.target) : '—'}</td>
                  <td className="text-right">
                    {m.rate !== null ? (
                      <span className={m.rate >= 100 ? 'text-green' : 'text-red'}>{m.rate}%</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分析コラム */}
        {data.analysisColumns.length > 0 && (
          <div className="section">
            <h2>経営分析コラム</h2>
            {data.analysisColumns.map((col, i) => (
              <div key={i} className="analysis-card" style={{ borderLeftColor: priorityColor(col.priority) }}>
                <div>
                  <span className="tag" style={{ background: priorityColor(col.priority) }}>
                    {priorityLabel(col.priority)}
                  </span>
                  <h4 style={{ display: 'inline' }}>{col.title}</h4>
                </div>
                <p>{col.body}</p>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 9, color: '#999' }}>
          AITOKYO Sales Dashboard - Generated {new Date().toLocaleDateString('ja-JP')}
        </div>
      </div>
    </>
  )
}
