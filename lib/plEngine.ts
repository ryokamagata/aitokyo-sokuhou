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

// 日本の美容業会計に合わせたカテゴリ構造
// - revenue: 売上高
// - cogs: 売上原価 (人件費含む)
// - sga: 販売費及び一般管理費
// - non_op: 営業外損益
export type Category = 'revenue' | 'cogs' | 'sga' | 'non_op'

// subcategory は category 内の内訳用ラベル
// - material (原価の材料・仕入), personnel (人件費), promo (広告宣伝), rent, utility, other, income, expense
export type Subcategory = 'revenue' | 'material' | 'personnel' | 'promo' | 'rent' | 'utility' | 'other' | 'income' | 'expense'

export type PLLine = {
  code: string
  name: string
  category: Category
  subcategory: Subcategory
  pl_order: number
  amount: number
  source: 'actual' | 'variable' | 'fixed' | 'default' | 'empty'
}

export type PLForecastResult = {
  year: number
  month: number
  stage: PLStage
  confidence: PLConfidence
  revenue: number
  cogs: number
  sga: number
  grossProfit: number
  operatingProfit: number
  opMargin: number
  // subcategory 集計
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
  breakEvenRevenue: number  // 損益分岐点売上高
}

export function detectStage(targetYear: number, targetMonth: number, todayIsoDate: string): PLStage {
  const [yStr, mStr, dStr] = todayIsoDate.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10)
  const d = parseInt(dStr, 10)
  const targetEpoch = targetYear * 12 + targetMonth
  const todayEpoch = y * 12 + m
  if (targetEpoch < todayEpoch) {
    if (targetEpoch + 1 === todayEpoch && d < 17) return 'post_15'
    return 'post_17'
  }
  if (targetEpoch > todayEpoch) return 'month_start'
  if (d >= 15) return 'post_15'
  if (d >= 7) return 'mid'
  return 'month_start'
}

export function stageConfidence(stage: PLStage, salesConfidence: 'low' | 'medium' | 'high'): PLConfidence {
  if (stage === 'post_17') return 'final'
  if (stage === 'post_15') return salesConfidence === 'low' ? 'medium' : 'high'
  if (stage === 'mid') return salesConfidence === 'high' ? 'medium' : 'low'
  return 'low'
}

// AI TOKYO 実績（2025/09-2026/03）から算出したデフォルト値
// 変動費率（売上比）
const DEFAULT_VARIABLE_RATES: Record<string, number> = {
  cogs_purchase:      0.009,  // 仕入高
  cogs_drugs:         0.052,  // 材料費（薬剤）
  cogs_professional:  0.229,  // プロ契約給与（業務委託美容師）
  cogs_supplies_shop: 0.013,  // 店舗消耗品
  sga_banking:        0.017,  // 支払手数料（カード・振込）
}

// 固定費デフォルト（月次平均、円）
const DEFAULT_FIXED_COSTS: Record<string, number> = {
  cogs_salon_salary:  19_700_000, // サロン正社員給与
  cogs_social:         2_400_000, // 法定福利費
  cogs_commute:          745_000, // 通勤手当
  cogs_promo_recruit:  5_630_000, // 採用広告(リクルート)
  cogs_comm_shop:        356_000, // 店舗通信
  cogs_utility_shop:     181_000, // 店舗水光
  cogs_fee_employee:      -6_800, // マイナス計上
  sga_executive:       1_500_000, // 役員報酬
  sga_rent:           11_200_000, // 店舗家賃（全店合計）
  sga_welfare:           278_000,
  sga_shipping:           43_000,
  sga_promo:             287_000,
  sga_entertainment:     885_000,
  sga_travel:            216_000,
  sga_comm:              714_000, // 本社通信費
  sga_utility:           118_000,
  sga_supplies:          481_000,
  sga_lease:             245_000,
  sga_insurance:          45_000,
  sga_meeting:           377_000,
  sga_books:               8_700,
  sga_misc:               22_700,
  sga_outsource:         204_000,
  sga_membership:         45_000,
  sga_training_rent:     100_000,
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

  const actualByCode = new Map<string, number>()
  for (const a of actuals) {
    if (a.store !== null) continue // MVP: 全社合算で処理
    actualByCode.set(a.account_code, (actualByCode.get(a.account_code) ?? 0) + a.amount)
  }
  const rateByCode = new Map<string, number>()
  for (const r of variableRates) {
    if (r.store !== null) continue
    if (r.driver !== 'revenue') continue
    rateByCode.set(r.account_code, r.rate)
  }
  const fixedByCode = new Map<string, number>()
  for (const f of fixedCosts) {
    if (f.store !== null) continue
    fixedByCode.set(f.account_code, (fixedByCode.get(f.account_code) ?? 0) + f.amount)
  }

  const lines: PLLine[] = []
  const coverage = { actual: 0, variable: 0, fixed: 0, default: 0, empty: 0 }

  for (const acc of accounts) {
    const cat = acc.category as Category
    const subcat = (acc.subcategory ?? 'other') as Subcategory

    if (cat === 'revenue') {
      lines.push({
        code: acc.code, name: acc.name, category: cat, subcategory: subcat,
        pl_order: acc.pl_order, amount: revenue, source: 'actual',
      })
      coverage.actual++
      continue
    }
    if (cat === 'non_op') continue

    let amount = 0
    let source: PLLine['source'] = 'empty'
    if (actualByCode.has(acc.code)) {
      amount = actualByCode.get(acc.code)!
      source = 'actual'
      coverage.actual++
    } else if (fixedByCode.has(acc.code)) {
      amount = fixedByCode.get(acc.code)!
      source = 'fixed'
      coverage.fixed++
    } else if (rateByCode.has(acc.code)) {
      amount = Math.round(revenue * rateByCode.get(acc.code)!)
      source = 'variable'
      coverage.variable++
    } else if (DEFAULT_VARIABLE_RATES[acc.code] !== undefined) {
      amount = Math.round(revenue * DEFAULT_VARIABLE_RATES[acc.code])
      source = 'default'
      coverage.default++
    } else if (DEFAULT_FIXED_COSTS[acc.code] !== undefined) {
      amount = DEFAULT_FIXED_COSTS[acc.code]
      source = 'default'
      coverage.default++
    } else {
      coverage.empty++
    }

    lines.push({
      code: acc.code, name: acc.name, category: cat, subcategory: subcat,
      pl_order: acc.pl_order, amount, source,
    })
  }

  return aggregate(lines, coverage, year, month, stage, confidence, revenue)
}

/** 過去月の実績PL */
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
  const coverage = { actual: 0, variable: 0, fixed: 0, default: 0, empty: 0 }

  for (const acc of accounts) {
    if (acc.category === 'non_op') continue
    const amount = actualByCode.get(acc.code) ?? 0
    if (amount !== 0) coverage.actual++
    else coverage.empty++
    lines.push({
      code: acc.code,
      name: acc.name,
      category: acc.category as Category,
      subcategory: (acc.subcategory ?? 'other') as Subcategory,
      pl_order: acc.pl_order,
      amount,
      source: actualByCode.has(acc.code) ? 'actual' : 'empty',
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  return aggregate(lines, coverage, year, month, detectStage(year, month, today), 'final', revenue)
}

function aggregate(
  lines: PLLine[],
  coverage: { actual: number; variable: number; fixed: number; default: number; empty: number },
  year: number, month: number, stage: PLStage, confidence: PLConfidence, revenue: number
): PLForecastResult {
  const sum = (filter: (l: PLLine) => boolean) =>
    lines.filter(filter).reduce((s, l) => s + l.amount, 0)

  const cogs = sum(l => l.category === 'cogs')
  const sga = sum(l => l.category === 'sga')
  const grossProfit = revenue - cogs
  const operatingProfit = grossProfit - sga
  const opMargin = revenue > 0 ? operatingProfit / revenue : 0

  const cogsMaterial = sum(l => l.category === 'cogs' && l.subcategory === 'material')
  const cogsPersonnel = sum(l => l.category === 'cogs' && l.subcategory === 'personnel')
  const cogsPromo = sum(l => l.category === 'cogs' && l.subcategory === 'promo')
  const sgaPersonnel = sum(l => l.category === 'sga' && l.subcategory === 'personnel')
  const sgaRent = sum(l => l.category === 'sga' && l.subcategory === 'rent')
  const sgaUtility = sum(l => l.category === 'sga' && l.subcategory === 'utility')
  const sgaPromo = sum(l => l.category === 'sga' && l.subcategory === 'promo')
  const sgaOther = sum(l => l.category === 'sga' && l.subcategory === 'other')

  // 損益分岐点売上高 = 固定費 / (1 - 変動費率)
  // cogs のうち material と professional 的な変動費部分を仮定。より厳密には subcategory 別だが MVP は簡易計算
  const variableCost = lines
    .filter(l => l.source === 'variable' || l.source === 'default' && (DEFAULT_VARIABLE_RATES[l.code] !== undefined))
    .reduce((s, l) => s + l.amount, 0)
  const fixedCost = (cogs + sga) - variableCost
  const varRate = revenue > 0 ? variableCost / revenue : 0.3
  const breakEvenRevenue = varRate < 1 ? Math.round(fixedCost / (1 - varRate)) : 0

  return {
    year, month, stage, confidence,
    revenue, cogs, sga, grossProfit,
    operatingProfit, opMargin,
    cogsMaterial, cogsPersonnel, cogsPromo,
    sgaPersonnel, sgaRent, sgaUtility, sgaPromo, sgaOther,
    lines,
    coverage,
    breakEvenRevenue,
  }
}

/** 実績から変動費率と固定費を自動算出（seed 用） */
export function deriveParamsFromActuals(recent: CostActual[], accounts: CostAccount[]): {
  variableRates: { account_code: string; rate: number; driver: 'revenue' }[]
  fixedCosts: { account_code: string; amount: number }[]
} {
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
      // 0円の月は判定に含めない（未発生 or 閉店月）
      if (v === 0) continue
      samples.push(v)
      if (m.revenue > 0) samplesRate.push(v / m.revenue)
    }
    if (samples.length === 0) continue

    const mean = samples.reduce((s, x) => s + x, 0) / samples.length
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
    const stdDev = Math.sqrt(variance)
    const cv = Math.abs(mean) > 0 ? stdDev / Math.abs(mean) : 0

    // 変動係数 CV が小さく かつ is_variable=0 なら固定費として扱う
    if (cv < 0.20 && acc.is_variable === 0) {
      fixed.push({ account_code: acc.code, amount: Math.round(mean) })
    } else if (samplesRate.length > 0) {
      samplesRate.sort((a, b) => a - b)
      const median = samplesRate[Math.floor(samplesRate.length / 2)]
      rates.push({ account_code: acc.code, rate: Math.round(median * 100000) / 100000, driver: 'revenue' })
    } else {
      fixed.push({ account_code: acc.code, amount: Math.round(mean) })
    }
  }

  return { variableRates: rates, fixedCosts: fixed }
}
