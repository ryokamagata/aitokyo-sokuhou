import { NextResponse } from 'next/server'
import { getCostAccounts, getRecentCostActuals, getFixedCosts, upsertFixedCost, type CostAccount } from '@/lib/db'
import { DEFAULT_FIXED_COSTS, DEFAULT_VARIABLE_RATES } from '@/lib/plEngine'

export const dynamic = 'force-dynamic'

/**
 * 人件費の総額を過去実績比率で各科目に按分するAPI。
 *
 * 対象科目: subcategory='personnel' の cogs / sga 全科目
 *   cogs: 旅費交通費(通勤手当), 給与手当(サロン社員), 法定福利費, 支払報酬料(プロ契約)
 *   sga:  役員報酬, 給料賃金, 福利厚生費
 *
 * GET /api/pl-personnel-allocation?year=YYYY&month=M&monthsBack=6
 *   → 過去N月の科目別実績、平均比率、現在有効な固定費、推奨按分額を返す
 *
 * POST /api/pl-personnel-allocation
 *   mode: 'allocate-by-ratio'
 *     body: { total, validFrom, validTo?, monthsBack? }
 *     → 過去比率で按分して各科目を cost_fixed_monthly に保存
 *   mode: 'set-individual'
 *     body: { validFrom, validTo?, allocations: [{accountCode, amount}] }
 *     → 各科目の金額を直接保存
 */

function pad(n: number): string { return String(n).padStart(2, '0') }

function monthsAgo(year: number, month: number, n: number): { year: number; month: number } {
  const d = new Date(year, month - 1 - n, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function isPersonnel(acc: CostAccount): boolean {
  return acc.subcategory === 'personnel' && (acc.category === 'cogs' || acc.category === 'sga')
}

/**
 * 過去実績がゼロのときにフォールバックとして使う、各人件費科目の想定月額。
 * lib/plEngine.ts の DEFAULT_FIXED_COSTS と DEFAULT_VARIABLE_RATES から組み立てる。
 * 変動費率系（cogs_professional 等）は assumedRevenue × 率 で固定額化。
 */
function defaultPersonnelAmounts(accounts: CostAccount[], assumedRevenue: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const acc of accounts) {
    if (DEFAULT_FIXED_COSTS[acc.code] !== undefined) {
      out.set(acc.code, DEFAULT_FIXED_COSTS[acc.code])
    } else if (DEFAULT_VARIABLE_RATES[acc.code] !== undefined) {
      out.set(acc.code, Math.round(assumedRevenue * DEFAULT_VARIABLE_RATES[acc.code]))
    } else {
      out.set(acc.code, 0)
    }
  }
  return out
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = parseInt(url.searchParams.get('year') ?? String(now.getFullYear()), 10)
  const month = parseInt(url.searchParams.get('month') ?? String(now.getMonth() + 1), 10)
  const monthsBack = Math.max(1, Math.min(24, parseInt(url.searchParams.get('monthsBack') ?? '6', 10)))

  // 過去N月分（先月まで）
  const last = monthsAgo(year, month, 1)
  const start = monthsAgo(last.year, last.month, monthsBack - 1)

  const accounts = getCostAccounts().filter(isPersonnel)
  const actuals = getRecentCostActuals(start.year, start.month, last.year, last.month)
  const activeFixed = getFixedCosts(year, month).filter(f => f.store === null)
  const activeFixedByCode = new Map<string, number>()
  for (const f of activeFixed) {
    activeFixedByCode.set(f.account_code, (activeFixedByCode.get(f.account_code) ?? 0) + f.amount)
  }

  // 月キー一覧（古→新）
  const monthKeys: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = monthsAgo(last.year, last.month, i)
    monthKeys.push(`${d.year}-${pad(d.month)}`)
  }

  // 科目×月の実績
  const byCodeMonth = new Map<string, Map<string, number>>()
  for (const a of actuals) {
    if (a.store !== null) continue
    if (!accounts.find(acc => acc.code === a.account_code)) continue
    const key = `${a.year}-${pad(a.month)}`
    if (!byCodeMonth.has(a.account_code)) byCodeMonth.set(a.account_code, new Map())
    const m = byCodeMonth.get(a.account_code)!
    m.set(key, (m.get(key) ?? 0) + a.amount)
  }

  // 月ごとの「人件費合計（全科目合計）」
  const monthTotals = new Map<string, number>()
  for (const [, m] of byCodeMonth) {
    for (const [k, v] of m) monthTotals.set(k, (monthTotals.get(k) ?? 0) + v)
  }
  // 全期間の人件費合計
  const grandTotal = [...monthTotals.values()].reduce((s, v) => s + v, 0)

  // デフォルト想定値（売上1.5億想定）— 過去実績ゼロ時の参考に
  const assumedRevenue = parseInt(url.searchParams.get('assumedRevenue') ?? '150000000', 10)
  const defaults = defaultPersonnelAmounts(accounts, assumedRevenue)

  // 科目ごとの平均月額・全期間合計・比率（人件費合計に対する）
  const breakdown = accounts.map(acc => {
    const m = byCodeMonth.get(acc.code) ?? new Map<string, number>()
    const monthly = monthKeys.map(k => m.get(k) ?? 0)
    const total = monthly.reduce((s, v) => s + v, 0)
    const nonZero = monthly.filter(v => v > 0).length
    const avg = nonZero > 0 ? Math.round(total / nonZero) : 0
    const ratio = grandTotal > 0 ? total / grandTotal : 0
    return {
      code: acc.code,
      name: acc.name,
      category: acc.category,
      subcategory: acc.subcategory,
      monthly,
      total,
      avg,
      ratio,
      currentFixed: activeFixedByCode.get(acc.code) ?? null,
      defaultAmount: defaults.get(acc.code) ?? 0,
    }
  })

  // 現在の人件費合計（手動固定費＋デフォルト想定）
  const currentTotal = breakdown.reduce((s, b) => s + (b.currentFixed ?? 0), 0)
  // デフォルト想定での人件費合計（過去実績がゼロのときの参考）
  const defaultTotal = breakdown.reduce((s, b) => s + b.defaultAmount, 0)
  // 「現在予測PLに実際に乗る額」: 手動固定費があればそれ、無ければデフォルト想定値
  const effectiveByCode = breakdown.map(b => ({
    code: b.code,
    amount: b.currentFixed ?? b.defaultAmount,
  }))
  const effectiveTotal = effectiveByCode.reduce((s, e) => s + e.amount, 0)

  return NextResponse.json({
    year, month, monthsBack,
    rangeStart: `${start.year}-${pad(start.month)}`,
    rangeEnd: `${last.year}-${pad(last.month)}`,
    monthKeys,
    breakdown,
    monthTotals: monthKeys.map(k => ({ month: k, total: monthTotals.get(k) ?? 0 })),
    grandTotal,
    avgMonthlyTotal: monthKeys.length > 0 ? Math.round(grandTotal / monthKeys.length) : 0,
    currentFixedTotal: currentTotal,
    defaultTotal,
    effectiveTotal,
    effectiveByCode,
    assumedRevenue,
    hasPastActuals: grandTotal > 0,
  })
}

export async function POST(req: Request) {
  let body: {
    mode?: 'allocate-by-ratio' | 'set-individual'
    total?: number
    validFrom?: string
    validTo?: string | null
    monthsBack?: number
    assumedRevenue?: number
    allocations?: { accountCode: string; amount: number }[]
    note?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 })
  }

  const mode = body.mode
  const validFrom = body.validFrom
  const validTo = body.validTo ?? null
  const note = body.note ?? null

  if (!validFrom || !/^\d{4}-\d{1,2}$/.test(validFrom)) {
    return NextResponse.json({ ok: false, error: 'validFrom must be YYYY-MM' }, { status: 400 })
  }
  if (validTo !== null && !/^\d{4}-\d{1,2}$/.test(validTo)) {
    return NextResponse.json({ ok: false, error: 'validTo must be YYYY-MM or null' }, { status: 400 })
  }
  const validFromN = normalizeYM(validFrom)
  const validToN = validTo ? normalizeYM(validTo) : null

  const accounts = getCostAccounts().filter(isPersonnel)
  const accountSet = new Set(accounts.map(a => a.code))

  if (mode === 'allocate-by-ratio') {
    const total = body.total
    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
      return NextResponse.json({ ok: false, error: 'total must be a non-negative number' }, { status: 400 })
    }
    const monthsBack = Math.max(1, Math.min(24, body.monthsBack ?? 6))
    const assumedRevenue = typeof body.assumedRevenue === 'number' && body.assumedRevenue > 0
      ? body.assumedRevenue : 150_000_000 // 月次想定売上1.5億をデフォルト

    // 比率を算出（対象月: 当該validFromの前月から monthsBack ヶ月遡る）
    const [yStr, mStr] = validFromN.split('-')
    const targetY = parseInt(yStr, 10)
    const targetM = parseInt(mStr, 10)
    const last = monthsAgo(targetY, targetM, 1)
    const start = monthsAgo(last.year, last.month, monthsBack - 1)
    const actuals = getRecentCostActuals(start.year, start.month, last.year, last.month)

    const totalsByCode = new Map<string, number>()
    for (const a of actuals) {
      if (a.store !== null) continue
      if (!accountSet.has(a.account_code)) continue
      totalsByCode.set(a.account_code, (totalsByCode.get(a.account_code) ?? 0) + a.amount)
    }
    let grand = [...totalsByCode.values()].reduce((s, v) => s + v, 0)
    let usedFallback = false

    if (grand === 0) {
      // フォールバック: lib/plEngine.ts のデフォルト固定費・変動率比率を使う
      const defaults = defaultPersonnelAmounts(accounts, assumedRevenue)
      for (const [code, v] of defaults) {
        if (v > 0) totalsByCode.set(code, v)
      }
      grand = [...totalsByCode.values()].reduce((s, v) => s + v, 0)
      usedFallback = true
      if (grand === 0) {
        return NextResponse.json({
          ok: false,
          error: '按分の元になる比率が算出できませんでした（過去実績もデフォルト値も無し）',
        }, { status: 400 })
      }
    }

    // 比率で按分。端数は最後の科目で吸収（最大の科目に丸め誤差を寄せる）。
    const rows: { accountCode: string; amount: number; ratio: number }[] = []
    let assigned = 0
    const sortedCodes = [...totalsByCode.entries()].sort((a, b) => b[1] - a[1])
    for (let i = 0; i < sortedCodes.length; i++) {
      const [code, past] = sortedCodes[i]
      const ratio = past / grand
      let amt: number
      if (i === sortedCodes.length - 1) {
        amt = Math.max(0, total - assigned) // 端数吸収
      } else {
        amt = Math.round(total * ratio)
        assigned += amt
      }
      rows.push({ accountCode: code, amount: amt, ratio })
    }

    for (const r of rows) {
      const sourceLabel = usedFallback ? `デフォルト想定値の比率 ${(r.ratio * 100).toFixed(1)}%` : `過去${monthsBack}ヶ月実績比 ${(r.ratio * 100).toFixed(1)}%`
      const memo = note ?? `按分(${sourceLabel})`
      upsertFixedCost(r.accountCode, null, validFromN, validToN, r.amount, memo)
    }

    return NextResponse.json({
      ok: true,
      mode,
      total,
      validFrom: validFromN,
      validTo: validToN,
      usedFallback,
      allocations: rows.map(r => ({
        accountCode: r.accountCode,
        amount: r.amount,
        ratioPct: Math.round(r.ratio * 1000) / 10,
      })),
    })
  }

  if (mode === 'set-individual') {
    const allocations = body.allocations
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json({ ok: false, error: 'allocations must be a non-empty array' }, { status: 400 })
    }
    for (const a of allocations) {
      if (!a.accountCode || !accountSet.has(a.accountCode)) {
        return NextResponse.json({ ok: false, error: `unknown personnel accountCode: ${a.accountCode}` }, { status: 400 })
      }
      if (typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount < 0) {
        return NextResponse.json({ ok: false, error: `invalid amount for ${a.accountCode}` }, { status: 400 })
      }
    }
    for (const a of allocations) {
      upsertFixedCost(a.accountCode, null, validFromN, validToN, Math.round(a.amount), note)
    }
    const total = allocations.reduce((s, a) => s + a.amount, 0)
    return NextResponse.json({
      ok: true,
      mode,
      total,
      validFrom: validFromN,
      validTo: validToN,
      saved: allocations.length,
    })
  }

  return NextResponse.json({ ok: false, error: 'mode must be "allocate-by-ratio" or "set-individual"' }, { status: 400 })
}

function normalizeYM(s: string): string {
  const [y, m] = s.split('-').map(Number)
  return `${y}-${pad(m)}`
}
