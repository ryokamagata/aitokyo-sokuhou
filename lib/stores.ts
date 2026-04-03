// 席単価上限（円/席/月）— 10席→1200万, 15席→1750万, 20席→2400万 を基に算出
export const MAX_REVENUE_PER_SEAT = 1_200_000

// Shared store list (used by both server and client code)
export const STORES = [
  { name: 'AI TOKYO 渋谷', bm_code: '69110375', seats: 15 },
  { name: 'AI TOKYO Rita', bm_code: '11780846', seats: 10 },
  { name: 'AI TOKYO S', bm_code: '12479835', seats: 13 },
  { name: 'AI TOKYO 名古屋栄', bm_code: '28162229', seats: 10 },
  { name: "AI TOKYO men's 横浜", bm_code: '31132259', seats: 9 },
  { name: "AI TOKYO Ciel men's 横浜", bm_code: '27468498', seats: 16 },
  { name: "AI TOKYO men's 下北沢", bm_code: '46641695', seats: 10 },
  { name: "AI TOKYO men's 池袋", bm_code: '63811270', seats: 11 },
  { name: 'ams by AI TOKYO', bm_code: '94303402', seats: 3 },
  { name: 'AI TOKYO 名古屋 2nd', bm_code: '65211838', seats: 10 },
  { name: 'AITOKYO + Sea店 横浜', bm_code: '73245379', seats: 9 },
] as const

// 店舗名から月間売上上限を取得（席数 × 席単価上限）
export function getStoreRevenueCap(storeName: string): number | null {
  const store = STORES.find(s => storeName.includes(s.name) || s.name.includes(storeName))
  if (!store) return null
  return store.seats * MAX_REVENUE_PER_SEAT
}

// 閉店済み店舗（グレー表示・末尾配置）
export const CLOSED_STORES: string[] = [
  '福岡',
]

export function isClosedStore(storeName: string): boolean {
  return CLOSED_STORES.some(keyword => storeName.includes(keyword))
}
