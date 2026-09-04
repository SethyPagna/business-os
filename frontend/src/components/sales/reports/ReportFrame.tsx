// ReportFrame -- the one section shell every Reports view renders inside:
// kit SectionHeader (title + count + InfoHint + the view's own controls on
// the title row, ml-auto) and the text summary line under it ("N sales |
// Revenue $X | Profit $Y" -- the app's no-stat-tiles convention), then the
// body. Also home to useReportData, the small load/reload hook the views
// share so loading, error and retry look identical everywhere.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import InfoHint from '../../shared/InfoHint.tsx'
import { Button, SectionHeader } from '../../shared/kit'

export interface ReportFrameProps {
  title: ReactNode
  count?: ReactNode
  hint?: { text: string; label: string } | null
  actions?: ReactNode
  /** The " | "-joined summary string (may be empty while loading). */
  summary?: string
  /** Secondary summary line (e.g. the previous period) -- muted. */
  summaryNote?: string
  error?: string | null
  onRetry?: () => void
  retryLabel?: string
  children: ReactNode
  className?: string
}

export default function ReportFrame({ title, count, hint, actions, summary, summaryNote, error, onRetry, retryLabel = 'Retry', children, className = '' }: ReportFrameProps) {
  return (
    <section className={['min-w-0 space-y-1.5', className].join(' ').trim()}>
      <SectionHeader title={title} count={count} infoHint={hint ? <InfoHint text={hint.text} label={hint.label} /> : undefined} actions={actions} />
      {summary ? (
        <p className="min-w-0 text-[length:var(--ui-size-meta)] leading-5 text-[var(--ui-ink-2)] [font-variant-numeric:tabular-nums]" data-report-summary="">
          {summary}
          {summaryNote ? <span className="ml-1 text-[var(--ui-ink-3)]">({summaryNote})</span> : null}
        </p>
      ) : null}
      {error ? (
        <div className="flex items-center gap-2 rounded-[var(--ui-radius)] border border-[var(--ui-line)] bg-[var(--ui-surface-2)] px-3 py-2 text-[length:var(--ui-size-meta)] text-[var(--ui-danger)]">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          {onRetry ? <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>{retryLabel}</Button> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface ReportDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Load `loader()` whenever `depsKey` changes; stale responses (an older
 * request resolving after a newer one) are dropped. `enabled=false` clears
 * the data (e.g. the view has no permission).
 */
export function useReportData<T>(loader: () => Promise<T>, depsKey: string, enabled = true): ReportDataState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(enabled)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const mine = ++seq.current
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((result) => {
        if (seq.current !== mine) return
        setData(result)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (seq.current !== mine) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [depsKey, enabled, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}
