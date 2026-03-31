/**
 * スタッフ名を正規化して同一人物を統合するためのユーティリティ
 *
 * BM上のスタッフ名パターン:
 * - "堀江優 【横浜駅】" → "堀江優"
 * - "太陽 渋谷" → "太陽"
 * - "野間 淳人 [池袋]" → "野間 淳人"
 * - "saki ［横浜駅］" → "saki"
 * - "松永瑞生 男性限定" → "松永瑞生"
 */

// 店舗・場所に関連するキーワード（スタッフ名の末尾から除去）
const LOCATION_KEYWORDS = [
  '渋谷駅', '横浜駅', '池袋駅', '下北沢駅', '名古屋駅',
  '渋谷', '横浜', '池袋', '下北沢', '名古屋栄', '名古屋',
  'Rita', 'rita', 'Sea', 'sea', 'ams', 'Ciel', 'ciel',
  '男性限定', '女性限定', 'メンズ', 'レディース',
]

export function normalizeStaffName(name: string): string {
  let n = name.trim()

  // 1. ブラケット内を除去: [...], 【...】, ［...］, （...）, (...)
  n = n.replace(/[\[【［（(][^\]】］）)]*[\]】］）)]/g, '').trim()

  // 2. 末尾の場所キーワードを除去（長い順にマッチ）
  const sorted = [...LOCATION_KEYWORDS].sort((a, b) => b.length - a.length)
  for (const kw of sorted) {
    // 末尾にキーワードがある場合のみ除去（スペース区切り）
    const pattern = new RegExp(`\\s+${escapeRegex(kw)}\\s*$`, 'i')
    if (pattern.test(n)) {
      n = n.replace(pattern, '').trim()
      break // 1つだけ除去
    }
  }

  // 3. 全角スペースを半角に統一、連続スペースを1つに
  n = n.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()

  return n
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * スタッフ売上データを名前で統合して返す
 */
export function mergeStaffSales(
  data: { staff: string; sales: number }[]
): { staff: string; sales: number }[] {
  const map = new Map<string, { displayName: string; sales: number }>()

  for (const { staff, sales } of data) {
    const key = normalizeStaffName(staff)
    const existing = map.get(key)
    if (existing) {
      existing.sales += sales
      // より短い名前を表示名として採用（ブラケットなしの方が見やすい）
      if (staff.length < existing.displayName.length) {
        existing.displayName = staff
      }
    } else {
      map.set(key, { displayName: normalizeStaffName(staff), sales })
    }
  }

  return Array.from(map.values())
    .map(({ displayName, sales }) => ({ staff: displayName, sales }))
    .sort((a, b) => b.sales - a.sales)
}
