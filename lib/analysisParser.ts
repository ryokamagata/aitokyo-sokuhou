import * as cheerio from 'cheerio'
import type { AnalysisType } from './analysisTypes'

// ─── 共通ユーティリティ ──────────────────────────────────────────────────────

/** 「282,810円」「-3,780円」「29」「0」→ 数値 */
function parseAmount(text: string): number {
  const cleaned = text.replace(/[^\d.-]/g, '')
  return parseFloat(cleaned) || 0
}

/** 「7(23.3%)」→ 数値の件数部分 7 を取得 */
function parseCountFromCell(text: string): number {
  // "7(23.3%)" → 7, "170(28%)" → 170, "0(0%)" → 0, "607" → 607
  const match = text.match(/^(-?\d[\d,]*)/)
  if (!match) return 0
  return parseInt(match[1].replace(/,/g, '')) || 0
}

/** 「7(23.3%)」→ パーセント部分 23.3 を取得 */
function parsePercentFromCell(text: string): number {
  const match = text.match(/\(([\d.]+)%?\)/)
  return match ? parseFloat(match[1]) : 0
}

/**
 * BM分析ページの table.data からヘッダーと行データを抽出
 * BMのテーブルは <table class="data"> を使用
 */
function extractDataTable($: cheerio.CheerioAPI, index: number = 0): {
  headers: string[]
  rows: string[][]
} {
  const tables = $('table.data')
  if (tables.length === 0) {
    // fallback: any table (skip table.search)
    const allTables = $('table').not('.search')
    if (allTables.length === 0) return { headers: [], rows: [] }
    return extractFromTable($, allTables.eq(index))
  }
  if (index >= tables.length) return { headers: [], rows: [] }
  return extractFromTable($, tables.eq(index))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): {
  headers: string[]
  rows: string[][]
} {
  const headers: string[] = []
  const rows: string[][] = []

  // ヘッダー抽出 (thead or first tr with th)
  const headerRow = table.find('thead tr').first()
  if (headerRow.length > 0) {
    headerRow.find('th, td').each((_, el) => {
      headers.push($(el).text().trim())
    })
  } else {
    table.find('tr').first().find('th').each((_, el) => {
      headers.push($(el).text().trim())
    })
  }

  // 行データ抽出 (tbody tr, or all tr except header)
  const bodyRows = table.find('tbody tr')
  if (bodyRows.length > 0) {
    bodyRows.each((_, tr) => {
      const cells: string[] = []
      $(tr).find('td, th').each((_, td) => {
        cells.push($(td).text().trim())
      })
      if (cells.length > 0) rows.push(cells)
    })
  } else {
    // No tbody - skip first row (header) and parse the rest
    table.find('tr').slice(1).each((_, tr) => {
      const cells: string[] = []
      $(tr).find('td, th').each((_, td) => {
        cells.push($(td).text().trim())
      })
      if (cells.length > 0) rows.push(cells)
    })
  }

  return { headers, rows }
}

// ─── 予約分析 (reserve) パーサー ─────────────────────────────────────────────
// テーブル構造: 日付 | 曜日 | 電話予約 | 次回予約 | アプリ | Web予約 | Google | Instagram | Facebook | HPB | 合計
// セル値: "7(23.3%)" 形式

function parseReserve(html: string): object {
  const $ = cheerio.load(html)
  const channels: { name: string; count: number; ratio: number }[] = []
  const daily: { date: string; channels: Record<string, number> }[] = []

  const { headers, rows } = extractDataTable($, 0)

  // ヘッダーからチャネル名を取得（日付・曜日・合計を除く）
  const channelNames: string[] = []
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim()
    if (h && h !== '日付' && h !== '合計' && !/曜/.test(h)) {
      channelNames.push(h)
    }
  }

  let total = 0
  for (const row of rows) {
    if (!row[0]) continue
    const isTotal = /合計/.test(row[0])
    const isDate = /\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}/.test(row[0])

    if (isTotal) {
      // 合計行: チャネルごとの件数と構成比を抽出
      // 合計行のセルは日付・曜日列を跳ばした位置から始まる
      let ci = 0
      for (let i = 1; i < row.length; i++) {
        if (row[i] === '') continue // 空セル(曜日列)はスキップ
        if (ci < channelNames.length) {
          const count = parseCountFromCell(row[i])
          const ratio = parsePercentFromCell(row[i])
          channels.push({ name: channelNames[ci], count, ratio })
          total += count
          ci++
        }
      }
    } else if (isDate) {
      const dayChannels: Record<string, number> = {}
      let ci = 0
      for (let i = 1; i < row.length; i++) {
        if (row[i] === '' || /^[月火水木金土日]$/.test(row[i])) continue
        if (/合計/.test(headers[i] || '')) continue // 合計列はスキップ
        if (ci < channelNames.length) {
          dayChannels[channelNames[ci]] = parseCountFromCell(row[i])
          ci++
        }
      }
      daily.push({ date: row[0].trim(), channels: dayChannels })
    }
  }

  return { total, channels, daily }
}

// ─── 売上分析 (account) パーサー ─────────────────────────────────────────────
// テーブル: table#account_data または table.data
// ヘッダー: 日付 | 曜日 | 純売上 | 技術 | 商品 | その他 | 総売上 | 割引 | 客単価 | 総客数 | 新規 | 再来 | 指名売上 | ... | 指名数
// 値: "282,810円", "-3,780円", "29"

function parseAccount(html: string): object {
  const $ = cheerio.load(html)
  const daily: object[] = []
  let summary = { pureSales: 0, avgSpend: 0, totalCustomers: 0, namedSales: 0, namedCount: 0, totalSales: 0 }

  // Try table#account_data first, then table.data
  let table = $('#account_data')
  if (table.length === 0) {
    table = $('table.data').first()
  }
  if (table.length === 0) return { summary, daily }

  const { rows } = extractFromTable($, table)

  for (const row of rows) {
    if (row.length < 8) continue
    const isTotal = /合計/.test(row[0])
    const isDate = /\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2}/.test(row[0])

    // BM account テーブルの列順:
    // [0]日付 [1]曜日 [2]純売上 [3]技術 [4]商品 [5]その他 [6]総売上 [7]割引
    // [8]客単価 [9]総客数 [10]新規 [11]再来
    // [12]指名売上 [13]技術 [14]商品 [15]その他 [16]割引 [17]指名客単価 [18]指名数
    // 注意: 曜日列がある場合offset=2, ない場合offset=1
    const offset = /^[月火水木金土日]$/.test(row[1]) ? 2 : 1

    const pureSales = parseAmount(row[offset] || '0')
    const totalSalesRaw = parseAmount(row[offset + 4] || '0')
    const avgSpend = parseAmount(row[offset + 6] || '0')
    const customers = parseAmount(row[offset + 7] || '0')
    const namedSales = parseAmount(row[offset + 10] || '0')
    const namedCount = parseAmount(row[offset + 16] || row[offset + 15] || '0')

    const record = {
      pureSales,
      avgSpend,
      customers,
      namedSales,
      namedCount,
      totalSales: totalSalesRaw || pureSales,
    }

    if (isTotal) {
      summary = {
        pureSales: record.pureSales,
        avgSpend: record.avgSpend,
        totalCustomers: record.customers,
        namedSales: record.namedSales,
        namedCount: record.namedCount,
        totalSales: record.totalSales,
      }
    } else if (isDate) {
      daily.push({ date: row[0].trim(), ...record })
    }
  }

  return { summary, daily }
}

// ─── リピート分析 (repeat) パーサー ──────────────────────────────────────────

function parseRepeat(html: string): object {
  const $ = cheerio.load(html)
  const categories: object[] = []

  const { rows } = extractDataTable($, 0)

  for (const row of rows) {
    if (row.length < 3) continue
    const type = row[0].trim()
    if (!type || /合計|総計/.test(type)) continue

    const count = parseAmount(row[1])
    const ratio = parsePercentFromCell(row[2]) || parseAmount(row[2])
    const months: { month: number; rate: number }[] = []

    for (let i = 3; i < row.length; i++) {
      const rate = parsePercentFromCell(row[i]) || parseAmount(row[i])
      months.push({ month: i - 2, rate })
    }

    categories.push({ type, count, ratio, months })
  }

  const baseMonth = $('select[name="startMonth"], .period, h2, h3').text().match(/(\d{4})年(\d{1,2})月/)
  const baseStr = baseMonth ? `${baseMonth[1]}-${baseMonth[2].padStart(2, '0')}` : ''

  return { baseMonth: baseStr, categories }
}

// ─── スタッフ分析 (stylist) パーサー ─────────────────────────────────────────

function parseStylist(html: string): object {
  const $ = cheerio.load(html)
  const staff: object[] = []

  const { rows } = extractDataTable($, 0)

  for (const row of rows) {
    if (row.length < 3) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    staff.push({
      name,
      sales: parseAmount(row[1] || '0'),
      customers: parseAmount(row[2] || '0'),
      avgSpend: row.length > 3 ? parseAmount(row[3] || '0') : 0,
    })
  }

  return { staff }
}

// ─── メニュー分析 (menu) パーサー ───────────────────────────────────────────

function parseMenu(html: string): object {
  const $ = cheerio.load(html)
  const menus: object[] = []

  const { rows } = extractDataTable($, 0)

  for (const row of rows) {
    if (row.length < 2) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    menus.push({
      name,
      count: parseAmount(row[1] || '0'),
      sales: row.length > 2 ? parseAmount(row[2] || '0') : 0,
      ratio: row.length > 3 ? (parsePercentFromCell(row[3]) || parseAmount(row[3])) : 0,
    })
  }

  return { menus }
}

// ─── 店販分析 (product) パーサー ─────────────────────────────────────────────

function parseProduct(html: string): object {
  const $ = cheerio.load(html)
  const products: object[] = []

  const { rows } = extractDataTable($, 0)

  for (const row of rows) {
    if (row.length < 2) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    products.push({
      name,
      count: parseAmount(row[1] || '0'),
      sales: row.length > 2 ? parseAmount(row[2] || '0') : 0,
      ratio: row.length > 3 ? (parsePercentFromCell(row[3]) || parseAmount(row[3])) : 0,
    })
  }

  return { products }
}

// ─── 汎用パーサー（その他の分析タイプ用）────────────────────────────────────

function parseGeneric(html: string): object {
  const $ = cheerio.load(html)
  const tables: { headers: string[]; rows: string[][] }[] = []

  $('table.data').each((i) => {
    const t = extractDataTable($, i)
    if (t.rows.length > 0) tables.push(t)
  })

  // fallback if no table.data found
  if (tables.length === 0) {
    $('table').not('.search').each((_, el) => {
      const table = $(el)
      const t = extractFromTable($, table)
      if (t.rows.length > 0) tables.push(t)
    })
  }

  return { tables }
}

// ─── メインパーサーディスパッチャー ──────────────────────────────────────────

export function parseAnalysisHTML(type: AnalysisType, html: string): object {
  switch (type) {
    case 'reserve': return parseReserve(html)
    case 'account': return parseAccount(html)
    case 'repeat': return parseRepeat(html)
    case 'stylist': return parseStylist(html)
    case 'menu': return parseMenu(html)
    case 'product': return parseProduct(html)
    default: return parseGeneric(html)
  }
}
