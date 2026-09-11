// ReportFrame -- the one section shell every Reports view renders inside:
// kit SectionHeader (title + count + the view's own controls on
// the title row, ml-auto) and the text summary line under it ("N sales |
// Revenue $X | Profit $Y" -- the app's no-stat-tiles convention), then the
// body. Also home to useReportData, the small load/reload hook the views
// share so loading, error and retry look identical everywhere.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import { Button, SectionHeader } from '../../shared/kit'

export interface ReportFrameProps {
  title: ReactNode
  /** Compact selector rendered beside the active report heading. */
  titleControl?: ReactNode
  hint?: { text: string; label: string } | null
  /** The one overflow action that completes the four-control title row. */
  menuAction?: ReactNode
  /** View-specific chips/history live below the title row without crowding it. */
  secondaryActions?: ReactNode
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

export default function ReportFrame({ title, titleControl, menuAction, secondaryActions, summary, summaryNote, error, onRetry, retryLabel = 'Retry', children, className = '' }: ReportFrameProps) {
  // The selectable active report title replaces (rather than sits beside)
  // the static title. This prevents the former "Overview" +
  // "Overview (all)" double heading and gives every report type one
  // consistent title/Filters/Show control row.
  const activeTitle = titleControl ?? title
  return (
    // Every report view is ONE segment, bordered on all four sides -- the
    // shared .report-segment class in reports-surface.css, applied here so no
    // view has to (and none can drift out of) the treatment.
    <section className={['report-segment min-w-0 space-y-1.5', className].join(' ').trim()}>
      {/* Report explanations remain available to exports and future detail
          surfaces, but the title row intentionally has no separate Info
          trigger: the active report picker is the only report-name control. */}
      <SectionHeader
        className={titleControl ? 'reports-frame-header' : ''}
        title={activeTitle}
        actions={menuAction ? <span className="reports-frame-menu">{menuAction}</span> : undefined}
      />
      {secondaryActions ? <div className="reports-frame-secondary-actions">{secondaryActions}</div> : null}
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
  // A new render scope hides prior results before the passive effect runs.
  // Identity also distinguishes A -> B -> A and disable/re-enable cycles.
  const scopeRef = useRef({ depsKey, enabled, tick })
  if (scopeRef.current.depsKey !== depsKey || scopeRef.current.enabled !== enabled || scopeRef.current.tick !== tick) {
    scopeRef.current = { depsKey, enabled, tick }
  }
  const scope = scopeRef.current
  const [resultScope, setResultScope] = useState<typeof scope | null>(null)
  const seq = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    const mine = ++seq.current
    const isCurrent = () => seq.current === mine && scopeRef.current === scope
    if (!enabled) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    setResultScope(scope)
    setData(null)
    setLoading(true)
    setError(null)
    const load = loaderRef.current
    Promise.resolve()
      .then(() => isCurrent() ? load() : undefined)
      .then((result) => {
        if (!isCurrent()) return
        setData(result as T)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!isCurrent()) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { seq.current += 1 }
  }, [scope, enabled])

  const reload = useCallback(() => {
    seq.current += 1
    setTick((n) => n + 1)
  }, [])
  const current = enabled && resultScope === scope
  return { data: current ? data : null, loading: enabled && (!current || loading), error: current ? error : null, reload }
}
