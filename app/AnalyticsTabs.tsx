'use client'

import { useCallback, useEffect, useState } from 'react'
import StoreFilter from '@/components/StoreFilter'
import ScrapeButton from '@/components/ScrapeButton'
import ReserveAnalysis from '@/components/ReserveAnalysis'
import SalesAnalysis from '@/components/SalesAnalysis'
import RepeatAnalysis from '@/components/RepeatAnalysis'
import StaffAnalysis from '@/components/StaffAnalysis'
import MenuAnalysis from '@/components/MenuAnalysis'
import ProductAnalysis from '@/components/ProductAnalysis'
import GenericAnalysis from '@/components/GenericAnalysis'
import type { AnalysisType } from '@/lib/analysisTypes'

const TABS: { key: AnalysisType; label: string }[] = [
  { key: 'reserve', label: '予約' },
  { key: 'account', label: '売上' },
  { key: 'visitor', label: '来店客' },
  { key: 'unit', label: '客単価' },
  { key: 'repeat', label: 'リピート' },
  { key: 'stylist', label: 'スタッフ' },
  { key: 'menu', label: 'メニュー' },
  { key: 'product', label: '店販' },
  { key: 'occupancyrate', label: '稼働率' },
  { key: 'cycle', label: 'サイクル' },
  { key: 'user', label: '顧客' },
  { key: 'dp', label: 'DP' },
]

interface StoreData {
  bm_code: string
  store: string
  data: Record<string, unknown>
  scraped_at: string
}

export default function AnalyticsTabs({ year, month }: { year: number; month: number }) {
  const [activeTab, setActiveTab] = useState<AnalysisType>('reserve')
  const [storeFilter, setStoreFilter] = useState('all')
  const [stores, setStores] = useState<StoreData[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        type: activeTab,
        year: String(year),
        month: String(month),
      })
      if (storeFilter !== 'all') params.set('store', storeFilter)
      const res = await fetch(`/api/analysis?${params}`)
      const json = await res.json()
      setStores(json.stores ?? [])
    } catch {
      setStores([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, year, month, storeFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredStores = storeFilter === 'all'
    ? stores
    : stores.filter((s) => s.bm_code === storeFilter)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <StoreFilter value={storeFilter} onChange={setStoreFilter} />
      </div>

      {/* Scrape button with progress */}
      <ScrapeButton
        url="/api/scrape-analysis"
        label="全分析データ同期"
        onDone={fetchData}
      />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-gray-400 text-sm text-center py-8">読み込み中...</div>
      ) : (
        <AnalysisContent type={activeTab} stores={filteredStores} />
      )}
    </div>
  )
}

function AnalysisContent({
  type,
  stores,
}: {
  type: AnalysisType
  stores: StoreData[]
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = stores.map((s) => ({ store: s.store, bm_code: s.bm_code, data: s.data as any }))

  switch (type) {
    case 'reserve':
      return <ReserveAnalysis stores={data} />
    case 'account':
      return <SalesAnalysis stores={data} />
    case 'repeat':
      return <RepeatAnalysis stores={data} />
    case 'stylist':
      return <StaffAnalysis stores={data} />
    case 'menu':
      return <MenuAnalysis stores={data} />
    case 'product':
      return <ProductAnalysis stores={data} />
    default: {
      const label = TABS.find((t) => t.key === type)?.label ?? type
      return <GenericAnalysis stores={data} label={label} />
    }
  }
}
