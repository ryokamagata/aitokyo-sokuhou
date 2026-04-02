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

// 着地予測の詳細（3パターン + 根拠）
export type ForecastDetail = {
  standard: number           // 標準予測（ブレンド）
  conservative: number       // 堅実予測
  optimistic: number         // 高め見込み
  rationale: {
    paceEstimate: number       // DOWペース着地
    yoyEstimate: number | null // 前年同月×成長率
    prevYearSales: number | null // 前年同月実績
    yoyGrowthRate: number | null // 完了月平均YoY成長率(%)
    paceWeight: number         // ペース重み(0-1)
    dailyAvg: number           // 日平均売上
    monthProgress: number      // 月進捗率(0-1)
  }
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
  totalCustomers: number          // 合計総客数(今月来店)
  customerForecast: number        // 合計総客数 着地予測
  avgSpend: number                // 今月客単価
  newCustomers: number            // 合計新規人数
  newCustomerForecast: number     // 合計新規着地予測
  nominated: number               // 合計指名客数
  nominatedForecast: number       // 合計指名客数 着地予測
  freeVisit: number               // 合計フリー客数
  freeVisitForecast: number       // 合計フリー客数 着地予測
  nominationRate: string          // 指名率(%)
  freeRate: string                // フリー率(%) = 100% - 指名率
  newCustomerRate: string         // 新規率(%) = 新規人数 / 総客数
  newReturn3mRate: string         // 新規3ヶ月リターン率(%)
  totalUsers: number              // 総顧客数(登録)
  appMembers: number              // アプリ会員数
  appMemberRate: string           // アプリ会員率(%)
  forecastDetail: ForecastDetail | null  // 着地予測詳細（3パターン+根拠）
}
