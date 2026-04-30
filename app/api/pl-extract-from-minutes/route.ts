import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { extractPersonnelCandidates, type PersonnelCandidate } from '@/lib/personnelExtract'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 議事録（Notion）から人件費の候補を抽出する。
 * Notion API の search で検索 → ページ本文を取得 → 金額表現を抽出。
 *
 * 実行には環境変数 NOTION_TOKEN が必要（既存の lib/notion.ts と同じ）。
 *
 * POST body: { keywords?: string[], daysBack?: number, maxPages?: number }
 *   keywords: 検索クエリ（既定: ['人件費', '給与', '正社員', 'アシスタント', '新卒']）
 *   daysBack: 何日前までを対象にするか（既定: 90日）
 *   maxPages: 取得する議事録ページの最大数（既定: 12）
 *
 * Response: { ok, pages: [{ title, url, lastEdited, candidates }], totalCandidates }
 */

type ExtractedPage = {
  pageId: string
  title: string
  url: string
  lastEdited: string
  candidates: PersonnelCandidate[]
}

let _notion: Client | null = null
function getNotion() {
  if (!_notion) _notion = new Client({ auth: process.env.NOTION_TOKEN })
  return _notion
}

const DEFAULT_KEYWORDS = ['人件費', '給与', '正社員', 'アシスタント', '新卒', '役員報酬', '法定福利']

export async function POST(req: Request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({
      ok: false,
      error: 'NOTION_TOKENが設定されていません。Vercelの環境変数にNotion統合のシークレットトークンを設定してください。',
    }, { status: 500 })
  }
  const body = await req.json().catch(() => ({}))
  const keywords: string[] = Array.isArray(body.keywords) && body.keywords.length > 0
    ? body.keywords : DEFAULT_KEYWORDS
  const daysBack: number = body.daysBack ?? 90
  const maxPages: number = body.maxPages ?? 12

  const notion = getNotion()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const cutoffMs = cutoff.getTime()

  // ── 1. キーワード検索 ──────────────────────────────────
  type Hit = { id: string; title: string; url: string; lastEditedTime: string }
  const hitMap = new Map<string, Hit>()
  const searchErrors: { keyword: string; message: string }[] = []
  let totalSearchHits = 0
  let beforeCutoff = 0
  for (const kw of keywords) {
    try {
      const res = await notion.search({
        query: kw,
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 30,
      })
      totalSearchHits += res.results.length
      for (const p of res.results) {
        const pp = p as {
          id: string; url?: string; last_edited_time?: string
          properties?: Record<string, { title?: { plain_text?: string }[] }>
        }
        const lastEdited = pp.last_edited_time ?? ''
        if (lastEdited && new Date(lastEdited).getTime() < cutoffMs) {
          beforeCutoff++
          continue
        }
        if (hitMap.has(pp.id)) continue
        const titleProp = pp.properties ? Object.values(pp.properties).find(v => Array.isArray(v.title)) : undefined
        const title = titleProp?.title?.[0]?.plain_text ?? '(無題)'
        hitMap.set(pp.id, { id: pp.id, title, url: pp.url ?? '', lastEditedTime: lastEdited })
        if (hitMap.size >= maxPages) break
      }
    } catch (e) {
      searchErrors.push({ keyword: kw, message: e instanceof Error ? e.message : String(e) })
      continue
    }
    if (hitMap.size >= maxPages) break
  }

  const hits = [...hitMap.values()]
    .sort((a, b) => b.lastEditedTime.localeCompare(a.lastEditedTime))
    .slice(0, maxPages)

  // ── 2. 各ページの本文を取得して抽出 ─────────────────────
  const pages: ExtractedPage[] = []
  const fetchErrors: { title: string; message: string }[] = []
  let pagesWithoutCandidates = 0
  for (const h of hits) {
    try {
      const text = await fetchPageText(notion, h.id)
      const candidates = extractPersonnelCandidates(text)
      if (candidates.length === 0) {
        pagesWithoutCandidates++
        continue
      }
      pages.push({
        pageId: h.id,
        title: h.title,
        url: h.url,
        lastEdited: h.lastEditedTime,
        candidates,
      })
    } catch (e) {
      fetchErrors.push({ title: h.title, message: e instanceof Error ? e.message : String(e) })
      continue
    }
  }

  const totalCandidates = pages.reduce((s, p) => s + p.candidates.length, 0)

  // 全件0なら、なぜ0なのかを切り分けるヒントを返す
  let diagnosticHint: string | null = null
  if (totalCandidates === 0) {
    if (totalSearchHits === 0 && searchErrors.length === keywords.length) {
      diagnosticHint = 'Notion APIの検索すべてが失敗しました。NOTION_TOKEN の権限・有効性を確認してください。'
    } else if (totalSearchHits === 0) {
      diagnosticHint = `キーワード [${keywords.join('・')}] で1件もヒットしませんでした。Notion統合がワークスペースに招待されているか、または各議事録ページに統合が共有されているかを確認してください（ページ右上「共有」→ 統合を追加）。`
    } else if (hits.length === 0) {
      diagnosticHint = `${totalSearchHits}件ヒットしましたが、すべて${daysBack}日より古いページでした。daysBackを伸ばすか、最近の議事録に上記キーワードが入っているか確認してください。`
    } else if (pagesWithoutCandidates === hits.length) {
      diagnosticHint = `${hits.length}件のページを取得しましたが、人件費系の金額表現（"○○万円"・"22万×19人"・"4,500,000円"等）が同一文中にありませんでした。議事録での記述形式を確認してください。`
    } else {
      diagnosticHint = `本文取得に${fetchErrors.length}件失敗しました（権限不足の可能性）。`
    }
  }

  return NextResponse.json({
    ok: true,
    keywords,
    daysBack,
    pagesScanned: hits.length,
    pages,
    totalCandidates,
    diagnostics: {
      totalSearchHits,
      uniquePagesAfterCutoff: hits.length,
      beforeCutoff,
      pagesWithoutCandidates,
      searchErrors,
      fetchErrors,
      hint: diagnosticHint,
    },
  })
}

/** ページの全ブロックを再帰取得し plain_text を結合 */
async function fetchPageText(notion: Client, pageId: string, depth = 0): Promise<string> {
  if (depth > 3) return ''
  const out: string[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 })
    for (const block of res.results) {
      // PartialBlockObjectResponse には type が無い場合がある（権限不足など）
      const b = block as { id: string; type?: string; has_children?: boolean; [key: string]: unknown }
      if (!b.type) continue
      const text = extractBlockText(b as { type: string; [key: string]: unknown })
      if (text) out.push(text)
      if (b.has_children) {
        const child = await fetchPageText(notion, b.id, depth + 1)
        if (child) out.push(child)
      }
    }
    cursor = res.next_cursor ?? undefined
  } while (cursor)
  return out.join('\n')
}

function extractBlockText(b: { type: string; [key: string]: unknown }): string {
  const t = b.type
  const inner = b[t] as { rich_text?: { plain_text?: string }[] } | undefined
  if (!inner?.rich_text) return ''
  return inner.rich_text.map(r => r.plain_text ?? '').join('')
}
