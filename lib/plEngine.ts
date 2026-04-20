import {
  getCostAccounts,
  getCostActuals,
  getFixedCosts,
  getVariableRates,
  type CostAccount,
  type CostActual,
} from './db'

export type PLStage = 'month_start' | 'mid' | 'post_15' | 'post_17'
export type PLConfidence = 'low' | 'medium' | 'high' | 'final'

export type PLLine = {
  code: string
  name: string
  category: string
  pl_order: number
  amount: number
  source: 'actual' | 'variable' | 'fixed' | 'default'
}

export type PLForecastResult = {
  year: number
  month: number
  stage: PLStage
  confidence: PLConfidence
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
  // 科目別 source 統計（何件が確定/変動/固定/デフォルトで算出されたか）
  coverage: { actual: number; variable: number; fixed: number; default: number }
}

/**
 * 今日の日付からPL予測の stage を判定
 * @param targetYear / targetMonth 予測対象
 * @param todayIsoDate "YYYY-MM-DD" 形式（JST）
 */
export function detectStage(targetYear: number, targetMonth: number, todayIsoDate: string): PLStage {
  const [yStr, mStr, dStr] = todayIsoDate.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10)
  const d = parseInt(dStr, 10)

  // 過去月: 当該月の翌月17日を過ぎていれば確定取込済み想定
  const targetEpoch = targetYear * 12 + targetMonth
  const todayEpoch = y * 12 + m
  if (targetEpoch < todayEpoch) {
    // 翌月だが今日が17日未満なら post_15 扱い（まだ確定取込前）
    if (targetEpoch + 1 === todayEpoch && d < 17) return 'post_15'
    return 'post_17'
  }
  if (targetEpoch > todayEpoch) return 'month_start'
  // 当月
  if (d >= 15) return 'post_15'
  if (d >= 7) return 'mid'
  return 'month_start'
}

/** ステージ × 売上信頼度から PL 信頼度を導出 */
export function stageConfidence(stage: PLStage, salesConfidence: 'low' | 'medium' | 'high'): PLConfidence {
  if (stage === 'post_17') return 'final'
  if (stage === 'post_15') return salesConfidence === 'low' ? 'medium' : 'high'
  if (stage === 'mid') return salesConfidence === 'high' ? 'medium' : 'low'
  return 'low'
}

/**
 * MVP のデフォルト比率（seed が未実行のときのフォールバック）
 * 美容室業界標準 + AI TOKYO の利益率5%目標に合わせて調整
 */
const DEFAULT_VARIABLE_RATES: Record<string, number> = {
  cogs_drugs: 0.08,
  cogs_card_fee: 0.036,
  cogs_other: 0.01,
  personnel_commission: 0.10,
  promo_platform: 0.04,
}

const DEFAULT_REVENUE_SHARE: Record<string, number> = {
  // 固定給・法定福利・家賃・広告宣伝などの大枠 (%, 売上比)
  personnel_fixed: 0.35,
  personnel_social: 0.04,
  personnel_welfare: 0.01,
  rent: 0.10,
  rent_common: 0.01,
  utility: 0.015,
  promo_ad: 0.02,
  sga_supplies: 0.015,
  sga_comm: 0.005,
  sga_outsource: 0.02,
  sga_travel: 0.005,
  sga_depreciation: 0.015,
  sga_other: 0.015,
}

export type PLEngineInput = {
  year: number
  month: number
  todayIsoDate: string
  revenue: number
  salesConfidence: 'low' | 'medium' | 'high'
}

export function computePLForecast(input: PLEngineInput): PLForecastResult {
  const { year, month, todayIsoDate, revenue, salesConfidence } = input
  const stage = detectStage(year, month, todayIsoDate)
  const confidence = stageConfidence(stage, salesConfidence)

  const accounts = getCostAccounts()
  const actuals = getCostActuals(year, month)
  const variableRates = getVariableRates(year, month)
  const fixedCosts = getFixedCosts(year, month)

  // 全社合算（store=NULL）のみを MVP スコープとする
  const actualByCode = new Map<string, number>()
  for (const a of actuals) {
    if (a.store !== null) continue
    actualByCode.set(a.account_code, (actualByCode.get(a.account_code) ?? 0) + a.amount)
  }
  const variableByCode = new Map<string, number>()
  for (const r of variableRates) {
    if (r.store !== null) continue
    if (r.driver !== 'revenue') continue
    variableByCode.set(r.account_code, r.rate)
  }
  const fixedByCode = new Map<string, number>()
  for (const f of fixedCosts) {
    if (f.store !== null) continue
    fixedByCode.set(f.account_code, (fixedByCode.get(f.account_code) ?? 0) + f.amount)
  }

  const lines: PLLine[] = []
  const coverage = { actual: 0, variable: 0, fixed: 0, default: 0 }

  for (const acc of accounts) {
    if (acc.category === 'revenue') {
      lines.push({
        code: acc.code,
        name: acc.name,
        category: acc.category,
        pl_order: acc.pl_order,
        amount: revenue,
        source: 'actual',
      })
      coverage.actual++
      continue
    }
    if (acc.category === 'non_op') continue

    // 優先順: 確定実績 → 固定費 → 変動費率 → デフォルト
    let amount = 0
    let source: PLLine['source'] = 'default'

    if (actualByCode.has(acc.code)) {
      amount = actualByCode.get(acc.code)!
      source = 'actual'
      coverage.actual++
    } else if (fixedByCode.has(acc.code)) {
      amount = fixedByCode.get(acc.code)!
      source = 'fixed'
      coverage.fixed++
    } else if (variableByCode.has(acc.code)) {
      amount = Math.round(revenue * variableByCode.get(acc.code)!)
      source = 'variable'
      coverage.variable++
    } else if (DEFAULT_VARIABLE_RATES[acc.code] !== undefined) {
      amount = Math.round(revenue * DEFAULT_VARIABLE_RATES[acc.code])
      source = 'default'
      coverage.default++
    } else if (DEFAULT_REVENUE_SHARE[acc.code] !== undefined) {
      amount = Math.round(revenue * DEFAULT_REVENUE_SHARE[acc.code])
      source = 'default'
      coverage.default++
    } else {
      coverage.default++
    }

    lines.push({
      code: acc.code,
      name: acc.name,
      category: acc.category,
      pl_order: acc.pl_order,
      amount,
      source,
    })
  }

  const sumCategory = (cat: string) =>
    lines.filter(l => l.category === cat).reduce((s, l) => s + l.amount, 0)

  const cogs = sumCategory('cogs')
  const personnel = sumCategory('personnel')
  const rent = sumCategory('rent')
  const utility = sumCategory('utility')
  const promo = sumCategory('promo')
  const otherSga = sumCategory('other_sga')
  const grossProfit = revenue - cogs
  const operatingProfit = grossProfit - personnel - rent - utility - promo - otherSga
  const opMargin = revenue > 0 ? operatingProfit / revenue : 0

  return {
    year, month, stage, confidence,
    revenue, cogs, grossProfit,
    personnel, rent, promo, utility, otherSga,
    operatingProfit, opMargin,
    lines,
    coverage,
  }
}

/** 過去月の実績ベース PL を組み立てる（確定値のみ、未入力科目はゼロ） */
export function buildActualPL(year: number, month: number): PLForecastResult {
  const accounts = getCostAccounts()
  const actuals = getCostActuals(year, month)

  const actualByCode = new Map<string, number>()
  for (const a of actuals) {
    if (a.store !== null) continue
    actualByCode.set(a.account_code, (actualByCode.get(a.account_code) ?? 0) + a.amount)
  }

  const revenue = actualByCode.get('revenue') ?? 0
  const lines: PLLine[] = []
  const coverage = { actual: 0, variable: 0, fixed: 0, default: 0 }

  for (const acc of accounts) {
    if (acc.category === 'non_op') continue
    const amount = actualByCode.get(acc.code) ?? 0
    if (amount > 0) coverage.actual++
    lines.push({
      code: acc.code,
      name: acc.name,
      category: acc.category,
      pl_order: acc.pl_order,
      amount,
      source: actualByCode.has(acc.code) ? 'actual' : 'default',
    })
  }

  const sumCategory = (cat: string) =>
    lines.filter(l => l.category === cat).reduce((s, l) => s + l.amount, 0)

  const cogs = sumCategory('cogs')
  const personnel = sumCategory('personnel')
  const rent = sumCategory('rent')
  const utility = sumCategory('utility')
  const promo = sumCategory('promo')
  const otherSga = sumCategory('other_sga')
  const grossProfit = revenue - cogs
  const operatingProfit = grossProfit - personnel - rent - utility - promo - otherSga
  const opMargin = revenue > 0 ? operatingProfit / revenue : 0

  const today = new Date().toISOString().slice(0, 10)

  return {
    year, month,
    stage: detectStage(year, month, today),
    confidence: 'final',
    revenue, cogs, grossProfit,
    personnel, rent, promo, utility, otherSga,
    operatingProfit, opMargin,
    lines,
    coverage,
  }
}

/** CostActual の配列から、変動費率と固定費を逆算して返す（seed 用） */
export function deriveParamsFromActuals(recent: CostActual[], accounts: CostAccount[]): {
  variableRates: { account_code: string; rate: number; driver: 'revenue' }[]
  fixedCosts: { account_code: string; amount: number }[]
} {
  // 月ごとに revenue と各科目の合計を集計
  const months = new Map<string, { revenue: number; byCode: Map<string, number> }>()
  for (const r of recent) {
    if (r.store !== null) continue
    const key = `${r.year}-${r.month}`
    if (!months.has(key)) months.set(key, { revenue: 0, byCode: new Map() })
    const m = months.get(key)!
    if (r.account_code === 'revenue') m.revenue += r.amount
    else m.byCode.set(r.account_code, (m.byCode.get(r.account_code) ?? 0) + r.amount)
  }

  const rates: { account_code: string; rate: number; driver: 'revenue' }[] = []
  const fixed: { account_code: string; amount: number }[] = []

  for (const acc of accounts) {
    if (acc.category === 'revenue' || acc.category === 'non_op') continue
    const samples: number[] = []
    const samplesRate: number[] = []
    for (const m of months.values()) {
      const v = m.byCode.get(acc.code) ?? 0
      if (v === 0) continue
      samples.push(v)
      if (m.revenue > 0) samplesRate.push(v / m.revenue)
    }
    if (samples.length === 0) continue

    // 変動係数 CV で判定: CV < 15% なら固定費、>= 15% なら変動費率
    const mean = samples.reduce((s, x) => s + x, 0) / samples.length
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
    const stdDev = Math.sqrt(variance)
    const cv = mean > 0 ? stdDev / mean : 0

    if (cv < 0.15 && acc.is_variable === 0) {
      fixed.push({ account_code: acc.code, amount: Math.round(mean) })
    } else if (samplesRate.length > 0) {
      // 中央値を使う（外れ値に強い）
      samplesRate.sort((a, b) => a - b)
      const median = samplesRate[Math.floor(samplesRate.length / 2)]
      rates.push({ account_code: acc.code, rate: Math.round(median * 10000) / 10000, driver: 'revenue' })
    } else {
      fixed.push({ account_code: acc.code, amount: Math.round(mean) })
    }
  }

  return { variableRates: rates, fixedCosts: fixed }
}
