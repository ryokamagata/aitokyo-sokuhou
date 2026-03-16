// BM CSV から解析した生データ1行
export type BMRow = {
  date: string       // "YYYY-MM-DD" 正規化済み
  store: string      // 店舗名
  staff: string      // スタッフ名
  amount: number     // 売上金額
  customers: number  // 客数
  menu: string       // メニュー
}

// 日別集計
export type DailySales = {
  date: string       // "YYYY-MM-DD"
  dayOfWeek: number  // 0=日, 1=月, ..., 6=土
  totalAmount: number
  customers: number
  newCustomers?: number
  stores: Record<string, number>  // 店舗名 → 売上
  staff: Record<string, number>   // スタッフ名 → 売上
}

// 予測結果
export type ForecastResult = {
  actualTotal: number
  projectedTotal: number     // 残り日数の予測合計
  forecastTotal: number      // 実績 + 予測
  confidence: 'high' | 'medium' | 'low'
  dailyProjections: { date: string; projected: number }[]
  dowAverages: Record<number, number>  // 曜日 → 平均売上
}

// API レスポンス
export type DashboardData = {
  year: number
  month: number
  today: number
  daysInMonth: number
  totalSales: number
  monthlyTarget: number | null
  achievementRate: number | null
  forecast: ForecastResult
  storeBreakdown: { store: string; sales: number }[]
  staffBreakdown: { staff: string; sales: number }[]
  dailyData: { date: string; sales: number; cumulative: number }[]
  lastUpdated: string
  // 顧客KPI
  totalCustomers: number      // 総客数(今月来店)
  avgSpend: number             // 客単価
  newCustomers: number         // 新規人数
  newCustomerForecast: number  // 新規着地予測
  nominated: number            // 指名客数
  freeVisit: number            // フリー客数
  nominationRate: string       // 指名率(%)
  newCustomerRate: string      // 新規率(%)
  newReturn3mRate: string      // 新規3ヶ月リターン率(%)
  totalUsers: number           // 総顧客数(登録)
  appMembers: number           // アプリ会員数
  appMemberRate: string        // アプリ会員率(%)
}
