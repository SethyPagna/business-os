import { useEffect, useState } from 'react'

type LoadingWatchdogProps = {
  loading?: boolean
  timeoutMs?: number
  label?: string
  details?: string
  detailsMode?: 'slow' | 'always'
  showAfterMs?: number
  onRetry?: () => void
  className?: string
}

export default function LoadingWatchdog({
  loading = false,
  timeoutMs = 10000,
  label = 'Loading...',
  details = '',
  detailsMode = 'slow',
  showAfterMs = 0,
  onRetry,
  className = '',
}: LoadingWatchdogProps) {
  const [slow, setSlow] = useState(false)
  const [visible, setVisible] = useState(showAfterMs <= 0)

  useEffect(() => {
    if (!loading) {
      setVisible(showAfterMs <= 0)
      return undefined
    }
    if (showAfterMs <= 0) {
      setVisible(true)
      return undefined
    }
    setVisible(false)
    const timer = window.setTimeout(() => setVisible(true), showAfterMs)
    return () => window.clearTimeout(timer)
  }, [loading, showAfterMs])

  useEffect(() => {
    if (!loading) {
      setSlow(false)
      return undefined
    }
    const timer = window.setTimeout(() => setSlow(true), Math.max(1000, timeoutMs))
    return () => window.clearTimeout(timer)
  }, [loading, timeoutMs])

  if (!loading || !visible) return null
  const showDetails = !!details && (detailsMode === 'always' || slow)

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
          {showDetails ? <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{details}</div> : null}
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
