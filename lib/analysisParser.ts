import * as cheerio from 'cheerio'
import type { AnalysisType } from './analysisTypes'

// ─── 共通ユーティリティ ──────────────────────────────────────────────────────

function parseAmount(text: string): number {
  const cleaned = text.replace(/[^\d.-]/g, '')
  return parseFloat(cleaned) || 0
}

function parsePercent(text: string): number {
  const match = text.match(/([\d.]+)\s*%/)
  return match ? parseFloat(match[1]) : 0
}

/** テーブルからヘッダーと行データを抽出 */
function extractTable($: cheerio.CheerioAPI, tableIndex: number = 0): {
  headers: string[]
  rows: string[][]
} {
  const table = $('table').eq(tableIndex)
  const headers: string[] = []
  const rows: string[][] = []

  // ヘッダー抽出
  table.find('thead tr, tr:first-child').first().find('th, td').each((_, el) => {
    headers.push($(el).text().trim())
  })

  // 行データ抽出
  table.find('tbody tr').each((_, tr) => {
    const cells: string[] = []
    $(tr).find('td').each((_, td) => {
      cells.push($(td).text().trim())
    })
    if (cells.length > 0) rows.push(cells)
  })

  return { headers, rows }
}

// ─── 予約分析 (reserve) パーサー ─────────────────────────────────────────────

function parseReserve(html: string): object {
  const $ = cheerio.load(html)
  const channels: { name: string; count: number; ratio: number }[] = []
  const daily: { date: string; channels: Record<string, number> }[] = []

  // チャネル名をlegendまたはヘッダーから取得
  const channelNames: string[] = []
  const { headers, rows } = extractTable($, 1)

  // ヘッダーからチャネル名を取得（日付列を除く）
  for (let i = 1; i < headers.length; i++) {
    const name = headers[i].replace(/\s*件数.*|構成比.*/g, '').trim()
    if (name && !channelNames.includes(name)) channelNames.push(name)
  }

  // 合計行を見つけてサマリーを抽出
  let total = 0
  for (const row of rows) {
    if (!row[0]) continue
    const isTotal = /合計|総計/.test(row[0])

    if (isTotal) {
      // 件数列を偶数インデックス（件数, 構成比の交互）
      for (let i = 0; i < channelNames.length; i++) {
        const countIdx = 1 + i * 2
        const ratioIdx = 2 + i * 2
        if (countIdx < row.length) {
          const count = parseAmount(row[countIdx])
          const ratio = ratioIdx < row.length ? parsePercent(row[ratioIdx]) : 0
          channels.push({ name: channelNames[i], count, ratio })
          total += count
        }
      }
    } else {
      // 日別データ
      const dateMatch = row[0].match(/(\d{4}-\d{2}-\d{2}|\d+\/\d+)/)
      if (dateMatch) {
        const dayChannels: Record<string, number> = {}
        for (let i = 0; i < channelNames.length; i++) {
          const countIdx = 1 + i * 2
          if (countIdx < row.length) {
            dayChannels[channelNames[i]] = parseAmount(row[countIdx])
          }
        }
        daily.push({ date: row[0].trim(), channels: dayChannels })
      }
    }
  }

  return { total, channels, daily }
}

// ─── 売上分析 (account) パーサー ─────────────────────────────────────────────

function parseAccount(html: string): object {
  const $ = cheerio.load(html)
  const daily: object[] = []
  let summary = { pureSales: 0, avgSpend: 0, totalCustomers: 0, namedSales: 0, namedCount: 0, totalSales: 0 }

  const { rows } = extractTable($, 1)

  for (const row of rows) {
    if (row.length < 8) continue
    const isTotal = /合計|総計/.test(row[0])

    const record = {
      pureSales: parseAmount(row[1] || row[0]),
      avgSpend: parseAmount(row[2] || '0'),
      customers: parseAmount(row[3] || '0'),
      namedSales: parseAmount(row[4] || '0'),
      namedSpend: parseAmount(row[5] || '0'),
      namedCount: parseAmount(row[6] || '0'),
      totalSales: parseAmount(row[7] || '0'),
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
    } else {
      const dateMatch = row[0].match(/(\d{4}-\d{2}-\d{2}|\d+\/\d+)/)
      if (dateMatch) {
        daily.push({ date: row[0].trim(), ...record })
      }
    }
  }

  return { summary, daily }
}

// ─── リピート分析 (repeat) パーサー ──────────────────────────────────────────

function parseRepeat(html: string): object {
  const $ = cheerio.load(html)
  const categories: object[] = []

  const { rows } = extractTable($, 0)

  for (const row of rows) {
    if (row.length < 4) continue
    const type = row[0].trim()
    if (!type || /合計|総計/.test(type)) continue

    const count = parseAmount(row[1])
    const ratio = parsePercent(row[2])
    const months: { month: number; rate: number }[] = []

    // 3列目以降が各月の再来店率
    for (let i = 3; i < row.length; i++) {
      const rate = parsePercent(row[i])
      months.push({ month: i - 2, rate })
    }

    categories.push({ type, count, ratio, months })
  }

  // 元の月を取得
  const baseMonth = $('select, .period, h2, h3').text().match(/(\d{4})年(\d{1,2})月/)
  const baseStr = baseMonth ? `${baseMonth[1]}-${baseMonth[2].padStart(2, '0')}` : ''

  return { baseMonth: baseStr, categories }
}

// ─── スタッフ分析 (stylist) パーサー ─────────────────────────────────────────

function parseStylist(html: string): object {
  const $ = cheerio.load(html)
  const staff: object[] = []

  const { rows } = extractTable($, 1)

  for (const row of rows) {
    if (row.length < 4) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    staff.push({
      name,
      sales: parseAmount(row[1]),
      customers: parseAmount(row[2] || row[3] || '0'),
      avgSpend: parseAmount(row[3] || row[2] || '0'),
    })
  }

  return { staff }
}

// ─── メニュー分析 (menu) パーサー ───────────────────────────────────────────

function parseMenu(html: string): object {
  const $ = cheerio.load(html)
  const menus: object[] = []

  const { rows } = extractTable($, 1)

  for (const row of rows) {
    if (row.length < 3) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    menus.push({
      name,
      count: parseAmount(row[1] || '0'),
      sales: parseAmount(row[2] || '0'),
      ratio: row.length > 3 ? parsePercent(row[3]) : 0,
    })
  }

  return { menus }
}

// ─── 店販分析 (product) パーサー ─────────────────────────────────────────────

function parseProduct(html: string): object {
  const $ = cheerio.load(html)
  const products: object[] = []

  const { rows } = extractTable($, 1)

  for (const row of rows) {
    if (row.length < 3) continue
    const name = row[0].trim()
    if (!name || /合計|小計|総計/.test(name)) continue

    products.push({
      name,
      count: parseAmount(row[1] || '0'),
      sales: parseAmount(row[2] || '0'),
      ratio: row.length > 3 ? parsePercent(row[3]) : 0,
    })
  }

  return { products }
}

// ─── 汎用パーサー（その他の分析タイプ用）────────────────────────────────────

function parseGeneric(html: string): object {
  const $ = cheerio.load(html)
  const tables: { headers: string[]; rows: string[][] }[] = []

  $('table').each((i) => {
    const t = extractTable($, i)
    if (t.rows.length > 0) tables.push(t)
  })

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
