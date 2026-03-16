// BM分析タイプの定義

export const ANALYSIS_TYPES = [
  'reserve', 'visitor', 'unit', 'user', 'repeat', 'cycle',
  'occupancyrate', 'dp', 'account', 'stylist', 'menu', 'product',
] as const

export type AnalysisType = typeof ANALYSIS_TYPES[number]

export const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  reserve: '予約分析',
  visitor: '来店客分析',
  unit: '客単価分析',
  user: '顧客分析',
  repeat: 'リピート分析',
  cycle: 'サイクル分析',
  occupancyrate: '稼働率',
  dp: 'DP分析',
  account: '売上分析',
  stylist: 'スタッフ分析',
  menu: 'メニュー分析',
  product: '店販分析',
}

// 予約分析データ
export interface ReserveData {
  total: number
  channels: { name: string; count: number; ratio: number }[]
  daily: { date: string; channels: Record<string, number> }[]
}

// 売上分析データ
export interface AccountData {
  summary: {
    pureSales: number
    avgSpend: number
    totalCustomers: number
    namedSales: number
    namedCount: number
    totalSales: number
  }
  daily: {
    date: string
    pureSales: number
    avgSpend: number
    customers: number
    namedSales: number
    namedSpend: number
    namedCount: number
    totalSales: number
  }[]
}

// リピート分析データ
export interface RepeatData {
  baseMonth: string
  categories: {
    type: string
    count: number
    ratio: number
    months: { month: number; rate: number; count: number }[]
    lostCount: number
    lostRate: number
  }[]
}

// スタッフ分析データ
export interface StylistData {
  staff: {
    name: string
    sales: number
    customers: number
    avgSpend: number
    namedRate: number
  }[]
}

// メニュー分析データ
export interface MenuData {
  menus: {
    name: string
    count: number
    sales: number
    ratio: number
  }[]
}

// 店販分析データ
export interface ProductData {
  products: {
    name: string
    count: number
    sales: number
    ratio: number
  }[]
}

// 来店客分析データ
export interface VisitorData {
  summary: {
    total: number
    newCustomers: number
    repeatCustomers: number
    regularCustomers: number
  }
  daily: {
    date: string
    total: number
    new: number
    repeat: number
    regular: number
  }[]
}

// 客単価分析データ
export interface UnitPriceData {
  summary: {
    avgSpend: number
    namedAvg: number
    freeAvg: number
  }
  daily: {
    date: string
    avgSpend: number
    namedAvg: number
    freeAvg: number
  }[]
}

// 稼働率データ
export interface OccupancyData {
  summary: {
    rate: number
    totalSlots: number
    usedSlots: number
  }
  daily: {
    date: string
    rate: number
    totalSlots: number
    usedSlots: number
  }[]
}

// 汎用テーブルデータ（未対応の分析タイプ用）
export interface GenericTableData {
  headers: string[]
  rows: string[][]
}

// DB保存用の統合型
export interface AnalysisRecord {
  analysis_type: AnalysisType
  bm_code: string
  store: string
  period_start: string
  period_end: string
  data_json: string
}

// API レスポンス
export interface AnalysisResponse {
  type: AnalysisType
  label: string
  stores: {
    bm_code: string
    store: string
    data: unknown
    scraped_at: string
  }[]
}
