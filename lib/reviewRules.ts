import type { DashboardData } from './types'

// ━━━ 型定義 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ReviewItem = {
  type: 'good' | 'warning'
  title: string
  detail: string
  action?: string
}

// 年間用の型（HistoryView側の型に合わせる）
export type AnnualReviewInput = {
  projection: {
    currentYear: number
    projectedTotal: number
    projectedCustomers: number
    ytdTotal: number
    ytdCustomers: number
    ytdMonths: number
    avgYoYGrowthRate: number | null
    monthDetails: { month: number; sales: number; customers: number; isProjected: boolean }[]
    prevYearTotal: number
    yoyProjectedGrowth: number | null
    currentMonthEstimate: number | null
    conservativeTotal: number
    optimisticTotal: number
    annualTarget: number | null
  } | null
  annualSummaries: {
    year: number
    total: number
    customers: number
    monthDetails: { month: number; sales: number; customers: number; isProjected: boolean }[]
    isComplete: boolean
    actualMonths: number
  }[]
  staffSummary: {
    staff: string
    baseSales: number
    prevSales: number
    currentSales: number
    growthRate: number | null
  }[]
  totalMonthly: { month: string; sales: number; customers: number }[]
}

// ━━━ ヘルパー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fmtYen = (v: number): string => {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}億`
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString()}万`
  return `¥${v.toLocaleString()}`
}

const fmtMan = (v: number): string => `${Math.round(v / 10_000).toLocaleString()}万`

// 変動係数（CV）: 標準偏差 / 平均
function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

// ━━━ 月次レビュー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function generateMonthlyReview(data: DashboardData): ReviewItem[] {
  const items: ReviewItem[] = []
  const fd = data.forecastDetail
  const target = data.monthlyTarget
  const standard = fd?.standard ?? data.forecast.forecastTotal
  const remaining = data.daysInMonth - data.today

  // ── 1. 着地予測 vs 目標 ──────────────────────────────────────────────
  if (target && target > 0) {
    const gap = standard - target
    if (gap >= 0) {
      items.push({
        type: 'good',
        title: '目標達成見込み',
        detail: `着地予測${fmtYen(standard)}は目標を+${fmtMan(gap)}上回っています`,
        action: 'この勢いを維持。上位スタッフの施術メニュー拡充やオプション提案で更なる上乗せも可能',
      })
    } else {
      const dailyNeeded = remaining > 0
        ? Math.round((target - data.totalSales) / remaining)
        : 0
      items.push({
        type: 'warning',
        title: '目標未達見込み',
        detail: `着地予測${fmtYen(standard)}は目標に${fmtMan(Math.abs(gap))}不足`,
        action: remaining > 0
          ? `残り${remaining}日で日平均${fmtMan(dailyNeeded)}が必要。高単価メニューの提案・次回予約の確保を強化`
          : '目標設定の見直しを検討',
      })
    }
  }

  // ── 2. 前年同月比 ───────────────────────────────────────────────────
  if (fd?.rationale.yoyGrowthRate !== null && fd?.rationale.yoyGrowthRate !== undefined) {
    const yoyRate = fd.rationale.yoyGrowthRate
    const prevYear = fd.rationale.prevYearSales
    if (yoyRate > 0) {
      items.push({
        type: 'good',
        title: `前年同月比+${yoyRate.toFixed(1)}%`,
        detail: prevYear
          ? `昨年同月の実績${fmtYen(prevYear)}を上回るペースで推移中`
          : '昨年同月を上回るペースで推移中',
      })
    } else if (yoyRate < -5) {
      items.push({
        type: 'warning',
        title: `前年同月比${yoyRate.toFixed(1)}%`,
        detail: prevYear
          ? `昨年同月${fmtYen(prevYear)}を下回るペース`
          : '昨年同月を下回るペース',
        action: '集客強化（SNS発信・紹介キャンペーン）と客単価UP施策の併用を',
      })
    }
  }

  // ── 3. 指名率 ──────────────────────────────────────────────────────
  const nomRate = parseFloat(data.nominationRate)
  if (!isNaN(nomRate)) {
    if (nomRate >= 70) {
      items.push({
        type: 'good',
        title: `指名率${nomRate.toFixed(1)}% — 高水準`,
        detail: 'リピーターの指名定着が順調。顧客満足度の高さを反映',
      })
    } else if (nomRate < 55) {
      items.push({
        type: 'warning',
        title: `指名率${nomRate.toFixed(1)}% — 改善余地あり`,
        detail: `フリー客が全体の${data.freeRate}%を占めています`,
        action: 'スタッフ紹介カード・次回指名割引の導入で指名転換を促進',
      })
    }
  }

  // ── 4. 新規率 ──────────────────────────────────────────────────────
  const newRate = parseFloat(data.newCustomerRate)
  if (!isNaN(newRate)) {
    if (newRate >= 15) {
      items.push({
        type: 'good',
        title: `新規率${newRate.toFixed(1)}% — 集客好調`,
        detail: `新規${data.newCustomers}人、着地予測${data.newCustomerForecast}人`,
        action: '新規の2回目来店フォロー（DM・LINE）でリピート転換を強化',
      })
    } else if (newRate < 8) {
      items.push({
        type: 'warning',
        title: `新規率${newRate.toFixed(1)}% — 新規集客の強化を`,
        detail: `新規${data.newCustomers}人にとどまり、集客に課題`,
        action: 'ホットペッパー・SNS広告・紹介キャンペーンで新規流入を増加させる',
      })
    }
  }

  // ── 5. アプリ会員率 ────────────────────────────────────────────────
  const appRate = parseFloat(data.appMemberRate)
  if (!isNaN(appRate)) {
    if (appRate >= 55) {
      items.push({
        type: 'good',
        title: `アプリ会員率${appRate.toFixed(1)}%`,
        detail: `${data.appMembers.toLocaleString()}人がアプリ登録済み`,
      })
    } else if (appRate < 40) {
      const unregistered = data.totalUsers - data.appMembers
      items.push({
        type: 'warning',
        title: `アプリ会員率${appRate.toFixed(1)}% — 普及不足`,
        detail: `未登録${unregistered.toLocaleString()}人。プッシュ通知・予約の利便性を活かしきれていない`,
        action: '来店時の登録声がけを徹底。会計時にQRコード提示でスムーズな登録導線を',
      })
    }
  }

  // ── 6. 客単価 ──────────────────────────────────────────────────────
  if (data.avgSpend > 0 && fd?.rationale.prevYearSales && fd.rationale.yoyEstimate) {
    // 前年の客単価概算は直接取れないが、前年売上と成長率から推測
    // 客単価自体の良し悪しを判定（美容室の一般的な水準で）
    if (data.avgSpend >= 10000) {
      items.push({
        type: 'good',
        title: `客単価${fmtYen(data.avgSpend)} — 高水準`,
        detail: '高単価メニューが定着。顧客あたりの収益性が高い',
      })
    } else if (data.avgSpend < 7000) {
      items.push({
        type: 'warning',
        title: `客単価${fmtYen(data.avgSpend)} — 改善余地`,
        detail: '客単価が低めの水準',
        action: 'トリートメント・ヘッドスパ等のオプションメニュー提案を強化',
      })
    }
  }

  // ── 7. 新規3ヶ月リターン率 ─────────────────────────────────────────
  if (data.newReturn3mRate !== '—') {
    const returnRate = parseFloat(data.newReturn3mRate)
    if (!isNaN(returnRate)) {
      if (returnRate >= 40) {
        items.push({
          type: 'good',
          title: `新規リターン率${returnRate}% — 定着力◎`,
          detail: '新規客の4割以上が3ヶ月以内に再来店',
        })
      } else if (returnRate < 25) {
        items.push({
          type: 'warning',
          title: `新規リターン率${returnRate}% — 再来店フォロー強化`,
          detail: '新規客の再来店率が低い。初回体験後の離脱が課題',
          action: '来店翌日のお礼LINE・2週間後のフォローDM・次回割引クーポンで再来を促進',
        })
      }
    }
  }

  // ── 8. 店舗間格差 ──────────────────────────────────────────────────
  if (data.storeBreakdown.length >= 2) {
    const storeSales = data.storeBreakdown.map(s => s.sales)
    const cv = coefficientOfVariation(storeSales)
    const topStore = data.storeBreakdown[0]
    const bottomStore = data.storeBreakdown[data.storeBreakdown.length - 1]

    if (cv > 0.4 && topStore && bottomStore) {
      items.push({
        type: 'warning',
        title: '店舗間の売上格差が大きい',
        detail: `最高${topStore.store}(${fmtMan(topStore.sales)}) vs 最低${bottomStore.store}(${fmtMan(bottomStore.sales)})`,
        action: '低調店舗の集客施策・人員配置の見直しを検討',
      })
    } else if (cv <= 0.2 && data.storeBreakdown.length >= 3) {
      items.push({
        type: 'good',
        title: '店舗間バランスが良好',
        detail: '各店舗の売上が均等に分散しています',
      })
    }
  }

  // ── 9. 日別売上トレンド ────────────────────────────────────────────
  if (data.dailyData.length >= 6) {
    const half = Math.floor(data.dailyData.length / 2)
    const firstHalf = data.dailyData.slice(0, half)
    const secondHalf = data.dailyData.slice(half)
    const firstAvg = firstHalf.reduce((s, d) => s + d.sales, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((s, d) => s + d.sales, 0) / secondHalf.length

    if (secondAvg > firstAvg * 1.1) {
      items.push({
        type: 'good',
        title: '売上加速中',
        detail: `後半の日平均${fmtMan(Math.round(secondAvg))}は前半${fmtMan(Math.round(firstAvg))}を上回る`,
      })
    } else if (secondAvg < firstAvg * 0.85) {
      items.push({
        type: 'warning',
        title: '売上ペースが鈍化',
        detail: `後半の日平均${fmtMan(Math.round(secondAvg))}は前半${fmtMan(Math.round(firstAvg))}を下回る`,
        action: '週末・祝日の予約枠確認と、空き枠への集客施策（当日割引など）を',
      })
    }
  }

  // GOODを先、warningを後にソート
  items.sort((a, b) => {
    if (a.type === 'good' && b.type === 'warning') return -1
    if (a.type === 'warning' && b.type === 'good') return 1
    return 0
  })

  return items
}

// ━━━ 年間レビュー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function generateAnnualReview(input: AnnualReviewInput): ReviewItem[] {
  const items: ReviewItem[] = []
  const { projection, annualSummaries, staffSummary, totalMonthly } = input

  if (!projection) return items

  // ── 1. 年間目標 vs 着地予測 ────────────────────────────────────────
  if (projection.annualTarget && projection.annualTarget > 0) {
    const gap = projection.projectedTotal - projection.annualTarget
    if (gap >= 0) {
      items.push({
        type: 'good',
        title: '年間目標達成見込み',
        detail: `着地予測${fmtYen(projection.projectedTotal)}は年間目標${fmtYen(projection.annualTarget)}を+${fmtYen(gap)}上回る`,
        action: '目標上振れ分を新規出店・設備投資・スタッフ教育に活用するチャンス',
      })
    } else {
      const shortfall = Math.abs(gap)
      const remainingMonths = 12 - projection.ytdMonths
      const monthlyNeeded = remainingMonths > 0 ? Math.round(shortfall / remainingMonths) : 0
      items.push({
        type: 'warning',
        title: '年間目標に未達見込み',
        detail: `着地予測${fmtYen(projection.projectedTotal)}は目標に${fmtYen(shortfall)}不足`,
        action: remainingMonths > 0
          ? `残り${remainingMonths}ヶ月で月平均+${fmtMan(monthlyNeeded)}の上乗せが必要`
          : '来期の目標設定・戦略を見直し',
      })
    }
  }

  // ── 2. 前年比成長 ──────────────────────────────────────────────────
  if (projection.yoyProjectedGrowth !== null) {
    const growth = projection.yoyProjectedGrowth
    if (growth > 5) {
      items.push({
        type: 'good',
        title: `前年比+${growth.toFixed(1)}%成長見込み`,
        detail: `前年${fmtYen(projection.prevYearTotal)} → 今年着地${fmtYen(projection.projectedTotal)}`,
      })
    } else if (growth > 0) {
      items.push({
        type: 'good',
        title: `前年比+${growth.toFixed(1)}%の微増`,
        detail: `前年${fmtYen(projection.prevYearTotal)}からの伸びが鈍化傾向`,
        action: '下半期の成長加速施策（新メニュー・キャンペーン）を検討',
      })
    } else {
      items.push({
        type: 'warning',
        title: `前年比${growth.toFixed(1)}% — 前年割れ見込み`,
        detail: `前年${fmtYen(projection.prevYearTotal)}を下回る可能性`,
        action: '売上回復に向けた集客強化・客単価UP・リピート率改善の3軸で対策を',
      })
    }
  }

  // ── 3. 完了月の前年同月比トレンド ──────────────────────────────────
  if (projection.avgYoYGrowthRate !== null) {
    const avgRate = projection.avgYoYGrowthRate
    if (avgRate > 10) {
      items.push({
        type: 'good',
        title: `完了月の平均YoY+${avgRate.toFixed(1)}%`,
        detail: '安定した前年超えを継続中',
      })
    } else if (avgRate < -5) {
      items.push({
        type: 'warning',
        title: `完了月の平均YoY${avgRate.toFixed(1)}%`,
        detail: '複数月で前年を下回る傾向',
        action: '月別の落ち込み要因を分析し、テコ入れすべき月を特定',
      })
    }
  }

  // ── 4. 月別トレンド（連続成長 or 下落） ────────────────────────────
  const actualDetails = projection.monthDetails.filter(d => !d.isProjected)
  if (actualDetails.length >= 3) {
    // 直近3ヶ月が連続成長？
    const last3 = actualDetails.slice(-3)
    const isGrowing = last3.every((d, i) => i === 0 || d.sales > last3[i - 1].sales)
    const isDeclining = last3.every((d, i) => i === 0 || d.sales < last3[i - 1].sales)

    if (isGrowing) {
      items.push({
        type: 'good',
        title: '直近3ヶ月連続で売上増加',
        detail: last3.map(d => `${d.month}月:${fmtMan(d.sales)}`).join(' → '),
        action: '成長の勢いを活かし、さらなる施策を展開',
      })
    } else if (isDeclining) {
      items.push({
        type: 'warning',
        title: '直近3ヶ月連続で売上減少',
        detail: last3.map(d => `${d.month}月:${fmtMan(d.sales)}`).join(' → '),
        action: '減少要因の分析を。季節要因か構造的課題かを見極め、対策を早急に',
      })
    }
  }

  // ── 5. 客数トレンド ────────────────────────────────────────────────
  if (totalMonthly.length >= 3) {
    const recentMonths = totalMonthly.slice(-3)
    const custTrend = recentMonths.map(m => m.customers)
    const custGrowing = custTrend.every((c, i) => i === 0 || c > custTrend[i - 1])
    const custDeclining = custTrend.every((c, i) => i === 0 || c < custTrend[i - 1])

    if (custGrowing) {
      items.push({
        type: 'good',
        title: '客数が増加傾向',
        detail: `直近3ヶ月: ${recentMonths.map(m => `${m.customers}人`).join(' → ')}`,
      })
    } else if (custDeclining) {
      items.push({
        type: 'warning',
        title: '客数が減少傾向',
        detail: `直近3ヶ月: ${recentMonths.map(m => `${m.customers}人`).join(' → ')}`,
        action: '新規集客とリピート率の両面から客数回復施策を',
      })
    }
  }

  // ── 6. 客単価の年間推移 ────────────────────────────────────────────
  if (totalMonthly.length >= 2) {
    const recent = totalMonthly.slice(-3)
    const avgSpends = recent
      .filter(m => m.customers > 0)
      .map(m => Math.round(m.sales / m.customers))

    if (avgSpends.length >= 2) {
      const latest = avgSpends[avgSpends.length - 1]
      const prev = avgSpends[0]
      const diff = latest - prev

      if (diff > 500) {
        items.push({
          type: 'good',
          title: `客単価上昇傾向（${fmtYen(latest)}）`,
          detail: `${fmtYen(prev)} → ${fmtYen(latest)}へ向上`,
        })
      } else if (diff < -500) {
        items.push({
          type: 'warning',
          title: `客単価下落傾向（${fmtYen(latest)}）`,
          detail: `${fmtYen(prev)} → ${fmtYen(latest)}に低下`,
          action: 'メニュー単価の見直し・オプション提案の強化を',
        })
      }
    }
  }

  // ── 7. スタッフ成長分析 ────────────────────────────────────────────
  if (staffSummary.length >= 3) {
    const growing = staffSummary.filter(s => s.growthRate !== null && s.growthRate > 10)
    const declining = staffSummary.filter(s => s.growthRate !== null && s.growthRate < -10)

    if (growing.length >= 2) {
      const topGrowers = growing
        .sort((a, b) => (b.growthRate ?? 0) - (a.growthRate ?? 0))
        .slice(0, 3)
      items.push({
        type: 'good',
        title: `${growing.length}名のスタッフが前月比+10%超`,
        detail: topGrowers.map(s => `${s.staff}(+${s.growthRate?.toFixed(0)}%)`).join(', '),
      })
    }

    if (declining.length >= 2) {
      items.push({
        type: 'warning',
        title: `${declining.length}名のスタッフが前月比-10%超の下落`,
        detail: '複数スタッフの売上が落ちている',
        action: '個別面談でモチベーション・技術面の課題をヒアリングし、サポート体制を構築',
      })
    }
  }

  // ── 8. 堅実〜高めの予測幅 ─────────────────────────────────────────
  if (projection.annualTarget && projection.annualTarget > 0) {
    const conservativeVsTarget = projection.conservativeTotal - projection.annualTarget
    if (conservativeVsTarget >= 0) {
      items.push({
        type: 'good',
        title: '堅実予測でも年間目標達成',
        detail: `堅実ライン${fmtYen(projection.conservativeTotal)}でも目標をクリア`,
      })
    } else if (projection.optimisticTotal >= projection.annualTarget) {
      items.push({
        type: 'warning',
        title: '目標達成には高め見込みの実現が必要',
        detail: `堅実${fmtYen(projection.conservativeTotal)}〜高め${fmtYen(projection.optimisticTotal)}（目標${fmtYen(projection.annualTarget)}）`,
        action: '後半に攻めの施策を打ち、高め見込みの実現を目指す',
      })
    }
  }

  // GOODを先、warningを後にソート
  items.sort((a, b) => {
    if (a.type === 'good' && b.type === 'warning') return -1
    if (a.type === 'warning' && b.type === 'good') return 1
    return 0
  })

  return items
}
