import { NextResponse } from 'next/server'
import {
  getCostAccounts,
  getRecentCostActuals,
  upsertVariableRate,
  upsertFixedCost,
} from '@/lib/db'
import { deriveParamsFromActuals } from '@/lib/plEngine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/seed-pl-params
 * body: { fromYear, fromMonth, toYear, toMonth, validFrom? }
 *   過去実績から変動費率・固定費を逆算して cost_variable_rates / cost_fixed_monthly に投入
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const fromYear: number = body.fromYear ?? 2025
  const fromMonth: number = body.fromMonth ?? 9
  const toYear: number = body.toYear ?? 2026
  const toMonth: number = body.toMonth ?? 2
  const validFrom: string = body.validFrom ?? `${toYear}-${String(toMonth + 1).padStart(2, '0')}`

  const actuals = getRecentCostActuals(fromYear, fromMonth, toYear, toMonth)
  if (actuals.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'No cost_actuals_monthly rows found in the given range. Run /api/import-pl-spreadsheet first.',
    }, { status: 400 })
  }

  const accounts = getCostAccounts()
  const derived = deriveParamsFromActuals(actuals, accounts)

  for (const r of derived.variableRates) {
    upsertVariableRate(r.account_code, null, r.driver, r.rate, validFrom, null)
  }
  for (const f of derived.fixedCosts) {
    upsertFixedCost(f.account_code, null, validFrom, null, f.amount, 'auto-derived from actuals')
  }

  return NextResponse.json({
    ok: true,
    sourceRange: { fromYear, fromMonth, toYear, toMonth },
    rowsRead: actuals.length,
    variableRates: derived.variableRates,
    fixedCosts: derived.fixedCosts,
    validFrom,
  })
}
