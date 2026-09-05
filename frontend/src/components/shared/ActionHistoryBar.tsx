import { useRef, useState } from 'react'
import HistoryIcon from 'lucide-react/dist/esm/icons/history.js'
import AppSelect from './AppSelect'
import LazyPortalMenu from './LazyPortalMenu'
import { fmtDateTime24 } from '../../utils/formatters'

type Translate = (key: string, fallback: string) => string

// Inlined rather than imported from the app context module tree: this is a
// small, pure string check, and importing it would pull the full app
// context graph into this shared chrome component's chunk (see the
// performance test guarding this file).
function isBrokenTranslatedString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.includes('\ufffd')) return true
  if (/[\uE000-\uF8FF]/.test(trimmed)) return true
  const mojibakeMarkers = ['\u00C3', '\u00C2', '\u00E2\u20AC', '\u00E1\u0178', '\u00E1\u017E', '\u00E0\u00B8', '\u00E1\u00BA', '\u00D0', '\u00D1', '\u00D8', '\u00D9']
  if (mojibakeMarkers.some((marker) => trimmed.includes(marker))) return true
  const questionMarks = (trimmed.match(/\?/g) || []).length
  return questionMarks >= Math.max(3, Math.floor(trimmed.length * 0.18))
}

type HistoryItem = {
  id?: string | number
  label?: string
  status?: string
  serverId?: string | number | null
  undo_label?: string | null
  redo_label?: string | null
  // Server-computed (K1 slice 2): this row's next transition can be replayed
  // by the Worker itself, so it is actionable even with no live closure here.
  server_replayable?: boolean
  undo_payload?: Record<string, unknown>
  created_by_name?: string
  created_at?: string
}

function bulkHistoryLabel(item: HistoryItem, T: Translate): string {
  const p = item.undo_payload
  if (p?.applier !== 'sale.status.bulk') return item.label || ''
  return T('sale_bulk_history_summary', '{changed} sales → {status}; {unchanged} unchanged')
    .replace('{changed}', String(p.changed_count)).replace('{unchanged}', String(p.unchanged_count))
    .replace('{status}', T(`status_${String(p.target_status)}`, String(p.target_status).replaceAll('_', ' ')))
}

function BulkHistoryDetails({ item, T }: { item: HistoryItem; T: Translate }) {
  const [details, setDetails] = useState<Array<{ id: number; receipt_number: string; before: string; after: string; stock_skipped: boolean }>>([])
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const api = await import('../../api/actionHistoryTransport.ts')
      const result = await api.getActionHistoryDetails(item.id!, details.length) as { items: typeof details; total: number }
      setDetails(previous => [...previous, ...result.items]); setTotal(result.total); setOpen(true)
    } catch (e) { setError(e instanceof Error ? e.message : T('error', 'Error')) }
    finally { setBusy(false) }
  }
  return <div className="px-3 pb-2 text-xs text-slate-500">
    <div>{item.created_by_name}{item.created_at ? ` · ${fmtDateTime24(item.created_at)}` : ''}</div>
    <button type="button" className="py-1 text-blue-600 underline" disabled={busy} onClick={() => details.length ? setOpen(!open) : void load()} aria-expanded={open}>{T('sale_bulk_history_details', 'Affected sales')}</button>
    {error && <p role="alert">{error}</p>}
    {open && <div className="max-h-48 space-y-1 overflow-y-auto">
      {details.map(sale => <div key={sale.id} className="break-words">{sale.receipt_number}: {T(`status_${sale.before}`, sale.before.replaceAll('_', ' '))} → {T(`status_${sale.after}`, sale.after.replaceAll('_', ' '))}{sale.stock_skipped ? ` · ${T('sale_stock_skipped', 'Stock skipped')}` : ''}</div>)}
      {details.length < total && <button type="button" className="py-1 text-blue-600 underline" disabled={busy} onClick={() => void load()}>{T('load_more', 'Load more')}</button>}
    </div>}
  </div>
}

type UserOption = {
  id: string | number
  name?: string
  username?: string
}

type ActionHistory = {
  undoItems?: HistoryItem[]
  redoItems?: HistoryItem[]
  serverItems?: HistoryItem[]
  isAdmin?: boolean
  userFilter?: string
  setUserFilter?: (userId: string) => void
  userOptions?: UserOption[]
  canUndo?: boolean
  canRedo?: boolean
  busy?: boolean | string
  lastUndoLabel?: string
  lastRedoLabel?: string
  undo: (id?: string | number) => void
  redo: (id?: string | number) => void
  undoServer?: (serverId: string | number, label?: string) => void
  redoServer?: (serverId: string | number, label?: string) => void
}

type ActionHistoryBarProps = {
  history?: ActionHistory | null
  align?: 'left' | 'right'
  className?: string
  t?: (key: string) => string | undefined
  // Kept for call-site compatibility with the previous two-density design;
  // the consolidated icon-only trigger below no longer has a separate
  // "full" vs "compact" inline summary to switch between, so this prop is
  // accepted but unused.
  summaryMode?: 'full' | 'compact'
  // Shows the "History" word next to the icon (hidden on the narrowest
  // screens to save space). Off by default so dense toolbars stay
  // icon-only, opt in on rows that have room -- e.g. Backup's section row.
  showLabel?: boolean
  // Force the trigger to a true 32px (h-8) height. The button is built on
  // .btn-secondary, whose `min-height: 2.5rem` (40px) otherwise WINS over the
  // `h-8` set below -- so by default History renders 40px, matching the 40px
  // Manage/Add toolbar buttons it sits beside in the Products header. In the
  // StatsStrip's compact rangeActions strip, though, its neighbours (Export/
  // Manage/Add) are h-8 = 32px, so History looked taller than everything next
  // to it (user, Aug 31: "the history button height need to be same height as
  // other buttons"). `dense` adds `min-h-8`, which (being a utility, emitted in
  // a later layer than the .btn-secondary component rule) overrides that
  // min-height and pins the button to a real 32px.
  dense?: boolean
}

function formatHistoryList(items: HistoryItem[] = []) {
  return items.map((item) => item?.label).filter(Boolean).slice(-10).reverse()
}

// "No longer reversible" read as "this expired", which is not what happened.
// Undo is held as a live JS closure in the tab that performed the action, so
// it was never recoverable anywhere else -- not from another tab, and not
// after a reload. The row IS a faithful record of what was done; it simply
// was not a thing that could be replayed from here.
//
// Calling that "Recorded" is the honest word. The hint explains the actual
// constraint rather than implying the entry decayed.
function formatServerStatus(item: HistoryItem, T: Translate, isActionable: boolean) {
  if (item?.status === 'undoable') {
    return isActionable ? T('undo_available', 'Undo available') : T('history_recorded_only', 'Recorded')
  }
  if (item?.status === 'redoable') {
    return isActionable ? T('redo_available', 'Redo available') : T('history_recorded_only', 'Recorded')
  }
  if (item?.status === 'failed') return T('failed', 'Failed')
  return T('recorded', 'Recorded')
}

export default function ActionHistoryBar({
  history,
  align = 'left',
  className = '',
  t,
  showLabel = false,
  dense = false,
}: ActionHistoryBarProps) {
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (!history) return null

  const T: Translate = (key, fallback) => {
    if (typeof t === 'function') {
      const translated = t(key)
      if (translated && translated !== key && !isBrokenTranslatedString(translated)) return translated
    }
    return fallback
  }
  const undoItems = formatHistoryList(history.undoItems)
  const redoItems = formatHistoryList(history.redoItems)
  const liveEntryByServerId = new Map<string, HistoryItem>()
  for (const item of history.undoItems || []) {
    if (item?.serverId != null) liveEntryByServerId.set(String(item.serverId), item)
  }
  for (const item of history.redoItems || []) {
    if (item?.serverId != null) liveEntryByServerId.set(String(item.serverId), item)
  }
  // Server-synced rows that match a still-live local undo/redo entry are
  // already rendered (and clickable) in the sections above, so exclude them
  // here to avoid showing the same action twice.
  const recordedItems = (Array.isArray(history.serverItems) ? history.serverItems : [])
    .filter((item) => !liveEntryByServerId.has(String(item?.id)))
    .slice(0, 10)
  const menuPosition = align === 'right' ? 'right-0' : 'left-0'
  const hasItems = !!((history.undoItems || []).length || (history.redoItems || []).length || recordedItems.length)

  // Preview list for the hover tooltip: most-recent few actions across
  // undo/redo/recorded, most recent first -- just enough to answer "what
  // happened lately" without opening the full interactive panel.
  const previewLabels = [...undoItems, ...redoItems, ...recordedItems.map((item) => item.label).filter((label): label is string => !!label)].slice(0, 3)

  const clearPreviewTimer = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
  }

  return (
    // No hardcoded flex-shrink-0/inline-flex sizing here anymore: this used
    // to silently defeat any `flex-1` a caller passed in via `className`
    // (the wrapper widened to fill the row, but the small icon-square
    // button inside it stayed put at the left edge, leaving the rest of
    // that width sitting empty -- same visual bug as three tiny icon
    // buttons with a lot of dead space next to them). The button itself
    // now stretches to fill whatever width its wrapper ends up with, so a
    // caller opting into `flex-1` actually gets a longer, easier-to-tap
    // bar instead of blank space; a caller that doesn't (most modal/detail
    // usages) sees no change since the wrapper still just hugs content.
    <div className={`relative flex ${className}`.trim()}>
      <LazyPortalMenu
        align={align === 'right' ? 'right' : 'auto'}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (isOpen) setPreviewOpen(false) }}
        menuClassName="w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[min(28rem,70vh)] overflow-auto rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
        trigger={(
          <button
            type="button"
            className={
              // Reuses the same .btn-secondary surface every other toolbar
              // button (Manage/Product/Add) is built on, instead of a
              // hand-rolled dark:bg-slate-900/90 -- that near-black tone sat
              // almost flush against the app's own #171717 page background
              // in dark mode, so the History button read as barely-there
              // next to its higher-contrast neighbors (user-reported low
              // contrast, Part 326). .btn-secondary already resolves to
              // var(--dm-card) in dark mode, the same raised surface every
              // card/input/other toolbar button uses.
              showLabel
                ? `btn-secondary inline-flex h-8 ${dense ? 'min-h-8 ' : ''}w-full shrink-0 items-center justify-center gap-1.5 px-2.5 text-xs font-semibold`
                : `btn-secondary inline-flex h-8 ${dense ? 'min-h-8 ' : ''}w-full min-w-8 items-center justify-center gap-1.5 px-1.5`
            }
            onMouseEnter={() => { clearPreviewTimer(); if (!open) setPreviewOpen(true) }}
            onMouseLeave={() => { previewTimerRef.current = setTimeout(() => setPreviewOpen(false), 150) }}
            onFocus={() => { if (!open) setPreviewOpen(true) }}
            onBlur={() => setPreviewOpen(false)}
            title={T('history', 'History')}
            aria-label={T('history', 'History')}
          >
            <HistoryIcon className="h-4 w-4 shrink-0" />
            {showLabel ? <span className="whitespace-nowrap text-xs font-semibold sm:text-sm">{T('history', 'History')}</span> : null}
          </button>
        )}
        content={({ closeMenu }) => (
          <>
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{T('history', 'History')}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => history.undo()}
                  disabled={!history.canUndo}
                  title={history.lastUndoLabel ? `${T('undo', 'Undo')} ${history.lastUndoLabel}` : T('undo', 'Undo')}
                >
                  {T('undo', 'Undo')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => history.redo()}
                  disabled={!history.canRedo}
                  title={history.lastRedoLabel ? `${T('redo', 'Redo')} ${history.lastRedoLabel}` : T('redo', 'Redo')}
                >
                  {T('redo', 'Redo')}
                </button>
              </div>
            </div>
            {history.isAdmin ? (
              <div className="mb-1.5 px-1">
                <AppSelect
                  className="w-full"
                  buttonClassName="h-8 w-full rounded-lg px-2 py-1 text-xs font-medium shadow-none"
                  menuClassName="min-w-[7.5rem]"
                  optionClassName="text-xs"
                  value={history.userFilter || 'all'}
                  onChange={(nextValue) => history.setUserFilter?.(nextValue)}
                  ariaLabel={T('filter_by_user', 'Filter by user')}
                  options={[
                    { value: 'all', label: T('all_users', 'All users') },
                    ...(Array.isArray(history.userOptions) ? history.userOptions : []).map((option) => ({
                      value: option.id,
                      label: option.name || option.username || `User ${option.id}`,
                    })),
                  ]}
                />
              </div>
            ) : null}
            {!hasItems ? (
              <div className="px-3 py-2 text-slate-500 dark:text-slate-400">{T('no_recent_actions', 'No recent actions')}</div>
            ) : null}
            {(history.undoItems || []).slice(-10).reverse().map((item) => (
              <button
                key={`undo-${item.id || item.label}`}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                disabled={!!history.busy}
                onClick={() => { closeMenu(); history.undo(item.id) }}
              >
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200" title={item.label}>{item.label}</span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{T('undo', 'Undo')}</span>
              </button>
            ))}
            {(history.redoItems || []).slice(-10).reverse().map((item) => (
              <button
                key={`redo-${item.id || item.label}`}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                disabled={!!history.busy}
                onClick={() => { closeMenu(); history.redo(item.id) }}
              >
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200" title={item.label}>{item.label}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">{T('redo', 'Redo')}</span>
              </button>
            ))}
            {recordedItems.map((item) => {
              const grouped = item.undo_payload?.applier === 'sale.status.bulk'
              const displayLabel = bulkHistoryLabel(item, T)
              // K1 slice 2: a server row whose payload the Worker can replay
              // is a REAL Undo/Redo button even though no live closure exists
              // in this tab (the whole point -- reversibility survives the
              // reload). Rows without a server-replayable payload keep the
              // honest inert "Recorded" treatment below.
              const direction = item?.status === 'redoable' ? 'redo' : 'undo'
              const runServer = direction === 'redo' ? history.redoServer : history.undoServer
              const serverActionable = !!item?.server_replayable
                && (item?.status === 'undoable' || item?.status === 'redoable')
                && typeof runServer === 'function'
                && item?.id != null
              if (serverActionable) {
                const doneLabel = (direction === 'redo' ? item.redo_label : item.undo_label) || item.label || ''
                return (
                  <div key={`recorded-${item.id || item.label}`}>
                  <button
                    key={`recorded-${item.id || item.label}`}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                    disabled={!!history.busy || (typeof navigator !== 'undefined' && navigator.onLine === false)}
                    onClick={() => { closeMenu(); runServer!(item.id!, doneLabel) }}
                  >
                    <span className="min-w-0 whitespace-normal break-words text-slate-700 dark:text-slate-200" title={displayLabel}>{displayLabel}</span>
                    <span className={direction === 'redo'
                      ? 'rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                      : 'rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'}
                    >
                      {direction === 'redo' ? T('redo', 'Redo') : T('undo', 'Undo')}
                    </span>
                  </button>
                  {grouped && <BulkHistoryDetails item={item} T={T} />}
                  </div>
                )
              }
              return (
              <div key={`recorded-group-${item.id || item.label}`}>
              <div
                key={`recorded-${item.id || item.label}`}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left opacity-70"
                title={
                  item?.status === 'undoable' || item?.status === 'redoable'
                    ? T('history_recorded_only_hint', 'Undo is only available in the tab where the action happened, and only until that tab is reloaded. This entry is a record of what was done, not something that can be reversed from here.')
                    : undefined
                }
              >
                <span className="min-w-0 whitespace-normal break-words text-slate-700 dark:text-slate-200" title={displayLabel}>{displayLabel}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{formatServerStatus(item, T, false)}</span>
              </div>
              {grouped && <BulkHistoryDetails item={item} T={T} />}
              </div>
              )
            })}
          </>
        )}
      />

      {previewOpen && !open ? (
        <div className={`pointer-events-none absolute ${menuPosition} top-full z-40 mt-2 w-[min(16rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300`}>
          {previewLabels.length ? (
            previewLabels.map((label, index) => (
              <div key={`${label}-${index}`} className="truncate px-1 py-0.5" title={label}>{label}</div>
            ))
          ) : (
            <div className="px-1 py-0.5 text-slate-400">{T('no_recent_actions', 'No recent actions')}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
