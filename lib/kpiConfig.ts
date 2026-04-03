// 責任者別KPI設定・評価ロジック

export type Executive = 'kamagata' | 'nakajima' | 'matsudate' | 'creative'

export type KpiDefinition = {
  key: string
  label: string
  unit: string
  source: 'auto' | 'manual'  // auto = BMデータから自動取得, manual = 手動入力
  quarterly: boolean           // true = Q単位で集計
  mode: 'sum' | 'avg'         // sum = 合計, avg = 平均
}

export type ScoreThreshold = {
  points: number
  min: number       // この値以上でこのポイント
  label?: string
}

export type ExecutiveConfig = {
  id: Executive
  name: string
  role: string
  description: string
  kpis: (KpiDefinition & {
    quarterTargets: Record<number, number>  // Q番号 → 目標値
    scoring: ScoreThreshold[]               // 30点満点のスコア定義
  })[]
  scoreRanges: { min: number; max: number; rank: string; reward: string }[]
}

// ─── 評価ランク共通定義 ──────────────────────────────────────────

const COMMON_SCORE_RANGES = [
  { min: 81, max: 90, rank: 'S', reward: '+15万円' },
  { min: 71, max: 80, rank: 'A', reward: '+10万円' },
  { min: 61, max: 70, rank: 'B', reward: '+5万円' },
  { min: 51, max: 60, rank: 'C', reward: '変動なし' },
  { min: 0, max: 50, rank: 'D', reward: '-5万円' },
]

// ─── 中島社長 ──────────────────────────────────────────────────

const NAKAJIMA: ExecutiveConfig = {
  id: 'nakajima',
  name: '中島',
  role: '社長',
  description: '社内人事(キャリア)と教育を司る — 離職者を減らし、デビュー速度を早め、リーダーを育成',
  kpis: [
    {
      key: 'turnover',
      label: '離職人数',
      unit: '人',
      source: 'manual',
      quarterly: true,
      mode: 'sum',
      quarterTargets: { 3: 3, 4: 2, 1: 1 },
      scoring: [
        // 離職は少ないほど高得点（逆順）
        { points: 30, min: -Infinity, label: '0人' },  // 0人 = 30点 (特殊処理)
        { points: 25, min: 1, label: '1人' },
        { points: 20, min: 2, label: '2人' },
        { points: 15, min: 3, label: '3人' },
        { points: 10, min: 4, label: '4人' },
        { points: 5, min: 5, label: '5人' },
        { points: 0, min: 6, label: '6人以上' },
      ],
    },
    {
      key: 'debut',
      label: 'デビュー人数',
      unit: '人',
      source: 'manual',
      quarterly: true,
      mode: 'sum',
      quarterTargets: { 3: 5, 4: 4, 1: 4 },
      scoring: [
        { points: 30, min: 6 },
        { points: 25, min: 5 },
        { points: 20, min: 4 },
        { points: 15, min: 3 },
        { points: 10, min: 2 },
        { points: 5, min: 1 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'leader_index',
      label: 'リーダー育成指標',
      unit: '人',
      source: 'manual',
      quarterly: true,
      mode: 'sum',
      quarterTargets: { 3: 3, 4: 4, 1: 5 },
      scoring: [
        { points: 30, min: 7 },
        { points: 25, min: 6 },
        { points: 20, min: 5 },
        { points: 15, min: 4 },
        { points: 10, min: 3 },
        { points: 5, min: 2 },
        { points: 0, min: 0 },
      ],
    },
  ],
  scoreRanges: COMMON_SCORE_RANGES,
}

// ─── 松舘執行役員 ──────────────────────────────────────────────

// 月別目標
const MATSUDATE_MONTHLY: Record<number, { newCustomers: number; returnRate: number; productivity: number }> = {
  1: { newCustomers: 2120, returnRate: 37, productivity: 78 },
  2: { newCustomers: 2162, returnRate: 28, productivity: 79 },
  3: { newCustomers: 2500, returnRate: 35, productivity: 100 },
  4: { newCustomers: 2400, returnRate: 35, productivity: 95 },
  5: { newCustomers: 2300, returnRate: 37, productivity: 80 },
  6: { newCustomers: 2300, returnRate: 37, productivity: 80 },
  7: { newCustomers: 2700, returnRate: 38, productivity: 120 },
  8: { newCustomers: 2600, returnRate: 38, productivity: 110 },
  9: { newCustomers: 2500, returnRate: 38, productivity: 80 },
  10: { newCustomers: 2500, returnRate: 40, productivity: 80 },
  11: { newCustomers: 2500, returnRate: 40, productivity: 80 },
  12: { newCustomers: 3000, returnRate: 40, productivity: 140 },
}

const MATSUDATE: ExecutiveConfig = {
  id: 'matsudate',
  name: '松舘',
  role: '執行役員',
  description: '集客と採用(戦略)を司る — 会社全体の集客増加、ブランド戦略の実行',
  kpis: [
    {
      key: 'new_customers',
      label: '新規人数',
      unit: '人',
      source: 'auto',
      quarterly: true,
      mode: 'sum',
      quarterTargets: { 3: 7000, 4: 7800, 1: 8000 },
      scoring: [
        { points: 30, min: 7000 },
        { points: 25, min: 6833 },
        { points: 20, min: 6750 },
        { points: 15, min: 6667 },
        { points: 10, min: 6584 },
        { points: 5, min: 6501 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'return_rate',
      label: 'リターン率',
      unit: '%',
      source: 'auto',
      quarterly: true,
      mode: 'avg',
      quarterTargets: { 3: 36.3, 4: 38, 1: 40 },
      scoring: [
        { points: 30, min: 37 },
        { points: 25, min: 35 },
        { points: 20, min: 33 },
        { points: 15, min: 31 },
        { points: 10, min: 29 },
        { points: 5, min: 27 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'productivity',
      label: '生産性',
      unit: '万円',
      source: 'auto',
      quarterly: true,
      mode: 'avg',
      quarterTargets: { 3: 85, 4: 103, 1: 100 },
      scoring: [
        { points: 30, min: 90 },
        { points: 25, min: 85 },
        { points: 20, min: 80 },
        { points: 15, min: 75 },
        { points: 10, min: 70 },
        { points: 5, min: 65 },
        { points: 0, min: 0 },
      ],
    },
  ],
  scoreRanges: COMMON_SCORE_RANGES,
}

// ─── クリエイティブ責任者 ──────────────────────────────────────

const CREATIVE_MONTHLY: Record<number, { hpbStyles: number; instagram: number; unitPrice: number }> = {
  1: { hpbStyles: 18, instagram: 3701, unitPrice: 10295 },
  2: { hpbStyles: 18, instagram: 3701, unitPrice: 10352 },
  3: { hpbStyles: 18, instagram: 3701, unitPrice: 11500 },
  4: { hpbStyles: 21, instagram: 4000, unitPrice: 11000 },
  5: { hpbStyles: 24, instagram: 4500, unitPrice: 10500 },
  6: { hpbStyles: 27, instagram: 5000, unitPrice: 10500 },
  7: { hpbStyles: 31, instagram: 5600, unitPrice: 12000 },
  8: { hpbStyles: 35, instagram: 6400, unitPrice: 12000 },
  9: { hpbStyles: 38, instagram: 7000, unitPrice: 11000 },
  10: { hpbStyles: 41, instagram: 8000, unitPrice: 11000 },
  11: { hpbStyles: 45, instagram: 9000, unitPrice: 11000 },
  12: { hpbStyles: 50, instagram: 10000, unitPrice: 12500 },
}

const CREATIVE: ExecutiveConfig = {
  id: 'creative',
  name: '堀江・上野',
  role: 'クリエイティブ責任者',
  description: '全体のスタイルと撮影クオリティを司る — スタイルの品質向上、売上につながる成果を出す',
  kpis: [
    {
      key: 'hpb_styles',
      label: 'HPBスタイル閲覧1000件以上',
      unit: '件',
      source: 'manual',
      quarterly: true,
      mode: 'avg',
      quarterTargets: { 3: 24, 4: 35, 1: 45 },
      scoring: [
        { points: 30, min: 26 },
        { points: 25, min: 24 },
        { points: 20, min: 22 },
        { points: 15, min: 20 },
        { points: 10, min: 18 },
        { points: 5, min: 16 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'instagram_followers',
      label: '公式インスタフォロワー数',
      unit: '人',
      source: 'manual',
      quarterly: false,
      mode: 'avg',
      quarterTargets: { 3: 5000, 4: 7000, 1: 10000 },
      scoring: [
        { points: 30, min: 2800 },
        { points: 25, min: 2500 },
        { points: 20, min: 2300 },
        { points: 15, min: 2100 },
        { points: 10, min: 1900 },
        { points: 5, min: 1850 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'avg_unit_price',
      label: 'グループ全店舗平均客単価',
      unit: '円',
      source: 'auto',
      quarterly: true,
      mode: 'avg',
      quarterTargets: { 3: 10700, 4: 11700, 1: 11500 },
      scoring: [
        { points: 30, min: 11500 },
        { points: 25, min: 11000 },
        { points: 20, min: 10700 },
        { points: 15, min: 10400 },
        { points: 10, min: 10100 },
        { points: 5, min: 9800 },
        { points: 0, min: 0 },
      ],
    },
  ],
  scoreRanges: COMMON_SCORE_RANGES,
}

// ─── 鎌形会長 ──────────────────────────────────────────────────

const KAMAGATA: ExecutiveConfig = {
  id: 'kamagata',
  name: '鎌形',
  role: '会長',
  description: 'お金と全体の意思決定を司る — 年商11億・利益率5%の達成',
  kpis: [
    {
      key: 'annual_revenue',
      label: '年商',
      unit: '億円',
      source: 'auto',
      quarterly: false,
      mode: 'sum',
      quarterTargets: { 3: 11, 4: 11, 1: 11 },
      scoring: [
        { points: 45, min: 12 },
        { points: 40, min: 11.5 },
        { points: 35, min: 11 },
        { points: 25, min: 10.5 },
        { points: 15, min: 10 },
        { points: 0, min: 0 },
      ],
    },
    {
      key: 'profit_rate',
      label: '営業利益率',
      unit: '%',
      source: 'manual',
      quarterly: false,
      mode: 'avg',
      quarterTargets: { 3: 5, 4: 5, 1: 5 },
      scoring: [
        { points: 45, min: 6 },
        { points: 40, min: 5.5 },
        { points: 35, min: 5 },
        { points: 25, min: 4 },
        { points: 15, min: 3 },
        { points: 0, min: 0 },
      ],
    },
  ],
  scoreRanges: COMMON_SCORE_RANGES,
}

// ─── エクスポート ──────────────────────────────────────────────

export const EXECUTIVES: ExecutiveConfig[] = [KAMAGATA, NAKAJIMA, MATSUDATE, CREATIVE]

export const MATSUDATE_MONTHLY_TARGETS = MATSUDATE_MONTHLY
export const CREATIVE_MONTHLY_TARGETS = CREATIVE_MONTHLY

/** KPI値からスコア(点数)を計算 */
export function calculateScore(value: number, scoring: ScoreThreshold[], isReverse = false): number {
  if (isReverse) {
    // 離職人数のように少ないほど良い場合
    if (value === 0) return 30
    for (const s of scoring) {
      if (s.min !== -Infinity && value <= s.min) return s.points
    }
    return 0
  }
  // 通常: 大きいほど良い
  for (const s of scoring) {
    if (value >= s.min) return s.points
  }
  return 0
}

/** 合計スコアから評価ランクを取得 */
export function getScoreRank(total: number, ranges: ExecutiveConfig['scoreRanges']): { rank: string; reward: string } {
  for (const r of ranges) {
    if (total >= r.min && total <= r.max) return { rank: r.rank, reward: r.reward }
  }
  return { rank: 'D', reward: '-5万円' }
}

/** 現在のQ番号を取得 */
export function getCurrentQuarter(month: number): number {
  if (month >= 4 && month <= 6) return 3
  if (month >= 7 && month <= 9) return 4
  if (month >= 10 && month <= 12) return 1
  return 2 // 1-3月
}

/** Q番号から月リストを取得 */
export function getQuarterMonths(quarter: number): number[] {
  const quarters: Record<number, number[]> = { 1: [10, 11, 12], 2: [1, 2, 3], 3: [4, 5, 6], 4: [7, 8, 9] }
  return quarters[quarter] ?? []
}
