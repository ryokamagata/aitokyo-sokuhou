import { NextResponse } from 'next/server'
import { getAllStaffMaster, upsertStaffMaster, getStaffSalesForMonth, getMonthlyStaffSales, upsertFixedCost, type StaffMaster } from '@/lib/db'
import { normalizeStaffName } from '@/lib/staffNormalize'

export const dynamic = 'force-dynamic'

/**
 * スタッフ別ルール式人件費計算 API
 *
 * ルール:
 *   - プロ契約: max(売上 × 38%, ¥240,000)
 *   - 正社員:   max(売上 × 30%, ¥240,000)
 *   - アシスタント: ¥220,000 固定
 *
 * GET /api/pl-staff-salary?year=YYYY&month=M&monthsBack=3
 *   → 全スタッフの直近月平均売上 + マスタ設定 + 計算給与プレビュー
 *
 * POST /api/pl-staff-salary
 *   body: {
 *     staff: [{staff_name, type, base_salary, rate, active}],
 *     applyMonth?: 'YYYY-MM',  // 指定があれば cost_fixed_monthly に集計保存
 *   }
 *   → マスタ更新、必要なら fixed_cost に集計保存
 */

const ASSISTANT_DEFAULT_SALARY = 220_000
const PRO_DEFAULT_RATE = 0.38
const FULLTIME_DEFAULT_RATE = 0.30
const PRO_FULLTIME_BASE = 240_000

function calcBaseSalary(s: { type: string; base_salary: number; rate: number }, monthlySales: number): number {
  if (s.type === 'assistant') return s.base_salary || ASSISTANT_DEFAULT_SALARY
  if (s.type === 'pro') {
    const byRate = monthlySales * (s.rate || PRO_DEFAULT_RATE)
    return Math.max(byRate, s.base_salary || PRO_FULLTIME_BASE)
  }
  if (s.type === 'fulltime') {
    const byRate = monthlySales * (s.rate || FULLTIME_DEFAULT_RATE)
    return Math.max(byRate, s.base_salary || PRO_FULLTIME_BASE)
  }
  return s.base_salary || PRO_FULLTIME_BASE
}

function calcSalary(s: { type: string; base_salary: number; rate: number; position_allowance?: number }, monthlySales: number): number {
  return calcBaseSalary(s, monthlySales) + (s.position_allowance ?? 0)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const year = parseInt(url.searchParams.get('year') ?? String(now.getFullYear()), 10)
  const month = parseInt(url.searchParams.get('month') ?? String(now.getMonth() + 1), 10)
  const monthsBack = Math.max(1, Math.min(12, parseInt(url.searchParams.get('monthsBack') ?? '3', 10)))

  // 過去N月の月平均売上を集計（直近月優先で代表値とする）
  const fromY = month - monthsBack > 0 ? year : year - 1
  const fromM = ((month - monthsBack - 1 + 12) % 12) + 1
  const toY = month - 1 > 0 ? year : year - 1
  const toM = month - 1 > 0 ? month - 1 : 12
  const recentRows = getMonthlyStaffSales(fromY, fromM, toY, toM)

  const salesByStaff = new Map<string, { total: number; months: number }>()
  const monthsSet = new Set<string>()
  for (const r of recentRows) {
    const k = `${r.year}-${r.month}`
    monthsSet.add(k)
    const name = normalizeStaffName(r.staff)
    if (!name || name === '不明' || name === 'フリー') continue
    if (!salesByStaff.has(name)) salesByStaff.set(name, { total: 0, months: 0 })
    const e = salesByStaff.get(name)!
    e.total += r.sales
    e.months += 1
  }
  const distinctMonths = monthsSet.size || 1

  // 当月までの実績スタッフも対象に含める（直近月でしかBMに出ないスタッフを取りこぼさない）
  const currentMonthRows = getStaffSalesForMonth(year, month)
  for (const r of currentMonthRows) {
    const name = normalizeStaffName(r.staff)
    if (!name || name === '不明' || name === 'フリー') continue
    if (!salesByStaff.has(name)) salesByStaff.set(name, { total: 0, months: 0 })
  }

  const masters = getAllStaffMaster()
  const masterByName = new Map<string, StaffMaster>(masters.map(m => [normalizeStaffName(m.staff_name), m]))

  type Row = {
    staff_name: string
    type: string
    base_salary: number
    rate: number
    position_allowance: number
    active: number
    notes: string | null
    avgMonthlySales: number
    calculatedSalary: number
    isNew: boolean
  }
  const list: Row[] = [...salesByStaff.entries()].map(([name, v]) => {
    const m = masterByName.get(name)
    const avgMonthlySales = v.months > 0 ? Math.round(v.total / v.months) : 0
    const settings = m ?? {
      staff_name: name,
      type: 'fulltime',
      base_salary: PRO_FULLTIME_BASE,
      rate: FULLTIME_DEFAULT_RATE,
      position_allowance: 0,
      active: 1,
      notes: null,
    }
    const calculatedSalary = settings.active ? Math.round(calcSalary(settings, avgMonthlySales)) : 0
    return {
      staff_name: settings.staff_name,
      type: settings.type,
      base_salary: settings.base_salary,
      rate: settings.rate,
      position_allowance: settings.position_allowance ?? 0,
      active: settings.active,
      notes: settings.notes,
      avgMonthlySales,
      calculatedSalary,
      isNew: !m,
    }
  })

  list.sort((a, b) => b.calculatedSalary - a.calculatedSalary)

  // 集計
  const sumByType = { pro: 0, fulltime: 0, assistant: 0 }
  for (const r of list) {
    if (r.active && (r.type === 'pro' || r.type === 'fulltime' || r.type === 'assistant')) {
      sumByType[r.type as 'pro' | 'fulltime' | 'assistant'] += r.calculatedSalary
    }
  }

  return NextResponse.json({
    year, month, monthsBack,
    referenceMonths: distinctMonths,
    rows: list,
    summary: {
      totalStaff: list.filter(r => r.active).length,
      countByType: {
        pro: list.filter(r => r.active && r.type === 'pro').length,
        fulltime: list.filter(r => r.active && r.type === 'fulltime').length,
        assistant: list.filter(r => r.active && r.type === 'assistant').length,
      },
      salaryByType: sumByType,
      grandTotal: sumByType.pro + sumByType.fulltime + sumByType.assistant,
    },
  })
}

export async function POST(req: Request) {
  let body: {
    staff?: { staff_name: string; type: string; base_salary?: number; rate?: number; position_allowance?: number; active?: number; notes?: string | null }[]
    applyMonth?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json body' }, { status: 400 })
  }
  const staff = body.staff
  if (!Array.isArray(staff) || staff.length === 0) {
    return NextResponse.json({ ok: false, error: 'staff array required' }, { status: 400 })
  }
  for (const s of staff) {
    if (!s.staff_name) return NextResponse.json({ ok: false, error: 'staff_name required' }, { status: 400 })
    if (!['pro', 'fulltime', 'assistant'].includes(s.type)) {
      return NextResponse.json({ ok: false, error: `invalid type: ${s.type}` }, { status: 400 })
    }
  }
  const rows = staff.map(s => ({
    staff_name: s.staff_name,
    type: s.type,
    base_salary: typeof s.base_salary === 'number' && Number.isFinite(s.base_salary)
      ? s.base_salary
      : (s.type === 'assistant' ? ASSISTANT_DEFAULT_SALARY : PRO_FULLTIME_BASE),
    rate: typeof s.rate === 'number' && Number.isFinite(s.rate)
      ? s.rate
      : (s.type === 'pro' ? PRO_DEFAULT_RATE : s.type === 'fulltime' ? FULLTIME_DEFAULT_RATE : 0),
    position_allowance: typeof s.position_allowance === 'number' && Number.isFinite(s.position_allowance) && s.position_allowance >= 0
      ? s.position_allowance : 0,
    active: s.active ?? 1,
    notes: s.notes ?? null,
  }))
  upsertStaffMaster(rows)

  // 必要なら cost_fixed_monthly に集計保存
  let applied: { applyMonth: string; sumByCode: Record<string, number> } | null = null
  if (body.applyMonth && /^\d{4}-\d{1,2}$/.test(body.applyMonth)) {
    // 各タイプの計算後給与を再計算して fixed_cost に保存
    // pro → cogs_professional, fulltime+assistant → cogs_salon_salary
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
    const refY = now.getFullYear(); const refM = now.getMonth() + 1

    // GET と同じ集計ロジックでスタッフごとの月平均売上を取得
    const monthsBack = 3
    const fromY = refM - monthsBack > 0 ? refY : refY - 1
    const fromM = ((refM - monthsBack - 1 + 12) % 12) + 1
    const toY = refM - 1 > 0 ? refY : refY - 1
    const toM = refM - 1 > 0 ? refM - 1 : 12
    const recentRows = getMonthlyStaffSales(fromY, fromM, toY, toM)
    const salesByStaff = new Map<string, { total: number; months: number }>()
    for (const r of recentRows) {
      const name = normalizeStaffName(r.staff)
      if (!name || name === '不明' || name === 'フリー') continue
      if (!salesByStaff.has(name)) salesByStaff.set(name, { total: 0, months: 0 })
      const e = salesByStaff.get(name)!
      e.total += r.sales; e.months += 1
    }

    let sumPro = 0, sumFulltime = 0, sumAssistant = 0
    for (const r of rows) {
      if (!r.active) continue
      const norm = normalizeStaffName(r.staff_name)
      const sales = salesByStaff.get(norm)
      const avg = sales && sales.months > 0 ? sales.total / sales.months : 0
      const sal = calcSalary(r, avg)
      if (r.type === 'pro') sumPro += sal
      else if (r.type === 'fulltime') sumFulltime += sal
      else if (r.type === 'assistant') sumAssistant += sal
    }
    const validFromN = (() => { const [y, m] = body.applyMonth!.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}` })()

    // pro → cogs_professional に保存
    if (sumPro > 0) {
      upsertFixedCost('cogs_professional', null, validFromN, null, Math.round(sumPro), 'スタッフ別ルール計算(プロ契約) ' + new Date().toISOString().slice(0, 10))
    }
    // fulltime + assistant → cogs_salon_salary
    const fulltimeAssistantSum = sumFulltime + sumAssistant
    if (fulltimeAssistantSum > 0) {
      upsertFixedCost('cogs_salon_salary', null, validFromN, null, Math.round(fulltimeAssistantSum), 'スタッフ別ルール計算(正社員+アシスタント) ' + new Date().toISOString().slice(0, 10))
    }
    applied = {
      applyMonth: validFromN,
      sumByCode: {
        cogs_professional: Math.round(sumPro),
        cogs_salon_salary: Math.round(fulltimeAssistantSum),
      },
    }
  }

  return NextResponse.json({ ok: true, saved: rows.length, applied })
}
