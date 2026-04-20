// 月次決算速報値シートの TSV/CSV を会計科目単位にパースする共通ロジック
//
// シート構造（AI TOKYO 運用の「★月次決算速報値」を想定）:
//   行0: ヘッダ — 「勘定科目」「 9月 」「10月 」...「合計」
//   行 N: データ行
//     - labelCol=0: 売上高 / 売上原価 / 販売費及び一般管理費 / 営業外収益 等のカテゴリ見出し
//     - labelCol=1: 具体的な勘定科目（仕入高・【原】材料費・地代家賃 等）
//     - labelCol=2: 補助科目（店舗名や仕入先）
//     - 「XX合計」「営業利益」「経常利益」等は集計行（スキップ）

export type ParsedPLRow = {
  accountCode: string     // 内部コード (例: 'revenue', 'cogs_drugs', 'sga_rent')
  store: string | null    // 店舗名 (全店合算は null)
  year: number
  month: number
  amount: number
  source: 'parent' | 'store'  // 親科目 or 店舗別内訳
  rawLabel: string
}

export type ParseResult = {
  rows: ParsedPLRow[]
  monthsDetected: { year: number; month: number }[]
  unmatched: string[]
  skipped: number
}

// シート上のラベル → 内部 account_code
// 完全一致ベース（部分一致だと「通信費」が「【原】通信費」に誤マッチするため）
const ACCOUNT_MAP: Record<string, string> = {
  // 売上
  '売上高': 'revenue',
  // 売上原価
  '仕入高': 'cogs_purchase',
  '【原】材料費': 'cogs_drugs',
  '【原】旅費交通費': 'cogs_commute',
  '【原】広告宣伝費': 'cogs_promo_recruit',
  '【原】給与手当': 'cogs_salon_salary',
  '【原】法定福利費': 'cogs_social',
  '【原】支払報酬料': 'cogs_professional',
  '【原】消耗品費': 'cogs_supplies_shop',
  '【原】通信費': 'cogs_comm_shop',
  '【原】賃借料': 'cogs_lease_shop',
  '【原】水道光熱費': 'cogs_utility_shop',
  '【原】支払手数料': 'cogs_fee_employee',
  // 販管費
  '役員報酬': 'sga_executive',
  '給料賃金': 'sga_salary',
  '福利厚生費': 'sga_welfare',
  '業務委託料': 'sga_outsource_spot',
  '荷造運賃': 'sga_shipping',
  '広告宣伝費': 'sga_promo',
  '接待交際費': 'sga_entertainment',
  '旅費交通費': 'sga_travel',
  '通信費': 'sga_comm',
  '水道光熱費': 'sga_utility',
  '修繕費': 'sga_repair',
  '備品・消耗品費': 'sga_supplies',
  'リース料': 'sga_lease',
  '地代家賃': 'sga_rent',
  '保険料': 'sga_insurance',
  '租税公課': 'sga_tax',
  '支払手数料': 'sga_banking',
  '支払報酬': 'sga_legal',
  '会議費': 'sga_meeting',
  '新聞図書費': 'sga_books',
  '雑費': 'sga_misc',
  '外注費': 'sga_outsource',
  '諸会費': 'sga_membership',
  '賃借料': 'sga_training_rent',
  '支払報酬料': 'sga_judicial',
  '研修費': 'sga_training_exp',
  // 営業外
  '受取利息': 'non_op_interest_income',
  '雑収入': 'non_op_misc_income',
  '支払利息': 'non_op_interest_expense',
  '法人税等': 'non_op_tax',
}

// シート上の店舗ラベル → DB上の正式店舗名
const STORE_MAP: Record<string, string | null> = {
  'AI TOKYO 渋谷': 'AI TOKYO 渋谷',
  'AI TOKYO RITA': 'AI TOKYO Rita',
  'AI TOKYO Rita': 'AI TOKYO Rita',
  'AI TOKYO 名古屋': 'AI TOKYO 名古屋栄',
  'AI TOKYO 横浜': "AI TOKYO men's 横浜",
  'AI TOKYO S': 'AI TOKYO S',
  'AI TOKYO Ciel': "AI TOKYO Ciel men's 横浜",
  'AI TOKYO 福岡': 'AI TOKYO 福岡',
  'AI TOKYO 池袋': "AI TOKYO men's 池袋",
  'AI TOKYO 名古屋名駅店': 'AI TOKYO 名古屋名駅店',
  'AI TOKYO 名古屋2nd': 'AI TOKYO 名古屋 2nd',
  'AI TOKYO AMS': 'ams by AI TOKYO',
  'AI TOKYO 下北沢': "AI TOKYO men's 下北沢",
  'AI TOKYO SEA': 'AITOKYO + Sea店 横浜',
  '本社事務所': '本社',
  'パークコート渋谷': 'パークコート渋谷',
  '補助科目なし': null,
}

// 集計行・利益指標（どの列にあってもスキップする行）
// NB: 「売上高」「営業外収益」など labelCol=0 に出てくるカテゴリ見出しは
//     labelCol=0 判定側で弾くので、ここに入れてはいけない（同名の勘定科目を誤スキップする）
const SKIP_LABEL_PATTERNS: RegExp[] = [
  /合計\s*$/,
  /^売上総利益$/,
  /^営業利益$/,
  /^経常利益$/,
  /^税引前当期純利益$/,
  /^当期純利益$/,
  /^当期純損益$/,
]

export function parseAmount(raw: string | undefined): number {
  if (!raw) return 0
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-' || trimmed === '—') return 0
  let s = trimmed.replace(/[¥,\s"]/g, '')
  const isNegative = s.startsWith('(') && s.endsWith(')')
  if (isNegative) s = s.slice(1, -1)
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  return Math.round(isNegative ? -n : n)
}

function parseCSVLine(line: string): string[] {
  // 行内にタブが含まれていれば TSV、そうでなければ CSV としてパース
  if (line.includes('\t')) return line.split('\t')
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = false
      } else current += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { fields.push(current); current = '' }
      else current += ch
    }
  }
  fields.push(current)
  return fields
}

/**
 * 月次決算速報シートのパース
 * @param text CSV または TSV 全文
 * @param fiscalStartYear 「9月」列の年（例: 2025年9月期なら 2025）
 *                        10-12月は fiscalStartYear、1-8月は fiscalStartYear+1 に割り当てる
 */
export function parsePLSheet(text: string, fiscalStartYear: number): ParseResult {
  const lines = text.split(/\r?\n/)
  const rows: ParsedPLRow[] = []
  const unmatched = new Set<string>()
  let skipped = 0

  // ヘッダ行を探す
  let headerIdx = -1
  let cells: string[] = []
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const c = parseCSVLine(lines[i])
    if (c.some(x => x.trim() === '勘定科目') || c.filter(x => /^\s*\d+月\s*$/.test(x)).length >= 2) {
      headerIdx = i
      cells = c
      break
    }
  }
  if (headerIdx === -1) return { rows: [], monthsDetected: [], unmatched: [], skipped: 0 }

  // 月カラムの位置を検出
  const monthCols: { colIndex: number; month: number; year: number }[] = []
  for (let c = 0; c < cells.length; c++) {
    const m = cells[c].trim().match(/^(\d+)月$/)
    if (m) {
      const month = parseInt(m[1], 10)
      // 9-12月は fiscalStartYear、1-8月は翌年扱い
      const year = month >= 9 ? fiscalStartYear : fiscalStartYear + 1
      monthCols.push({ colIndex: c, month, year })
    }
  }
  if (monthCols.length === 0) return { rows: [], monthsDetected: [], unmatched: [], skipped: 0 }
  const firstMonthCol = monthCols[0].colIndex

  let currentParentCode: string | null = null

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i])
    if (row.length === 0) continue

    // 先頭からみて最初に非空セルがある列を labelCol とする
    let labelCol = -1
    let label = ''
    for (let c = 0; c < firstMonthCol; c++) {
      const v = row[c]?.trim() ?? ''
      if (v) { labelCol = c; label = v; break }
    }
    if (!label) continue

    // スキップ対象
    if (SKIP_LABEL_PATTERNS.some(p => p.test(label))) { skipped++; continue }

    if (labelCol === 0) {
      // カテゴリ見出し（「売上高」「売上原価」等）
      currentParentCode = null
      skipped++
      continue
    }

    if (labelCol === 1) {
      // 具体的な勘定科目
      const code = ACCOUNT_MAP[label]
      if (!code) {
        unmatched.add(label)
        currentParentCode = null
        skipped++
        continue
      }
      currentParentCode = code
      for (const mc of monthCols) {
        const amount = parseAmount(row[mc.colIndex])
        if (amount === 0) continue
        rows.push({
          accountCode: code,
          store: null,
          year: mc.year,
          month: mc.month,
          amount,
          source: 'parent',
          rawLabel: label,
        })
      }
      continue
    }

    if (labelCol === 2) {
      // 補助科目（店舗名 or 仕入先）。親が無い場合はスキップ
      if (!currentParentCode) { skipped++; continue }
      // 店舗名マップに無ければ仕入先など → 親に既に合算済みなのでスキップ
      if (!(label in STORE_MAP)) { skipped++; continue }
      const store = STORE_MAP[label]
      if (store === null) { skipped++; continue }
      for (const mc of monthCols) {
        const amount = parseAmount(row[mc.colIndex])
        if (amount === 0) continue
        rows.push({
          accountCode: currentParentCode,
          store,
          year: mc.year,
          month: mc.month,
          amount,
          source: 'store',
          rawLabel: label,
        })
      }
      continue
    }

    skipped++
  }

  return {
    rows,
    monthsDetected: monthCols.map(m => ({ year: m.year, month: m.month })),
    unmatched: [...unmatched],
    skipped,
  }
}
