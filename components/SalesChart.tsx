'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { ForecastResult } from '@/lib/types'

type DayData = { date: string; sales: number; cumulative: number }

export default function SalesChart({
  dailyData,
  monthlyTarget,
  daysInMonth,
  forecast,
}: {
  dailyData: DayData[]
  monthlyTarget: number | null
  daysInMonth: number
  forecast: ForecastResult
}) {
  const formatYen = (v: number) =>
    v >= 10_000 ? `${Math.round(v / 10_000)}万` : `¥${v.toLocaleString()}`

  // 目標ペース（月全体）
  const targetPaceMap: Record<string, number> = {}
  if (monthlyTarget) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = String(d).padStart(2, '0')
      targetPaceMap[dateKey] = Math.round((monthlyTarget / daysInMonth) * d)
    }
  }

  // 最終実績の累積値（予測の起点）
  const lastActualCumulative =
    dailyData.length > 0 ? dailyData[dailyData.length - 1].cumulative : 0

  // 実績データのマップ
  const actualMap: Record<string, number> = {}
  for (const d of dailyData) {
    const dayNum = parseInt(d.date.split('-')[1])
    actualMap[String(dayNum).padStart(2, '0')] = d.cumulative
  }

  // 予測データのマップ（累積）
  const projectionMap: Record<string, number> = {}
  let runningProjection = lastActualCumulative
  for (const p of forecast.dailyProjections) {
    const dayNum = parseInt(p.date.split('-')[2])
    runningProjection += p.projected
    projectionMap[String(dayNum).padStart(2, '0')] = runningProjection
  }

  // 全日分のデータを生成（1〜月末）
  const chartData = Array.from({ length: daysInMonth }, (_, i) => {
    const dayNum = i + 1
    const key = String(dayNum).padStart(2, '0')
    return {
      date: key,
      cumulative: actualMap[key] ?? null,
      projection: projectionMap[key] ?? null,
      target: targetPaceMap[key] ?? null,
    }
  })

  // 最終実績日の予測起点を繋げる（ギャップなし）
  if (forecast.dailyProjections.length > 0 && dailyData.length > 0) {
    const lastActualDay = parseInt(dailyData[dailyData.length - 1].date.split('-')[1])
    const key = String(lastActualDay).padStart(2, '0')
    const idx = chartData.findIndex((d) => d.date === key)
    if (idx >= 0) {
      chartData[idx].projection = lastActualCumulative
    }
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          interval={Math.floor(daysInMonth / 6)}
        />
        <YAxis
          tickFormatter={formatYen}
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          width={48}
        />
        <Tooltip
          formatter={(v: unknown, name: string) => {
            if (v === null || v === undefined) return null
            const labels: Record<string, string> = {
              cumulative: '累積実績',
              projection: '累積予測',
              target: '目標ペース',
            }
            return [`¥${(v as number).toLocaleString()}`, labels[name] ?? name]
          }}
          contentStyle={{
            backgroundColor: '#1F2937',
            border: '1px solid #374151',
            borderRadius: 8,
          }}
          labelStyle={{ color: '#E5E7EB' }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }}
          formatter={(value) => {
            const map: Record<string, string> = {
              cumulative: '累積実績',
              projection: '予測（月末見込み）',
              target: '目標ペース',
            }
            return map[value] ?? value
          }}
        />

        {/* 累積実績 */}
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#60A5FA"
          strokeWidth={2.5}
          dot={false}
          connectNulls={false}
          name="cumulative"
        />

        {/* 予測（破線） */}
        {forecast.dailyProjections.length > 0 && (
          <Line
            type="monotone"
            dataKey="projection"
            stroke="#60A5FA"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeOpacity={0.6}
            dot={false}
            connectNulls={false}
            name="projection"
          />
        )}

        {/* 目標ペース */}
        {monthlyTarget && (
          <Line
            type="monotone"
            dataKey="target"
            stroke="#F59E0B"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            name="target"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
