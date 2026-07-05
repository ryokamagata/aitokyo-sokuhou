'use client'

import { useEffect, useState } from 'react'

export default function BmSettings() {
  const [open, setOpen] = useState(false)
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/settings/bm-credentials', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setLoginId(data.loginId ?? '')
          setUpdatedAt(data.updatedAt ?? null)
        }
      })
      .catch(() => {})
  }, [open])

  const save = async () => {
    if (!password) {
      setMessage({ type: 'error', text: '新しいパスワードを入力してください' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/bm-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error ?? '保存に失敗しました' })
        return
      }
      setMessage({ type: 'success', text: 'BMへのログインを確認して保存しました' })
      setPassword('')
      setUpdatedAt(new Date().toISOString())
    } catch {
      setMessage({ type: 'error', text: '通信エラーが発生しました' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setMessage(null)
          setPassword('')
          setOpen(true)
        }}
        className="text-xs px-3 py-1.5 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-md transition-colors whitespace-nowrap"
      >
        BM設定
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-white font-bold text-sm">BMログイン設定</h2>
              <p className="text-gray-500 text-xs mt-1">
                売上取得に使うBeautyMeritのログイン情報を変更します。保存前にBMへ実際にログインして検証します。
              </p>
              {updatedAt && (
                <p className="text-gray-500 text-xs mt-1">
                  最終更新: {new Date(updatedAt).toLocaleString('ja-JP')}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-gray-400 text-xs mb-1">ログインID</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm
                             focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-xs mb-1">新しいパスワード</label>
                <div className="flex gap-2">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm
                               focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <button
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-xs px-2 py-1.5 bg-gray-700 text-gray-400 hover:text-gray-200 rounded transition-colors"
                  >
                    {showPassword ? '隠す' : '表示'}
                  </button>
                </div>
              </div>
            </div>

            {message && (
              <p
                className={`text-xs ${
                  message.type === 'success' ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {message.text}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-200 transition-colors"
              >
                閉じる
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
              >
                {saving ? '検証中...' : '接続テストして保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
