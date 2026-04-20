'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import SalesChart from '@/components/SalesChart'
import ProgressGauge from '@/components/ProgressGauge'
import StoreBreakdown from '@/components/StoreBreakdown'
import StaffBreakdown from '@/components/StaffBreakdown'
import TargetInput from '@/components/TargetInput'
import UploadZone from '@/components/UploadZone'
import ScrapeButton from '@/components/ScrapeButton'
import HistoryView from '@/components/HistoryView'
import AnalysisView from '@/components/AnalysisView'
import KpiView from '@/components/KpiView'
import PLForecastView from '@/components/PLForecastView'
import ColumnPanel from '@/components/ColumnPanel'
import type { DashboardData } from '@/lib/types'

type MainTab = 'current' | 'history' | 'analysis' | 'kpi' | 'pl'

const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' } as const

export default function DashboardClient() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mainTab, setMainTab] = useState<MainTab>('current')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales', { cache: 'no-store' })
      if (!res.ok) throw new Error('データ取得に失敗しました')
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  if (!data) return null

  const noData = data.totalSales === 0

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-8">
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">
              AITOKYO ダッシュボード
            </h1>
            <button
              onClick={async () => {
                await fetch('/api/auth', { method: 'DELETE' })
                router.push('/login')
              }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              ログアウト
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-0.5">
            {data.year}年{data.month}月 / {data.today}日時点
            {data.lastUpdated && (
              <> · 更新: {new Date(data.lastUpdated).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TargetInput
            year={data.year}
            month={data.month}
            currentTarget={data.monthlyTarget}
            onSaved={refresh}
          />
          <a
            href="/report"
            target="_blank"
            className="text-xs px-3 py-1.5 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-md transition-colors whitespace-nowrap"
          >
            月次レポート
          </a>
        </div>
      </div>

      {/* メインタブ切替 */}
      <div className="flex gap-1 bg-gray-800 rounded-xl p-1.5 overflow-x-auto">
        {([
          ['current', '今月', '今月ダッシュボード'],
          ['history', '実績', '過去実績'],
          ['analysis', '分析', '分析'],
          ['kpi', 'KPI', 'KPI'],
          ['pl', 'PL', '予測PL'],
        ] as [MainTab, string, string][]).map(([key, mobileLabel, desktopLabel]) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`flex-1 text-sm py-2.5 px-2 sm:px-4 rounded-lg transition-colors font-bold ${
              mainTab === key
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="sm:hidden">{mobileLabel}</span>
            <span className="hidden sm:inline">{desktopLabel}</span>
          </button>
        ))}
      </div>

      {/* 過去実績タブ */}
      {mainTab === 'history' && <HistoryView />}

      {/* 分析タブ */}
      {mainTab === 'analysis' && <AnalysisView />}

      {/* KPIタブ */}
      {mainTab === 'kpi' && <KpiView />}

      {/* 予測PLタブ */}
      {mainTab === 'pl' && <PLForecastView />}

      {/* 今月ダッシュボード */}
      {mainTab === 'current' && <>

      {/* KPI カード */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <KpiCard
              label="累計売上"
              value={formatYenCompact(data.totalSales)}
              sub={`${data.today}日分`}
            />
            <KpiCard
              label="達成率"
              value={data.achievementRate != null ? `${data.achievementRate}%` : '—'}
              sub={data.monthlyTarget ? `目標 ${formatYenCompact(data.monthlyTarget)}` : '目標未設定'}
              valueColor={
                data.achievementRate != null
                  ? data.achievementRate >= 100
                    ? 'text-green-400'
                    : data.achievementRate >= 80
                    ? 'text-blue-400'
                    : data.achievementRate >= 60
                    ? 'text-yellow-400'
                    : 'text-red-400'
                  : 'text-gray-400'
              }
            />
            <KpiCard
              label="残り日数"
              value={`${data.daysInMonth - data.today}日`}
              sub={`${data.daysInMonth}日中 ${data.today}日経過`}
            />
          </div>

          {/* 今月着地予測 3パターン */}
          <ForecastDetailSection data={data} />

          {/* 改善コラム */}
          {!noData && <ColumnPanel data={data} />}

          {/* 進捗ゲージ */}
          {data.monthlyTarget && data.monthlyTarget > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <ProgressGauge
                actual={data.totalSales}
                target={data.monthlyTarget}
                forecast={data.forecastDetail?.standard ?? data.forecast.forecastTotal}
              />
            </div>
          )}

          {/* 売上推移チャート */}
          <div className="bg-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3">日別売上推移</h2>
            {noData ? (
              <EmptyState />
            ) : (
              <SalesChart
                dailyData={data.dailyData}
                monthlyTarget={data.monthlyTarget}
                daysInMonth={data.daysInMonth}
                forecast={data.forecast}
                forecastStandard={data.forecastDetail?.standard}
              />
            )}
          </div>

          {/* 顧客KPI */}
          <div className="bg-gray-800 rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-medium text-gray-300">全店舗 顧客分析</h2>

            {/* 来店客数（実績 → 着地予測） */}
            <div>
              <p className="text-xs text-gray-500 mb-2">来店客数</p>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <ForecastCard label="合計総客数" value={data.totalCustomers} forecast={data.customerForecast} />
                <ForecastCard label="合計指名客数" value={data.nominated} forecast={data.nominatedForecast} />
                <ForecastCard label="合計フリー客数" value={data.freeVisit} forecast={data.freeVisitForecast} />
              </div>
            </div>

            {/* 新規・単価 */}
            <div>
              <p className="text-xs text-gray-500 mb-2">新規・単価</p>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <ForecastCard label="合計新規人数" value={data.newCustomers} forecast={data.newCustomerForecast} color="text-emerald-400" />
                <MiniKpi label="今月客単価" value={formatYen(data.avgSpend)} />
                <MiniKpi
                  label="BM新規3ヶ月リターン率(2回目来店)"
                  value={data.newReturn3mRate === '—' ? '—' : `${data.newReturn3mRate}%`}
                  valueColor={data.newReturn3mRate !== '—' && parseFloat(data.newReturn3mRate) >= 40 ? 'text-green-400' : data.newReturn3mRate !== '—' && parseFloat(data.newReturn3mRate) >= 20 ? 'text-blue-400' : 'text-yellow-400'}
                />
              </div>
            </div>

            {/* 率・会員 */}
            <div>
              <p className="text-xs text-gray-500 mb-2">比率・会員</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <MiniKpi
                  label="指名率"
                  value={`${data.nominationRate}%`}
                  valueColor={parseFloat(data.nominationRate) >= 85 ? 'text-green-400' : parseFloat(data.nominationRate) >= 70 ? 'text-blue-400' : 'text-yellow-400'}
                />
                <MiniKpi
                  label="フリー率"
                  value={`${data.freeRate}%`}
                  sub="指名率+フリー率=100%"
                  valueColor={parseFloat(data.freeRate) <= 15 ? 'text-green-400' : parseFloat(data.freeRate) <= 30 ? 'text-blue-400' : 'text-yellow-400'}
                />
                <MiniKpi
                  label="新規率"
                  value={`${data.newCustomerRate}%`}
                  sub="新規人数÷総客数"
                  valueColor={parseFloat(data.newCustomerRate) <= 15 ? 'text-green-400' : parseFloat(data.newCustomerRate) <= 30 ? 'text-blue-400' : 'text-yellow-400'}
                />
              </div>
            </div>

            {/* 会員 */}
            <div>
              <p className="text-xs text-gray-500 mb-2">会員</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <MiniKpi label="総顧客数" value={`${data.totalUsers.toLocaleString()}人`} />
                <MiniKpi label="アプリ会員数" value={`${data.appMembers.toLocaleString()}人`} />
                <MiniKpi
                  label="アプリ会員率"
                  value={`${data.appMemberRate}%`}
                  valueColor={parseFloat(data.appMemberRate) >= 50 ? 'text-green-400' : parseFloat(data.appMemberRate) >= 30 ? 'text-blue-400' : 'text-yellow-400'}
                />
              </div>
            </div>
          </div>

          {/* 店舗別 / スタッフ別 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">店舗別売上</h2>
              <StoreBreakdown data={data.storeBreakdown} total={data.totalSales} />
            </div>
            <div className="bg-gray-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">スタッフ別売上</h2>
              <StaffBreakdown data={data.staffBreakdown} total={data.totalSales} />
            </div>
          </div>

          {/* BM データ同期 */}
          <div className="bg-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3">BM データ同期</h2>
            <ScrapeButton url="/api/scrape" label="BM から今すぐ取込" onDone={refresh} />
            {data.lastUpdated && (
              <p className="text-xs text-gray-600 mt-2">
                最終同期: {new Date(data.lastUpdated).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          {/* CSV 取込（サブ手段） */}
          <div className="bg-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3">CSV 手動取込</h2>
            <UploadZone onSuccess={refresh} />
            <p className="text-xs text-gray-600 mt-2">
              ビューティーメリットからエクスポートしたCSVファイルをアップロードしてください
            </p>
          </div>

      </>}
    </main>
  )
}

function ForecastDetailSection({ data }: { data: DashboardData }) {
  const fd = data.forecastDetail
  const target = data.monthlyTarget
  const standard = fd?.standard ?? data.forecast.forecastTotal
  const conservative = fd?.conservative ?? Math.round(data.forecast.forecastTotal * 0.95)
  const optimistic = fd?.optimistic ?? Math.round(data.forecast.forecastTotal * 1.05)
  const confidence = data.forecast.confidence

  const targetDiffOpt = target ? optimistic - target : null
  const targetDiffStd = target ? standard - target : null
  const targetDiffCon = target ? conservative - target : null

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 space-y-3 border border-gray-700/50">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">今月着地予測</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded ${
          confidence === 'high' ? 'bg-green-900/50 text-green-400' :
          confidence === 'medium' ? 'bg-yellow-900/50 text-yellow-400' :
          'bg-gray-700 text-gray-400'
        }`}>
          精度: {confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低'}
          {fd && ` (${Math.round(fd.rationale.monthProgress * 100)}%経過)`}
        </span>
      </div>

      {/* 3パターンカード */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {/* 高め見込み */}
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-2 sm:p-3 text-center min-w-0">
          <p className="text-[10px] text-emerald-400 mb-0.5 sm:mb-1 font-medium">高め見込み</p>
          <p className="text-xs sm:text-lg font-bold text-emerald-400 break-all">
            {formatYenCompact(optimistic)}
          </p>
          {targetDiffOpt !== null && (
            <p className={`text-[9px] sm:text-[10px] mt-0.5 ${targetDiffOpt >= 0 ? 'text-green-400' : 'text-red-400'} break-all`}>
              目標差 {targetDiffOpt >= 0 ? '+' : ''}{formatYenCompact(targetDiffOpt)}
            </p>
          )}
        </div>
        {/* 着地予測（標準） */}
        <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-2 sm:p-3 text-center min-w-0">
          <p className="text-[10px] text-blue-300 mb-0.5 sm:mb-1 font-medium">着地予測</p>
          <p className="text-xs sm:text-lg font-bold text-white break-all">
            {formatYenCompact(standard)}
          </p>
          {targetDiffStd !== null && (
            <p className={`text-[9px] sm:text-[10px] mt-0.5 ${targetDiffStd >= 0 ? 'text-green-400' : 'text-red-400'} break-all`}>
              目標差 {targetDiffStd >= 0 ? '+' : ''}{formatYenCompact(targetDiffStd)}
            </p>
          )}
        </div>
        {/* 堅実ライン */}
        <div className="bg-gray-800/60 border border-gray-600/30 rounded-lg p-2 sm:p-3 text-center min-w-0">
          <p className="text-[10px] text-gray-400 mb-0.5 sm:mb-1 font-medium">堅実ライン</p>
          <p className="text-xs sm:text-lg font-bold text-gray-300 break-all">
            {formatYenCompact(conservative)}
          </p>
          {targetDiffCon !== null && (
            <p className={`text-[9px] sm:text-[10px] mt-0.5 ${targetDiffCon >= 0 ? 'text-green-400' : 'text-red-400'} break-all`}>
              目標差 {targetDiffCon >= 0 ? '+' : ''}{formatYenCompact(targetDiffCon)}
            </p>
          )}
        </div>
      </div>

      {/* 月次目標参照 */}
      {target && (
        <p className="text-[11px] text-yellow-400/80 text-center">
          今月目標: {formatYen(target)}
        </p>
      )}

      {/* 予測根拠 */}
      {fd && (
        <div className="bg-gray-900/50 rounded-lg p-3 space-y-1.5">
          <p className="text-xs font-medium text-gray-400 mb-2">予測の根拠</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between text-gray-400 gap-2">
              <span className="shrink-0">平日 日割り</span>
              <span className="text-gray-300 text-right truncate">
                {formatYen(fd.rationale.weekdayAvg)}/日 × {fd.rationale.weekdayCount}日
                <span className="text-gray-500"> (実績{fd.rationale.weekdayActualDays}日)</span>
              </span>
            </div>
            <div className="flex justify-between text-gray-400 gap-2">
              <span className="shrink-0">土日祝 日割り</span>
              <span className="text-gray-300 text-right truncate">
                {formatYen(fd.rationale.weekendAvg)}/日 × {fd.rationale.weekendCount}日
                <span className="text-gray-500"> (実績{fd.rationale.weekendActualDays}日)</span>
              </span>
            </div>
            <div className="flex justify-between text-gray-400 gap-2">
              <span className="shrink-0">全体 日割り</span>
              <span className="text-gray-300 text-right truncate">
                {formatYen(fd.rationale.dailyAvg)}/日 (参考)
              </span>
            </div>
            <div className="flex justify-between text-gray-400 gap-2">
              <span className="shrink-0">ペース着地</span>
              <span className="text-gray-300 text-right truncate">
                {formatYen(fd.rationale.paceEstimate)}
              </span>
            </div>
            {fd.rationale.prevYearSales !== null && (
              <div className="flex justify-between text-gray-400">
                <span>前年{data.month}月実績</span>
                <span className="text-gray-300">{formatYen(fd.rationale.prevYearSales)}</span>
              </div>
            )}
            {fd.rationale.yoyGrowthRate !== null && (
              <div className="flex justify-between text-gray-400">
                <span>今年平均成長率</span>
                <span className={fd.rationale.yoyGrowthRate >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {fd.rationale.yoyGrowthRate >= 0 ? '+' : ''}{fd.rationale.yoyGrowthRate.toFixed(1)}%
                </span>
              </div>
            )}
            {fd.rationale.yoyEstimate !== null && (
              <div className="flex justify-between text-gray-400">
                <span>YoY予測着地</span>
                <span className="text-gray-300">{formatYen(fd.rationale.yoyEstimate)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-400">
              <span>ブレンド比率</span>
              <span className="text-gray-300">
                ペース{Math.round(fd.rationale.paceWeight * 100)}% / YoY{Math.round((1 - fd.rationale.paceWeight) * 100)}%
              </span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>月進捗</span>
              <span className="text-gray-300">
                {data.today}/{data.daysInMonth}日 ({Math.round(fd.rationale.monthProgress * 100)}%)
              </span>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            ※ ペース着地 = 平日平均×平日残日数 + 土日祝平均×土日祝残日数 + 実績 / 着地予測 = ペース×{Math.round(fd.rationale.paceWeight * 100)}% + YoY×{Math.round((1 - fd.rationale.paceWeight) * 100)}% / 高め = max(ペース,YoY)×103% / 堅実 = 標準×95%
          </p>
        </div>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  valueColor = 'text-white',
  subColor = 'text-gray-500',
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
  subColor?: string
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-2.5 sm:p-4">
      <p className="text-[10px] sm:text-xs text-gray-400 mb-0.5 sm:mb-1">{label}</p>
      <p className={`text-base sm:text-xl font-bold ${valueColor} truncate`}>{value}</p>
      {sub && <p className={`text-[10px] sm:text-xs mt-0.5 ${subColor} truncate`}>{sub}</p>}
    </div>
  )
}

function MiniKpi({ label, value, sub, valueColor = 'text-white' }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-2 sm:p-3">
      <p className="text-[10px] sm:text-xs text-gray-400 mb-0.5 sm:mb-1 truncate">{label}</p>
      <p className={`text-sm sm:text-lg font-bold ${valueColor} truncate`}>{value}</p>
      {sub && <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function ForecastCard({ label, value, forecast, color = 'text-white' }: { label: string; value: number; forecast: number; color?: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-2 sm:p-3">
      <p className="text-[10px] sm:text-xs text-gray-400 mb-0.5 sm:mb-1 truncate">{label}</p>
      <p className={`text-sm sm:text-lg font-bold ${color}`}>{value.toLocaleString()}<span className="text-xs sm:text-sm">人</span></p>
      <p className="text-[10px] sm:text-xs text-cyan-300 mt-1 sm:mt-1.5">着地予測</p>
      <p className="text-xs sm:text-base font-bold text-cyan-400">{forecast.toLocaleString()}人</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
      BMのCSVをアップロードするとグラフが表示されます
    </div>
  )
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString()}`
}

/** 億/万単位でコンパクトに表示（モバイル幅対応）。例: ¥10億4,610万 */
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
