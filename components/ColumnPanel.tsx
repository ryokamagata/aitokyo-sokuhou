'use client'

import { useState } from 'react'
import type { DashboardData } from '@/lib/types'

type ColumnItem = {
  category: string
  icon: string
  title: string
  body: string
  metric: string
  priority: 'high' | 'medium' | 'low'
}

export default function ColumnPanel({ data }: { data: DashboardData }) {
  const [expanded, setExpanded] = useState(true)
  const columns = generateColumns(data)

  if (columns.length === 0) return null

  const highCount = columns.filter(c => c.priority === 'high').length

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl overflow-hidden border border-gray-700/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-white">
            改善コラム
          </span>
          <span className="text-xs text-gray-500">
            {data.month}月{data.today}日時点の数字から自動分析
          </span>
          {highCount > 0 && (
            <span className="text-[10px] bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded font-medium">
              要注目 {highCount}件
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 sm:px-4 pb-4 space-y-3">
          {columns.map((col, idx) => (
            <ColumnCard key={idx} item={col} />
          ))}
        </div>
      )}
    </div>
  )
}

function ColumnCard({ item }: { item: ColumnItem }) {
  const bgColor = item.priority === 'high'
    ? 'bg-red-950/30 border-red-800/40'
    : item.priority === 'medium'
    ? 'bg-yellow-950/20 border-yellow-800/30'
    : 'bg-blue-950/20 border-blue-800/30'

  const tagColor = item.priority === 'high'
    ? 'bg-red-900/50 text-red-300'
    : item.priority === 'medium'
    ? 'bg-yellow-900/50 text-yellow-300'
    : 'bg-blue-900/50 text-blue-300'

  const priorityLabel = item.priority === 'high'
    ? '要対応'
    : item.priority === 'medium'
    ? '改善余地'
    : '好調'

  return (
    <div className={`rounded-xl p-4 border ${bgColor}`}>
      {/* ヘッダー */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{item.icon}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tagColor}`}>
          {item.category}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tagColor}`}>
          {priorityLabel}
        </span>
      </div>

      {/* タイトル */}
      <p className="text-sm font-bold text-white mb-1.5 leading-snug">{item.title}</p>

      {/* 数値根拠 */}
      <div className="bg-gray-900/60 rounded-lg px-3 py-1.5 mb-2">
        <p className="text-[11px] text-cyan-400 font-medium">{item.metric}</p>
      </div>

      {/* 改善アクション */}
      <p className="text-xs text-gray-300 leading-relaxed">{item.body}</p>
    </div>
  )
}

function generateColumns(data: DashboardData): ColumnItem[] {
  const cols: ColumnItem[] = []
  const fd = data.forecastDetail
  const target = data.monthlyTarget
  const remaining = data.daysInMonth - data.today
  const staffDetail = data.staffDetail ?? []

  // ── 1. 売上ペースと目標の関係性 ─────────────────────────────────
  if (target && target > 0 && fd) {
    const achieveRate = (fd.standard / target) * 100
    const dailyAvg = fd.rationale.dailyAvg
    const gap = target - fd.standard

    if (achieveRate < 90) {
      const dailyNeeded = remaining > 0
        ? Math.round((target - data.totalSales) / remaining)
        : 0
      cols.push({
        category: '売上目標',
        icon: '\u{1F6A8}',
        title: `目標まで${fmtMan(gap)}不足 — 残り${remaining}日で巻き返し`,
        body: `現ペース日平均${fmtMan(dailyAvg)}に対し、達成には日平均${fmtMan(dailyNeeded)}が必要。週末の予約枠最大化・ホットペッパークーポン即配信・全スタッフにオプション1品追加提案を徹底。店長会議で日次目標をセット。`,
        metric: `達成率 ${achieveRate.toFixed(0)}% / 日平均 ${fmtMan(dailyAvg)} → 必要 ${fmtMan(dailyNeeded)}/日`,
        priority: 'high',
      })
    } else if (achieveRate < 100) {
      cols.push({
        category: '売上目標',
        icon: '\u{1F3AF}',
        title: `あと${fmtMan(gap)}で達成 — 射程圏内`,
        body: `残り${remaining}日で日平均${fmtMan(Math.round((target - data.totalSales) / Math.max(remaining, 1)))}を確保すれば達成。LINEクーポン配信で空き枠を埋める。全スタッフにオプション追加提案を徹底。`,
        metric: `達成率 ${achieveRate.toFixed(0)}% / 不足 ${fmtMan(gap)} / 残り${remaining}日`,
        priority: 'medium',
      })
    } else {
      cols.push({
        category: '売上目標',
        icon: '\u{2705}',
        title: `目標達成ペース — 着地${fmtMan(fd.standard)}（${achieveRate.toFixed(0)}%）`,
        body: `このタイミングで客単価UP施策（トリートメント追加提案）に注力し、超過達成を狙う。上振れ分は来月への貯金になる。`,
        metric: `日平均 ${fmtMan(dailyAvg)} / 着地 ${fmtMan(fd.standard)} / 目標 ${fmtMan(target)}`,
        priority: 'low',
      })
    }
  }

  // ── 2. 前年同月比 ──────────────────────────────────────────────
  if (fd?.rationale.yoyGrowthRate !== null && fd?.rationale.yoyGrowthRate !== undefined) {
    const yoyRate = fd.rationale.yoyGrowthRate
    const prevYear = fd.rationale.prevYearSales

    if (yoyRate < -5 && prevYear) {
      const daysPassed = Math.max(data.today, 1)
      const projectedCust = Math.round((data.totalCustomers / daysPassed) * data.daysInMonth)
      cols.push({
        category: '前年比較',
        icon: '\u{1F4C9}',
        title: `前年同月比${yoyRate.toFixed(1)}%ダウン`,
        body: data.avgSpend < 8000
          ? `客単価${fmtYen(data.avgSpend)}が低い。カラー+トリートメントのセット提案率を確認。スタッフごとのオプション提案率を可視化して朝礼で共有。`
          : `客数着地${projectedCust}人が課題。ホットペッパーの掲載順位とクーポン設計を見直し。紹介カード配布数を各スタッフ月10枚以上に。`,
        metric: `前年${fmtMan(prevYear)} → 着地 ${fmtMan(fd.standard)} / 客単価 ${fmtYen(data.avgSpend)}`,
        priority: 'high',
      })
    }
  }

  // ── 3. スタッフパフォーマンス ───────────────────────────────────
  if (staffDetail.length >= 3) {
    const upCount = staffDetail.filter(s => s.trend === 'up').length
    const downCount = staffDetail.filter(s => s.trend === 'down').length

    const top3 = staffDetail.slice(0, 3)
    const bottom3 = staffDetail.slice(-3)
    const top3Avg = top3.reduce((s, d) => s + d.predictedSales, 0) / 3
    const bottom3Avg = bottom3.reduce((s, d) => s + d.predictedSales, 0) / 3

    if (top3Avg > 0 && bottom3Avg > 0 && top3Avg / bottom3Avg > 3) {
      cols.push({
        category: 'スタッフ',
        icon: '\u{1F4CA}',
        title: `上位・下位の格差${(top3Avg / bottom3Avg).toFixed(1)}倍 — ノウハウ共有が急務`,
        body: `トップの施術フロー・カウンセリング手法を動画化し、週次の朝礼で共有。下位スタッフにはペア施術での学習機会を。月次1on1で個人目標設定を。`,
        metric: `TOP3平均 ${fmtMan(Math.round(top3Avg))} / BOTTOM3平均 ${fmtMan(Math.round(bottom3Avg))}`,
        priority: 'high',
      })
    }

    if (downCount >= 3) {
      const declining = staffDetail.filter(s => s.trend === 'down')
      const names = declining.slice(0, 3).map(s => s.staff).join('、')
      cols.push({
        category: 'スタッフ',
        icon: '\u{26A0}\u{FE0F}',
        title: `${downCount}名が前月比マイナス`,
        body: `${names}${downCount > 3 ? `他${downCount - 3}名` : ''}が下降中。個別面談で原因をヒアリング（客離れ・モチベーション・技術）。アシスタントとのペア営業で支援。`,
        metric: `下降 ${downCount}名 / 上昇 ${upCount}名 / 全${staffDetail.length}名`,
        priority: 'high',
      })
    } else if (upCount >= staffDetail.length * 0.6) {
      cols.push({
        category: 'スタッフ',
        icon: '\u{1F4AA}',
        title: `${upCount}名が上昇トレンド — チーム好調`,
        body: `好調スタッフの取り組みを全体共有。この勢いで次回予約確保率を高め、来月以降の安定成長につなげる。`,
        metric: `上昇 ${upCount}名 / ${staffDetail.length}名中`,
        priority: 'low',
      })
    }

    // 急成長スタッフ
    const highGrowth = staffDetail.filter(s => s.growthRate !== null && s.growthRate > 30)
    if (highGrowth.length >= 1 && downCount >= 2) {
      cols.push({
        category: 'スタッフ',
        icon: '\u{1F4A1}',
        title: `急成長メンバーのノウハウを横展開`,
        body: `${highGrowth.slice(0, 2).map(s => `${s.staff}(+${s.growthRate?.toFixed(0)}%)`).join('、')}が大幅成長。カウンセリングトーク・オプション提案の手法を朝礼で共有（5分）。下降メンバーとのペア施術も有効。`,
        metric: highGrowth.slice(0, 3).map(s => `${s.staff} +${s.growthRate?.toFixed(0)}%`).join(' / '),
        priority: 'medium',
      })
    }
  }

  // ── 4. 客単価分析 ──────────────────────────────────────────────
  if (data.avgSpend > 0 && data.totalCustomers > 0) {
    const daysPassed = Math.max(data.today, 1)
    const projCust = Math.round((data.totalCustomers / daysPassed) * data.daysInMonth)

    if (data.avgSpend < 7000) {
      cols.push({
        category: '客単価',
        icon: '\u{1F4B0}',
        title: `客単価${fmtYen(data.avgSpend)} — 単価UP余地あり`,
        body: `カット単品の比率が高い可能性。カラー+トリートメントのセットメニュー導入、スタッフのアップセルトーク研修を実施。セット率を週次で追跡。`,
        metric: `客単価 ${fmtYen(data.avgSpend)} / 客数着地 ${projCust}人 / 目安 ¥8,000以上`,
        priority: 'medium',
      })
    } else if (data.avgSpend >= 10000 && projCust < 500) {
      cols.push({
        category: '客単価',
        icon: '\u{1F4B0}',
        title: `単価${fmtYen(data.avgSpend)}は高水準、客数${projCust}人が課題`,
        body: `席の稼働率を確認。空き枠が多ければホットペッパーの枠開放を検討。フリー枠を増やして新規流入を確保。`,
        metric: `客単価 ${fmtYen(data.avgSpend)} / 客数着地 ${projCust}人`,
        priority: 'medium',
      })
    }
  }

  // ── 5. 集客 ────────────────────────────────────────────────────
  const nomRate = parseFloat(data.nominationRate)
  const newRate = parseFloat(data.newCustomerRate)

  if (!isNaN(newRate) && !isNaN(nomRate)) {
    if (nomRate < 60 && newRate < 10) {
      cols.push({
        category: '集客',
        icon: '\u{1F6A8}',
        title: `指名率${nomRate.toFixed(1)}%・新規率${newRate.toFixed(1)}% — 構造的課題`,
        body: `フリー客依存で新規流入も弱い。【短期】ホットペッパーのクーポン単価見直しで新規増。【中期】初回来店時に指名カード配布→フリー→指名転換を仕組み化。`,
        metric: `指名率 ${nomRate.toFixed(1)}% / 新規率 ${newRate.toFixed(1)}% / フリー率 ${data.freeRate}%`,
        priority: 'high',
      })
    } else if (newRate < 10) {
      cols.push({
        category: '集客',
        icon: '\u{1F4E2}',
        title: `新規率${newRate.toFixed(1)}% — 新規流入テコ入れ`,
        body: `ホットペッパーのアクセス数・予約転換率を確認。写真更新を週1回以上に。Instagramリール投稿を毎日実施→プロフリンクからの予約導線確保。口コミキャンペーンも有効。`,
        metric: `新規 ${data.newCustomers}人 / 新規率 ${newRate.toFixed(1)}%`,
        priority: 'medium',
      })
    } else if (nomRate > 80) {
      cols.push({
        category: '集客',
        icon: '\u{1F31F}',
        title: `指名率${nomRate.toFixed(1)}% — リピート基盤は盤石`,
        body: `高い指名率を活かし、来店サイクル短縮（30日以内）を狙う。ビューティーメリットのリマインド配信で定期来店を促進。`,
        metric: `指名率 ${nomRate.toFixed(1)}% / フリー ${data.freeRate}%`,
        priority: 'low',
      })
    }
  }

  // ── 6. リピート・アプリ ────────────────────────────────────────
  const appRate = parseFloat(data.appMemberRate)
  if (!isNaN(appRate) && appRate < 40) {
    const unregistered = data.totalUsers - data.appMembers
    cols.push({
      category: 'リピート',
      icon: '\u{1F4F1}',
      title: `アプリ未登録${unregistered.toLocaleString()}人 — プッシュ施策の土台強化`,
      body: `会員率${appRate.toFixed(1)}%ではクーポン配信の効果が限定的。会計時「アプリ登録で次回500円OFF」を全店統一ルールに。レジ横QRコードPOP設置。月間登録数を店舗KPIに追加。`,
      metric: `アプリ会員率 ${appRate.toFixed(1)}% / 未登録 ${unregistered.toLocaleString()}人`,
      priority: 'medium',
    })
  }

  if (data.newReturn3mRate !== '—') {
    const returnRate = parseFloat(data.newReturn3mRate)
    if (!isNaN(returnRate) && returnRate < 30) {
      cols.push({
        category: 'リピート',
        icon: '\u{1F504}',
        title: `BM新規リターン率${returnRate}% — 新規の${100 - returnRate}%が離脱`,
        body: `翌日サンクスLINE（施術写真+ケアアドバイス）→1週間後フォローDM→3週間後クーポン配信のフローをBMステップ配信で自動化。初回来店時の指名誘導も重要。`,
        metric: `BM新規3ヶ月リターン率 ${returnRate}% / 目安 40%以上`,
        priority: 'high',
      })
    }
  }

  // ── 7. 店舗間格差 ──────────────────────────────────────────────
  if (data.storeBreakdown.length >= 3) {
    const sorted = [...data.storeBreakdown].sort((a, b) => b.sales - a.sales)
    const top = sorted[0]
    const bottom = sorted[sorted.length - 1]
    const avg = data.storeBreakdown.reduce((s, v) => s + v.sales, 0) / data.storeBreakdown.length
    const belowAvg = sorted.filter(s => s.sales < avg * 0.7)

    if (belowAvg.length > 0 && top.sales > bottom.sales * 3 && bottom.sales > 0) {
      const storeNames = belowAvg.map(s => `${s.store}(${fmtMan(s.sales)})`).join('、')
      cols.push({
        category: '店舗',
        icon: '\u{1F3EA}',
        title: `${belowAvg.length}店舗が平均の7割以下`,
        body: `低調: ${storeNames}。稼働率（予約枠の埋まり率）を確認。空き枠が多ければエリア別クーポン配信、埋まっていれば単価UP（メニュー見直し）を優先。`,
        metric: `全店平均 ${fmtMan(Math.round(avg))} / TOP ${top.store} ${fmtMan(top.sales)}`,
        priority: 'high',
      })
    }
  }

  // ── 8. 売上トレンド ────────────────────────────────────────────
  if (data.dailyData.length >= 6) {
    const half = Math.floor(data.dailyData.length / 2)
    const firstHalf = data.dailyData.slice(0, half)
    const secondHalf = data.dailyData.slice(half)
    const firstAvg = firstHalf.reduce((s, d) => s + d.sales, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((s, d) => s + d.sales, 0) / secondHalf.length

    if (secondAvg < firstAvg * 0.85) {
      const dropPct = Math.round(((secondAvg - firstAvg) / firstAvg) * 100)
      cols.push({
        category: 'トレンド',
        icon: '\u{1F4C9}',
        title: `売上ペース${Math.abs(dropPct)}%ダウン（前半→後半）`,
        body: `直近の曜日別予約状況を確認。平日の空き枠にLINE限定クーポン、土日は予約満席に近づけるようリマインド配信。スタッフごとの稼働率もチェック。`,
        metric: `前半平均 ${fmtMan(Math.round(firstAvg))}/日 → 後半 ${fmtMan(Math.round(secondAvg))}/日`,
        priority: 'high',
      })
    } else if (secondAvg > firstAvg * 1.15) {
      const upPct = Math.round(((secondAvg - firstAvg) / firstAvg) * 100)
      cols.push({
        category: 'トレンド',
        icon: '\u{1F4C8}',
        title: `後半加速 — 日売上が前半比+${upPct}%`,
        body: `この勢いを月末まで維持。残り${remaining}日の予約状況を確認し、空き枠へのプッシュ配信を強化。`,
        metric: `前半平均 ${fmtMan(Math.round(firstAvg))}/日 → 後半 ${fmtMan(Math.round(secondAvg))}/日`,
        priority: 'low',
      })
    }
  }

  // 優先度順
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  cols.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return cols
}

function fmtYen(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}億`
  if (v >= 10_000) return `¥${Math.round(v / 10_000).toLocaleString()}万`
  return `¥${v.toLocaleString()}`
}

function fmtMan(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}億`
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString()}万`
  return `¥${v.toLocaleString()}`
}
