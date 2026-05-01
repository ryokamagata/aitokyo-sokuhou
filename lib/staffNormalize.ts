/**
 * スタッフ名を正規化して同一人物を統合するためのユーティリティ
 *
 * BM上のスタッフ名パターン:
 * - "堀江優 【横浜駅】" → "堀江優"
 * - "太陽 渋谷" → "太陽"
 * - "野間 淳人 [池袋]" → "野間 淳人"
 * - "saki ［横浜駅］" → "saki"
 * - "松永瑞生 男性限定" → "松永瑞生"
 *
 * 追加処理:
 * - 内部スペースの除去（「堀江 優」/「堀江優」を統合）
 * - ローマ字小文字化（"REIJI"/"Reiji"を統合）
 * - エイリアス辞書による表記ゆれ吸収（"れいじ" → "reiji" 等）
 */

const LOCATION_KEYWORDS = [
  '渋谷駅', '横浜駅', '池袋駅', '下北沢駅', '名古屋駅',
  '名古屋/栄', '名古屋栄',
  '渋谷', '横浜', '池袋', '下北沢', '名古屋',
  'Rita', 'rita', 'Sea', 'sea', 'ams', 'Ciel', 'ciel',
  '男性限定', '女性限定', 'メンズ', 'レディース',
]

// 同一人物の表記ゆれ（BM上で複数の表記が混在する既知ケース）
// キーは「全空白除去 + 小文字化」後の文字列
const ALIASES: Record<string, string> = {
  // ローマ字 ↔ ひらがな
  'れいじ': 'reiji',
  'えりか': 'erika',
  'りも': 'rimo',
  // ひらがな ↔ カタカナ
  'りこ': 'リコ',
  'ほのピス': 'ほのぴす',
  // ニックネームと本名
  '上野龍乃助': 'りゅうさん',
  '山本陽星': '陽星',
  // 表記ゆれ・誤記
  'naouki': 'naoyuki',
  '中村つばさ': '中村翼名古屋',
  '小平トオル': '小平徹',
  '立石旭': '立石旭良',
  'こーよー': 'こーよ',
  '航洋': 'こーよ',
  '鈴木晴人': '鈴木晴翔',
  '松本悠太郎': '松本悠太朗',
  '小林有紗': '小林有沙',
  'まさき': 'マサキ',
  'そうま': 'souma',
  '隼多': '尾関隼多',
  // 鎌形さん確認済の追加紐付け
  '松舘拓也': 'taku',
  'げんき': '関口元輝',
  '中村翼': '中村翼名古屋',
  'ryota': '木暮亮太',
  'せいや': '古川誠哉',
}

export function normalizeStaffName(name: string): string {
  let n = name.trim()

  // 1. ブラケット内を除去（〔〕も含む）
  n = n.replace(/[\[【［（(〔][^\]】］）)〕]*[\]】］）)〕]/g, '').trim()

  // 2. 末尾の場所キーワードを除去（長い順にマッチ）
  const sorted = [...LOCATION_KEYWORDS].sort((a, b) => b.length - a.length)
  for (const kw of sorted) {
    const pattern = new RegExp(`\\s+${escapeRegex(kw)}\\s*$`, 'i')
    if (pattern.test(n)) {
      n = n.replace(pattern, '').trim()
      break
    }
  }

  // 3. 全空白を除去（半角・全角・タブ）+ ローマ字小文字化
  n = n.replace(/[\s　]+/g, '').toLowerCase()

  // 4. 既知の表記ゆれをエイリアスで吸収
  if (ALIASES[n]) n = ALIASES[n]

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
      if (staff.length < existing.displayName.length) {
        existing.displayName = staff
      }
    } else {
      map.set(key, { displayName: staff, sales })
    }
  }

  return Array.from(map.values())
    .filter(({ displayName }) => displayName !== 'フリー' && displayName !== '不明')
    .map(({ displayName, sales }) => ({ staff: displayName, sales }))
    .sort((a, b) => b.sales - a.sales)
}
