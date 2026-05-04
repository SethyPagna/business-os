import { useEffect, useState } from 'react'

export default function LoadingWatchdog({
  loading = false,
  timeoutMs = 10000,
  label = 'Loading...',
  details = '',
  onRetry,
  className = '',
}) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return undefined
    }
    const timer = window.setTimeout(() => setSlow(true), Math.max(1000, timeoutMs))
    return () => window.clearTimeout(timer)
  }, [loading, timeoutMs])

  if (!loading) return null

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{slow ? 'Still loading' : label}</div>
          {slow ? (
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              This is taking longer than expected. You can retry without leaving the page.
            </div>
          ) : null}
          {details ? <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{details}</div> : null}
        </div>
        {slow && onRetry ? (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  )
}
