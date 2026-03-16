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
import AnalyticsTabs from './AnalyticsTabs'
import type { DashboardData } from '@/lib/types'

const CONFIDENCE_LABEL = { high: '高', medium: '中', low: '低' } as const

export default function DashboardClient() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mainTab, setMainTab] = useState<'overview' | 'analytics'>('overview')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/sales')
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
        {mainTab === 'overview' && (
          <TargetInput
            year={data.year}
            month={data.month}
            currentTarget={data.monthlyTarget}
            onSaved={refresh}
          />
        )}
      </div>

      {/* メインタブ切替 */}
      <div className="flex gap-2 border-b border-gray-700 pb-0">
        <button
          onClick={() => setMainTab('overview')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
            mainTab === 'overview'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          売上概要
        </button>
        <button
          onClick={() => setMainTab('analytics')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
            mainTab === 'analytics'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          BM分析
        </button>
      </div>

      {mainTab === 'overview' ? (
        <>
          {/* KPI カード */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="累計売上"
              value={formatYen(data.totalSales)}
              sub={`${data.today}日分`}
            />
            <KpiCard
              label="月末予測"
              value={formatYen(data.forecast.forecastTotal)}
              sub={`予測精度: ${CONFIDENCE_LABEL[data.forecast.confidence]}`}
              subColor={
                data.forecast.confidence === 'high'
                  ? 'text-green-400'
                  : data.forecast.confidence === 'medium'
                  ? 'text-yellow-400'
                  : 'text-gray-400'
              }
            />
            <KpiCard
              label="達成率"
              value={data.achievementRate != null ? `${data.achievementRate}%` : '—'}
              sub={data.monthlyTarget ? `目標 ${formatYen(data.monthlyTarget)}` : '目標未設定'}
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

          {/* 進捗ゲージ */}
          {data.monthlyTarget && data.monthlyTarget > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <ProgressGauge
                actual={data.totalSales}
                target={data.monthlyTarget}
                forecast={data.forecast.forecastTotal}
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
              />
            )}
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
        </>
      ) : (
        <AnalyticsTabs year={data.year} month={data.month} />
      )}
    </main>
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
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor}`}>{sub}</p>}
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
