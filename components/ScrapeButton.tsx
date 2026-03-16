'use client'

import { useState, useRef } from 'react'

interface Progress {
  phase: string
  current: number
  total: number
  storeName?: string
  detail?: string
}

export default function ScrapeButton({
  url,
  label,
  onDone,
}: {
  url: string
  label: string
  onDone: () => void
}) {
  const [scraping, setScraping] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const handleScrape = async () => {
    setScraping(true)
    setProgress(null)
    setResult(null)
    setIsError(false)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch(url, { method: 'POST', signal: abort.signal })

      if (!res.body) {
        throw new Error('No response body')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'progress') {
              setProgress({
                phase: data.phase,
                current: data.current,
                total: data.total,
                storeName: data.storeName,
                detail: data.detail,
              })
            } else if (data.type === 'done') {
              if (data.success) {
                const parts: string[] = []
                if (data.storesScraped != null) parts.push(`${data.storesScraped}店舗`)
                if (data.recordsStored != null) parts.push(`${data.recordsStored}件`)
                if (data.typesScraped != null) parts.push(`${data.typesScraped}タイプ`)
                const errCount = data.errors?.length ?? 0
                const msg = `${parts.join('・')}を取得${errCount > 0 ? `（${errCount}件エラー）` : ''}`
                setResult(msg)
                setIsError(false)
                onDone()
              } else {
                setResult(`エラー: ${data.error}`)
                setIsError(true)
              }
            }
          } catch {
            // skip invalid JSON
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setResult('通信エラーが発生しました')
        setIsError(true)
      }
    } finally {
      setScraping(false)
      setProgress(null)
      abortRef.current = null
    }
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          onClick={handleScrape}
          disabled={scraping}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            scraping
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {scraping ? '同期中...' : label}
        </button>
        {result && (
          <span className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>
            {result}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {scraping && progress && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-10 text-right shrink-0">{pct}%</span>
          </div>
          <p className="text-xs text-gray-500">
            {progress.phase === 'login' ? (
              'BMにログイン中...'
            ) : progress.phase === 'done' ? (
              '完了'
            ) : (
              <>
                {progress.current}/{progress.total}
                {progress.storeName && (
                  <span className="text-gray-400 ml-1">- {progress.storeName}</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {/* Waiting spinner before first progress */}
      {scraping && !progress && (
        <p className="text-xs text-gray-500">接続中...</p>
      )}
    </div>
  )
}
