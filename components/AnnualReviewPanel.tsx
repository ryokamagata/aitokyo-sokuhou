'use client'

import { useState } from 'react'
import { generateAnnualReview, type AnnualReviewInput, type ReviewItem } from '@/lib/reviewRules'

export default function AnnualReviewPanel({
  projection,
  annualSummaries,
  staffSummary,
  totalMonthly,
}: AnnualReviewInput) {
  const [open, setOpen] = useState(true)
  const items = generateAnnualReview({ projection, annualSummaries, staffSummary, totalMonthly })

  if (items.length === 0) return null

  const goodCount = items.filter(i => i.type === 'good').length
  const warnCount = items.filter(i => i.type === 'warning').length

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* ヘッダー */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">
            年間レビュー
          </span>
          {projection && (
            <span className="text-xs text-gray-500">
              ({projection.currentYear}年)
            </span>
          )}
          <div className="flex items-center gap-1.5 ml-2">
            {goodCount > 0 && (
              <span className="text-xs bg-emerald-900/50 text-emerald-400 px-1.5 py-0.5 rounded">
                GOOD {goodCount}
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-xs bg-amber-900/50 text-amber-400 px-1.5 py-0.5 rounded">
                改善 {warnCount}
              </span>
            )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* コンテンツ */}
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {items.map((item, idx) => (
            <ReviewCard key={idx} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const isGood = item.type === 'good'

  return (
    <div
      className={`rounded-lg p-3 ${
        isGood
          ? 'bg-emerald-950/40 border border-emerald-800/30'
          : 'bg-amber-950/40 border border-amber-800/30'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm mt-0.5 shrink-0">
          {isGood ? '\u2705' : '\u26A0\uFE0F'}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              isGood ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {item.title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {item.detail}
          </p>
          {item.action && (
            <p className="text-xs mt-1.5 text-gray-300 bg-gray-800/60 rounded px-2 py-1.5">
              <span className="text-gray-500 mr-1">&rarr;</span>
              {item.action}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
