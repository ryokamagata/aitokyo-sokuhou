'use client'

import { STORES } from '@/lib/stores'

export default function StoreFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-700 text-gray-200 text-xs rounded-lg px-3 py-1.5 border border-gray-600 focus:outline-none focus:border-blue-500"
    >
      <option value="all">全店舗</option>
      {STORES.map((s) => (
        <option key={s.bm_code} value={s.bm_code}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
