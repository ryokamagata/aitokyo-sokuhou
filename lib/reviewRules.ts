import type { DashboardData } from './types'

// ━━━ 型定義 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ReviewItem = {
  type: 'insight' | 'warning'  // insight = 複数データから読み取れるインサイト
  title: string
  detail: string
  action: string   // 必ず具体的アクション付き
  priority: number // 1=最重要, 2=重要, 3=参考
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
// GOODポイントは削除。見ればわかる。
// 複数データの掛け合わせで初めてわかるインサイト + 改善施策のみ出力。

export function generateMonthlyReview(data: DashboardData): ReviewItem[] {
  const items: ReviewItem[] = []
  const fd = data.forecastDetail
  const target = data.monthlyTarget
  const standard = fd?.standard ?? data.forecast.forecastTotal
  const remaining = data.daysInMonth - data.today

  // ── 目標未達時の具体的巻き返し策 ──────────────────────────────────
  if (target && target > 0) {
    const gap = standard - target
    if (gap < 0) {
      const shortfall = Math.abs(gap)
      const dailyNeeded = remaining > 0
        ? Math.round((target - data.totalSales) / remaining)
        : 0
      const currentDailyAvg = fd?.rationale.dailyAvg ?? 0
      const upliftPct = currentDailyAvg > 0
        ? Math.round(((dailyNeeded - currentDailyAvg) / currentDailyAvg) * 100)
        : 0

      items.push({
        type: 'warning',
        title: `目標まで残り${fmtMan(shortfall)}不足`,
        detail: `現ペース日平均${fmtMan(currentDailyAvg)}に対し、達成には日平均${fmtMan(dailyNeeded)}（+${upliftPct}%）が必要`,
        action: remaining > 10
          ? `週末の予約枠を最大化（空き枠にホットペッパーのクーポン即配信）。全スタッフにオプションメニュー1品追加提案を徹底。店長会議で残り${remaining}日の日次目標をセット`
          : `残り${remaining}日は全席稼働が前提。当日空き枠へのLINEプッシュ配信、既存客への次回予約確保の電話フォローを即実行`,
        priority: 1,
      })
    }
  }

  // ── 前年同月比マイナス時の構造分析 ─────────────────────────────────
  if (fd?.rationale.yoyGrowthRate !== null && fd?.rationale.yoyGrowthRate !== undefined) {
    const yoyRate = fd.rationale.yoyGrowthRate
    const prevYear = fd.rationale.prevYearSales
    if (yoyRate < -3 && prevYear) {
      // 客数 vs 客単価のどちらが原因かを切り分け
      const currentAvgSpend = data.avgSpend
      const totalCust = data.totalCustomers
      const daysPassed = Math.max(data.today, 1)
      const projectedCust = Math.round((totalCust / daysPassed) * data.daysInMonth)

      items.push({
        type: 'warning',
        title: `前年同月比${yoyRate.toFixed(1)}%ダウン`,
        detail: `前年${fmtYen(prevYear)}に対し着地${fmtYen(standard)}。客数着地${projectedCust}人・客単価${fmtYen(currentAvgSpend)}の両面から要因分析が必要`,
        action: currentAvgSpend < 8000
          ? '客単価が低い→カラー+トリートメントのセット提案率を店舗ミーティングで確認。スタッフごとのオプション提案率を可視化して朝礼で共有'
          : '客数が課題→ホットペッパーの掲載順位とクーポン設計を見直し。紹介カード配布数を各スタッフ月10枚以上に設定',
        priority: 1,
      })
    }
  }

  // ── 指名率×新規率の掛け合わせ分析 ─────────────────────────────────
  const nomRate = parseFloat(data.nominationRate)
  const newRate = parseFloat(data.newCustomerRate)
  const freeRateVal = parseFloat(data.freeRate)

  if (!isNaN(nomRate) && !isNaN(newRate)) {
    if (nomRate < 60 && newRate < 10) {
      // 指名低い + 新規も少ない = 構造的問題
      items.push({
        type: 'warning',
        title: '指名率・新規率ともに課題',
        detail: `指名率${nomRate.toFixed(1)}%・新規率${newRate.toFixed(1)}%。フリー客依存のまま新規流入も弱い構造`,
        action: '【短期】ホットペッパーのクーポン単価を見直して新規流入を増やす。【中期】フリー→指名転換のため、初回来店時にスタイリスト指名の声がけを仕組み化（会計時に次回指名カード配布）',
        priority: 1,
      })
    } else if (nomRate < 55) {
      items.push({
        type: 'warning',
        title: `指名率${nomRate.toFixed(1)}% — フリー依存リスク`,
        detail: `フリー客${freeRateVal.toFixed(1)}%は売上の変動要因。指名客は月の予約が安定し、キャンセル率も低い`,
        action: '各スタッフの指名返し率（フリー→2回目指名）を週次で追跡。30%以下のスタッフは接客後のフォロー（LINE追加・次回提案）を店長がOJTで支援',
        priority: 2,
      })
    } else if (newRate < 8) {
      items.push({
        type: 'warning',
        title: `新規率${newRate.toFixed(1)}% — 新規流入が停滞`,
        detail: `新規${data.newCustomers}人。既存客の自然減に対して新規補充が追いついていない可能性`,
        action: 'ホットペッパーのアクセス数・予約転換率を確認。写真の更新頻度を週1回以上に。Instagram投稿をスタッフ交代制で毎日実施→プロフィールリンクからの予約導線を確保',
        priority: 2,
      })
    }
  }

  // ── アプリ会員率からのLTV施策 ──────────────────────────────────────
  const appRate = parseFloat(data.appMemberRate)
  if (!isNaN(appRate) && appRate < 40) {
    const unregistered = data.totalUsers - data.appMembers
    items.push({
      type: 'warning',
      title: `アプリ未登録${unregistered.toLocaleString()}人 — リピート施策の土台が弱い`,
      detail: `アプリ会員率${appRate.toFixed(1)}%。プッシュ通知・クーポン配信の対象が限られ、リピート促進の打ち手が制限される`,
      action: '会計時にアプリ登録で次回500円OFFを全店舗統一ルールに。レジ横にQRコードPOP設置。月間登録数を店舗KPIに追加し、店長会議で追跡',
      priority: 2,
    })
  }

  // ── 新規3ヶ月リターン率が低い → 具体フォロー策 ────────────────────
  if (data.newReturn3mRate !== '—') {
    const returnRate = parseFloat(data.newReturn3mRate)
    if (!isNaN(returnRate) && returnRate < 30) {
      items.push({
        type: 'warning',
        title: `新規リターン率${returnRate}% — 新規客の7割が離脱`,
        detail: '新規獲得コストに対して定着率が低い。集客投資のROIが悪化している状態',
        action: '【翌日】サンクスLINE（施術写真+ホームケアアドバイス）。【1週間後】「その後いかがですか」フォローDM。【3週間後】次回クーポン配信。このフローをBMのステップ配信で自動化',
        priority: 1,
      })
    }
  }

  // ── 店舗間格差 → 具体的にどの店舗をテコ入れか ─────────────────────
  if (data.storeBreakdown.length >= 3) {
    const storeSales = data.storeBreakdown.map(s => s.sales)
    const cv = coefficientOfVariation(storeSales)
    const sorted = [...data.storeBreakdown].sort((a, b) => a.sales - b.sales)
    const avg = storeSales.reduce((s, v) => s + v, 0) / storeSales.length
    const belowAvg = sorted.filter(s => s.sales < avg * 0.7)

    if (cv > 0.35 && belowAvg.length > 0) {
      const storeNames = belowAvg.map(s => `${s.store}(${fmtMan(s.sales)})`).join('、')
      items.push({
        type: 'warning',
        title: `${belowAvg.length}店舗が全店平均の7割以下`,
        detail: `低調: ${storeNames}。全店平均${fmtMan(Math.round(avg))}に対して大きく下振れ`,
        action: '低調店舗の稼働率（予約枠の埋まり率）を確認。空き枠が多いなら集客施策（エリア別クーポン配信）、埋まっているなら客単価UP施策（メニュー提案の見直し）を優先',
        priority: 1,
      })
    }
  }

  // ── 日別トレンドの失速検知 ────────────────────────────────────────
  if (data.dailyData.length >= 6) {
    const half = Math.floor(data.dailyData.length / 2)
    const firstHalf = data.dailyData.slice(0, half)
    const secondHalf = data.dailyData.slice(half)
    const firstAvg = firstHalf.reduce((s, d) => s + d.sales, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((s, d) => s + d.sales, 0) / secondHalf.length
    const dropPct = firstAvg > 0 ? Math.round(((secondAvg - firstAvg) / firstAvg) * 100) : 0

    if (secondAvg < firstAvg * 0.85) {
      items.push({
        type: 'warning',
        title: `売上ペース${dropPct}%ダウン（前半→後半比較）`,
        detail: `前半日平均${fmtMan(Math.round(firstAvg))} → 後半${fmtMan(Math.round(secondAvg))}。このまま推移すると着地が下振れ`,
        action: '直近の曜日別予約状況を確認。平日の空き枠にはLINE限定クーポン、土日は予約満席に近づけるようリマインド配信。スタッフごとの稼働率もチェック',
        priority: 2,
      })
    }
  }

  // ── 客単価 × 客数の掛け合わせ分析 ─────────────────────────────────
  if (data.avgSpend > 0 && data.totalCustomers > 0 && fd) {
    const daysPassed = Math.max(data.today, 1)
    const projCust = Math.round((data.totalCustomers / daysPassed) * data.daysInMonth)

    if (data.avgSpend >= 10000 && projCust < 800) {
      items.push({
        type: 'insight',
        title: `客単価${fmtYen(data.avgSpend)}は高水準だが客数着地${projCust}人は少ない`,
        detail: '単価は取れているが、席の稼働率が低い可能性。売上の天井が客数で決まっている状態',
        action: '各店舗の1日あたり施術可能人数（席数×回転数）を算出し、空き枠率を可視化。フリー枠を増やすかホットペッパーの枠開放を検討',
        priority: 2,
      })
    } else if (data.avgSpend < 7000 && projCust > 1500) {
      items.push({
        type: 'insight',
        title: `客数${projCust}人見込みは好調だが客単価${fmtYen(data.avgSpend)}が低い`,
        detail: '集客は出来ているが、1人あたりの売上貢献が低い。カット単品の比率が高い可能性',
        action: '施術メニュー別の売上構成比を確認。カラー・パーマの同時施術率をスタッフ別に出し、提案トークの研修を実施。セットメニュー割引の導入も検討',
        priority: 2,
      })
    }
  }

  // ── スタッフ別の売上バラつき分析 ──────────────────────────────────
  if (data.staffBreakdown.length >= 4) {
    const staffSales = data.staffBreakdown.map(s => s.sales)
    const cv = coefficientOfVariation(staffSales)
    const top = data.staffBreakdown[0]
    const bottom = data.staffBreakdown[data.staffBreakdown.length - 1]
    const topBottomRatio = bottom.sales > 0 ? (top.sales / bottom.sales).toFixed(1) : '—'

    if (cv > 0.5 && top && bottom) {
      items.push({
        type: 'insight',
        title: `スタッフ間売上格差 ${topBottomRatio}倍（${top.staff} vs ${bottom.staff}）`,
        detail: `1位${top.staff}(${fmtMan(top.sales)}) / 最下位${bottom.staff}(${fmtMan(bottom.sales)})。上位の技術・接客ノウハウが属人化している可能性`,
        action: 'トップスタイリストの施術フロー・カウンセリング手法を動画化して共有。下位スタッフにはアシスタントとのペア施術で学ばせる体制を。月次1on1で目標設定と振り返り',
        priority: 2,
      })
    }
  }

  // 優先度順にソート
  items.sort((a, b) => a.priority - b.priority)

  return items
}

// ━━━ 年間レビュー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 年間も同様: 見ればわかるGOODは出さない。
// 掛け合わせインサイト＋経営判断に必要な改善提言のみ。

export function generateAnnualReview(input: AnnualReviewInput): ReviewItem[] {
  const items: ReviewItem[] = []
  const { projection, annualSummaries, staffSummary, totalMonthly } = input

  if (!projection) return items

  // ── 年間目標未達時の巻き返し策 ────────────────────────────────────
  if (projection.annualTarget && projection.annualTarget > 0) {
    const gap = projection.projectedTotal - projection.annualTarget
    if (gap < 0) {
      const shortfall = Math.abs(gap)
      const remainingMonths = 12 - projection.ytdMonths
      const monthlyNeeded = remainingMonths > 0 ? Math.round(shortfall / remainingMonths) : 0
      const currentMonthlyAvg = projection.ytdMonths > 0
        ? Math.round(projection.ytdTotal / projection.ytdMonths) : 0
      const upliftPct = currentMonthlyAvg > 0
        ? Math.round(((monthlyNeeded) / currentMonthlyAvg) * 100) : 0

      items.push({
        type: 'warning',
        title: `年間目標まで${fmtYen(shortfall)}不足`,
        detail: `残り${remainingMonths}ヶ月で月平均+${fmtMan(monthlyNeeded)}（現月平均比+${upliftPct}%）の上乗せが必要`,
        action: '【月次施策】高単価メニューの構成比を5%引き上げ（カラー+トリートメントのセット率向上）。【四半期施策】低調店舗のエリアマーケティング強化。【下半期】繁忙期（7-8月/12月）に集中キャンペーンで回収',
        priority: 1,
      })
    }
  }

  // ── 前年割れの構造分析 ────────────────────────────────────────────
  if (projection.yoyProjectedGrowth !== null && projection.yoyProjectedGrowth < 0) {
    const decline = projection.yoyProjectedGrowth
    // 月別で前年を下回っている月を特定
    const prevYearSummary = annualSummaries.find(s => s.year === projection.currentYear - 1)
    const weakMonths: string[] = []
    if (prevYearSummary) {
      for (const d of projection.monthDetails) {
        const prevMonth = prevYearSummary.monthDetails.find(m => m.month === d.month)
        if (prevMonth && !d.isProjected && d.sales < prevMonth.sales) {
          const dropPct = Math.round(((d.sales - prevMonth.sales) / prevMonth.sales) * 100)
          weakMonths.push(`${d.month}月(${dropPct}%)`)
        }
      }
    }

    items.push({
      type: 'warning',
      title: `前年比${decline.toFixed(1)}% — 年間で前年割れ見込み`,
      detail: weakMonths.length > 0
        ? `前年割れの月: ${weakMonths.join('、')}`
        : `前年${fmtYen(projection.prevYearTotal)}を下回るペース`,
      action: '前年割れ月の要因分析を（客数減 or 客単価減）。特定月の落ち込みが大きい場合は、その時期の競合動向・スタッフ異動・外部要因を洗い出し、今年の同時期に対策を先手で打つ',
      priority: 1,
    })
  }

  // ── 月別売上の季節変動 × 対策 ────────────────────────────────────
  const actualDetails = projection.monthDetails.filter(d => !d.isProjected)
  if (actualDetails.length >= 3) {
    const avgSales = actualDetails.reduce((s, d) => s + d.sales, 0) / actualDetails.length
    const weakMonths = actualDetails.filter(d => d.sales < avgSales * 0.8)
    const strongMonths = actualDetails.filter(d => d.sales > avgSales * 1.2)

    if (weakMonths.length > 0 && strongMonths.length > 0) {
      items.push({
        type: 'insight',
        title: '売上の季節変動が大きい',
        detail: `好調月: ${strongMonths.map(m => `${m.month}月(${fmtMan(m.sales)})`).join('、')} / 低調月: ${weakMonths.map(m => `${m.month}月(${fmtMan(m.sales)})`).join('、')}`,
        action: '低調月に先手でキャンペーン（梅雨時期のヘアケア訴求、閑散期の紹介割引など）を仕込む。繁忙月は席数最大化と単価UPに集中し、年間の波を均す戦略を',
        priority: 2,
      })
    }

    // 直近3ヶ月連続下落は警告
    const last3 = actualDetails.slice(-3)
    if (last3.length >= 3) {
      const isDeclining = last3.every((d, i) => i === 0 || d.sales < last3[i - 1].sales)
      if (isDeclining) {
        const dropTotal = last3[0].sales - last3[last3.length - 1].sales
        items.push({
          type: 'warning',
          title: '3ヶ月連続で売上減少中',
          detail: `${last3.map(d => `${d.month}月:${fmtMan(d.sales)}`).join(' → ')}（${fmtMan(dropTotal)}減）`,
          action: '単なる季節要因ではない可能性。スタッフ離職・競合出店・エリアの人口動態をチェック。構造的であれば、メニュー改定・ターゲット層の見直し・SNSマーケの刷新が必要',
          priority: 1,
        })
      }
    }
  }

  // ── 客数 × 客単価の年間トレンド ───────────────────────────────────
  if (totalMonthly.length >= 4) {
    const recent = totalMonthly.slice(-4)
    const avgSpends = recent
      .filter(m => m.customers > 0)
      .map(m => ({ month: m.month.slice(5), spend: Math.round(m.sales / m.customers), cust: m.customers }))

    if (avgSpends.length >= 3) {
      const first = avgSpends[0]
      const last = avgSpends[avgSpends.length - 1]
      const spendDiff = last.spend - first.spend
      const custDiff = last.cust - first.cust

      if (spendDiff < -300 && custDiff < 0) {
        items.push({
          type: 'warning',
          title: '客単価・客数ともに下落トレンド',
          detail: `客単価: ${fmtYen(first.spend)}→${fmtYen(last.spend)} / 客数: ${first.cust}→${last.cust}人`,
          action: '売上のダブルパンチ状態。客単価はセットメニュー導入で底上げ、客数はホットペッパーの掲載プランUPまたは新規チャネル（Instagram広告・Google Map対策）の開拓を同時並行で',
          priority: 1,
        })
      } else if (spendDiff < -300) {
        items.push({
          type: 'warning',
          title: `客単価が${fmtYen(Math.abs(spendDiff))}低下`,
          detail: `${first.month}月${fmtYen(first.spend)} → ${last.month}月${fmtYen(last.spend)}。客数は維持も1人あたり売上が減少`,
          action: 'メニュー構成を見直し。カット単品比率が上がっていないか確認。スタッフのアップセルトーク（カラー提案、トリートメント追加）の実施率をチェックし、週次朝礼でロープレ実施',
          priority: 2,
        })
      }

      // 客数だけ減少
      if (custDiff < -100 && spendDiff >= 0) {
        items.push({
          type: 'warning',
          title: '客数が減少トレンド（客単価は維持）',
          detail: `${first.month}月${first.cust}人 → ${last.month}月${last.cust}人。単価は保てているが分母が減っている`,
          action: '離脱顧客の分析を。60日以上未来店の休眠客リストを抽出し、復帰クーポンを配信。並行して新規流入チャネルの拡大を（MEO対策・インスタリール強化）',
          priority: 2,
        })
      }
    }
  }

  // ── スタッフ成長率の二極化分析 ────────────────────────────────────
  if (staffSummary.length >= 4) {
    const withGrowth = staffSummary.filter(s => s.growthRate !== null)
    const growing = withGrowth.filter(s => s.growthRate! > 10)
    const declining = withGrowth.filter(s => s.growthRate! < -10)

    if (growing.length >= 1 && declining.length >= 1) {
      const topGrowers = growing
        .sort((a, b) => (b.growthRate ?? 0) - (a.growthRate ?? 0))
        .slice(0, 3)
      const topDecliners = declining
        .sort((a, b) => (a.growthRate ?? 0) - (b.growthRate ?? 0))
        .slice(0, 3)

      items.push({
        type: 'insight',
        title: `スタッフ成長の二極化（上昇${growing.length}名 / 下降${declining.length}名）`,
        detail: `上昇: ${topGrowers.map(s => `${s.staff}(+${s.growthRate?.toFixed(0)}%)`).join(', ')} / 下降: ${topDecliners.map(s => `${s.staff}(${s.growthRate?.toFixed(0)}%)`).join(', ')}`,
        action: '上昇スタッフの成功要因（指名率・リピート率・メニュー単価）を分析し、下降スタッフへの横展開を。月次1on1で個人目標の設定と技術フィードバックの仕組みを構築',
        priority: 2,
      })
    } else if (declining.length >= 2) {
      items.push({
        type: 'warning',
        title: `${declining.length}名のスタッフが前月比-10%超`,
        detail: declining.slice(0, 3).map(s => `${s.staff}(${s.growthRate?.toFixed(0)}%)`).join(', '),
        action: '個別面談で課題をヒアリング（モチベーション・技術・顧客離れ）。アシスタントとのペア営業、先輩スタイリストのカウンセリング同席で立て直し支援',
        priority: 2,
      })
    }
  }

  // ── 堅実予測で目標未達 → リスクシナリオ ───────────────────────────
  if (projection.annualTarget && projection.annualTarget > 0) {
    const conservativeGap = projection.conservativeTotal - projection.annualTarget
    const optimisticGap = projection.optimisticTotal - projection.annualTarget

    if (conservativeGap < 0 && optimisticGap >= 0) {
      items.push({
        type: 'warning',
        title: '目標達成には攻めの経営が必要',
        detail: `堅実ライン${fmtYen(projection.conservativeTotal)}では目標未達。高め見込み${fmtYen(projection.optimisticTotal)}の実現が条件`,
        action: '守りの運営では未達確定。【攻め施策】新メニュー投入・繁忙期キャンペーン強化・新規チャネル開拓のいずれかで月次+5%の上乗せを目指す',
        priority: 2,
      })
    } else if (conservativeGap < 0 && optimisticGap < 0) {
      items.push({
        type: 'warning',
        title: '全シナリオで年間目標未達',
        detail: `高め見込み${fmtYen(projection.optimisticTotal)}でも目標${fmtYen(projection.annualTarget)}に届かない`,
        action: '目標の現実性を再検証。達成可能な修正目標を設定し直すか、出店計画・大型施策で構造的にトップラインを引き上げる判断が必要',
        priority: 1,
      })
    }
  }

  // 優先度順にソート
  items.sort((a, b) => a.priority - b.priority)

  return items
}
