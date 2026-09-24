import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle-2.js'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import { stableSnapshot } from '../../utils/formDirty.ts'
import ConfirmDialog, { type ConfirmReviewItem } from './ConfirmDialog.tsx'
import InfoHint from './InfoHint.tsx'
import MinimizeButton from './MinimizeButton.tsx'
import Modal from './Modal.tsx'
import ResolveGrid, {
  RESOLVE_FINAL_COLUMN,
  resolveCellKey,
  type ResolveColumn,
  type ResolveDisposition,
  type ResolveRow,
  type ResolveSelection,
} from './ResolveGrid.tsx'

// The one conflict resolver's flow (owner ruling, 24 Sep 2026: "just one
// button, resolve"): load -> choose in the grid -> confirm before/after ->
// apply -> the server's after values. Products and contacts plug in through
// one adapter; this file never learns what a product is.
//
// The draft is two layers. `initial` is the adapter's starting point for the
// records as last read (its suggestions, and a required row it can already
// answer -- council D1); `edits` is only what the operator changed. A stale
// re-read replaces `initial` and keeps `edits`, so the operator's choices
// survive while the server's new suggestions still apply to everything they
// did not touch. Dirty means the grid's effective choices differ from what it
// showed on load, not that the two layers differ in shape.
//
// Closing: the header X is the only close (no Cancel, no Close button). With
// choices made it asks Discard changes / Back through the shared close guard;
// while a write is running it cannot be dismissed at all.

const useApp = useAppHook as unknown as () => { t: (key: string) => string }

export type ResolveColumnState = { disposition: ResolveDisposition; reason?: string }

/** Choices keyed like the grid: row keys and resolveCellKey() keys; column dispositions by column id. */
export type ResolveDraft = { selection: ResolveSelection; columns: Record<string, ResolveColumnState> }

/** One field the resolve changes, as the server will write it. */
export type ResolveChange = { label: string; before: string; after: string }

export type ResolveReview<T> = {
  /** Lead line of the confirm, e.g. "Merge 3 products into #101". */
  message?: string
  /** Only the fields that change (stock per branch included). Empty: the records merge as they are. */
  changes: ResolveChange[]
  /** Said before the operator confirms, e.g. a damage-tagged record is included. */
  warnings?: string[]
  /** The frozen review the apply step writes. */
  token: T
  /** History can undo it (contacts cannot, council D9). */
  undoable: boolean
}

export type ResolveAfterItem = { label: string; value: string }

export type ResolveApplyResult<T> = {
  /** The server's values after the write. */
  after: ResolveAfterItem[]
  /** Steps finished and in total ("Resolved 3 of 5"). */
  done: number
  total: number
  /** More steps remain: Continue resumes with this token. */
  next?: T
  /** Server notes, e.g. a removal waiting for approval. */
  notes?: string[]
}

export type ResolveAdapter<P, T> = {
  /** Reads the records, given the operator's own choices so far (a restored
   *  draft on the first read). Called again after a stale answer and when
   *  reloadWhen says so. */
  load(signal: AbortSignal, edits: ResolveDraft): Promise<P>
  /** The starting choices: suggestions, and required rows the server can already answer (D1). */
  initialSelection(data: P): ResolveDraft
  /** Must reflect draft.columns[id] as the column's disposition and removeReason. */
  columns(data: P, draft: ResolveDraft): ResolveColumn[]
  /** Rows carry their effective choice; the adapter works each Final out. */
  rows(data: P, draft: ResolveDraft): ResolveRow[]
  /** Further reasons Resolve must wait, shown beside it (e.g. fewer than two records merged). */
  blockers?(data: P, draft: ResolveDraft): string[]
  /** A disposition change that needs the records read again (products: Remove re-previews). */
  reloadWhen?(before: ResolveDraft, after: ResolveDraft): boolean
  review(data: P, draft: ResolveDraft, signal: AbortSignal): Promise<ResolveReview<T>>
  apply(token: T, signal: AbortSignal, onProgress: (done: number, total: number) => void): Promise<ResolveApplyResult<T>>
  /** The records moved under the review: read them again instead of failing. */
  isStale(error: unknown): boolean
}

export type ResolveModalProps<P, T> = {
  title: ReactNode
  adapter: ResolveAdapter<P, T>
  onClose: () => void
  /** After every apply that wrote something, partial or complete: refresh the host's list. */
  onApplied?: (result: ResolveApplyResult<T>) => void
  /** Parks the flow as a chip; receives the operator's choices to hand back as initialDraft. */
  onMinimize?: (draft: ResolveDraft) => void
  /** Choices restored from a minimized flow. */
  initialDraft?: ResolveDraft
}

type Phase = 'loading' | 'failed' | 'ready' | 'reviewing' | 'confirm' | 'applying' | 'partial' | 'done'
type Failure = { kind: 'load' | 'review' | 'apply'; detail: string; stale?: boolean }

const EMPTY_DRAFT: ResolveDraft = { selection: {}, columns: {} }
const NO_CHANGES: ReadonlySet<string> = new Set<string>()

function mergeDraft(base: ResolveDraft, edits: ResolveDraft): ResolveDraft {
  return { selection: { ...base.selection, ...edits.selection }, columns: { ...base.columns, ...edits.columns } }
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

/** What the grid actually shows as chosen; the dirty check compares this. */
function modelSignature(columns: ResolveColumn[], rows: ResolveRow[]): string {
  return stableSnapshot({
    columns: columns.map((column) => [column.id, column.disposition, column.removeReason ?? '']),
    rows: rows.map((row) => [row.key, row.choice ?? null, Object.keys(row.cells).sort().map((id) => row.cells[id].choice ?? null)]),
  })
}

/** Keeps the choices that still point at something after a re-read. */
function pruneDraft(edits: ResolveDraft, columns: ResolveColumn[], rows: ResolveRow[]): ResolveDraft {
  const columnIds = new Set(columns.map((column) => column.id))
  const selection: ResolveSelection = {}
  for (const [key, choice] of Object.entries(edits.selection)) {
    if (!choice) continue
    const row = rows.find((item) => item.key === key)
    if (row) {
      const valid = 'source' in choice ? columnIds.has(choice.source)
        : 'option' in choice ? Boolean(row.options?.some((option) => option.id === choice.option))
          : true
      if (valid) selection[key] = choice
      continue
    }
    const cellRow = rows.find((item) => key.startsWith(`${item.key}|`))
    const option = cellRow && 'option' in choice ? choice.option : null
    if (cellRow && option !== null && cellRow.cells[key.slice(cellRow.key.length + 1)]?.options?.some((item) => item.id === option)) selection[key] = choice
  }
  const kept: Record<string, ResolveColumnState> = {}
  for (const [id, state] of Object.entries(edits.columns)) if (columnIds.has(id)) kept[id] = state
  return { selection, columns: kept }
}

/** Cells whose value moved between two reads of the same records. */
function changedBetween(before: ResolveRow[], after: ResolveRow[], columns: ResolveColumn[]): ReadonlySet<string> {
  const changed = new Set<string>()
  for (const row of after) {
    const old = before.find((item) => item.key === row.key)
    for (const column of columns) {
      if ((old?.cells[column.id]?.text ?? '') !== (row.cells[column.id]?.text ?? '')) changed.add(resolveCellKey(row.key, column.id))
    }
    if ((old?.final.text ?? '') !== row.final.text) changed.add(resolveCellKey(row.key, RESOLVE_FINAL_COLUMN))
  }
  return changed
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}
const readOnline = () => navigator.onLine !== false

export default function ResolveModal<P, T>({ title, adapter, onClose, onApplied, onMinimize, initialDraft }: ResolveModalProps<P, T>) {
  const { t } = useApp()
  const tr = useCallback((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const statusId = useId()
  const offlineId = useId()
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true)

  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<P | null>(null)
  const [initial, setInitial] = useState<ResolveDraft>(EMPTY_DRAFT)
  const [edits, setEdits] = useState<ResolveDraft>(() => initialDraft ?? EMPTY_DRAFT)
  const [baseline, setBaseline] = useState('')
  const [changed, setChanged] = useState<ReadonlySet<string>>(NO_CHANGES)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [review, setReview] = useState<ResolveReview<T> | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [resume, setResume] = useState<{ token: T } | null>(null)
  const [result, setResult] = useState<ResolveApplyResult<T> | null>(null)

  const draft = useMemo(() => mergeDraft(initial, edits), [initial, edits])
  const columns = useMemo(() => (data === null ? [] : adapter.columns(data, draft)), [adapter, data, draft])
  const rows = useMemo(() => (data === null ? [] : adapter.rows(data, draft)), [adapter, data, draft])

  // Async steps read the latest render through refs, never a stale closure.
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied
  const latest = useRef({ data, edits, draft, rows })
  latest.current = { data, edits, draft, rows }
  const controllerRef = useRef<AbortController | null>(null)
  const begin = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    return controller
  }, [])
  useEffect(() => () => controllerRef.current?.abort(), [])

  const load = useCallback(async (stale: boolean, keep: ResolveDraft) => {
    const source = adapterRef.current
    const controller = begin()
    setPhase('loading')
    setFailure(null)
    try {
      const next = await source.load(controller.signal, keep)
      if (controller.signal.aborted) return
      const nextInitial = source.initialSelection(next)
      const probe = mergeDraft(nextInitial, keep)
      const pruned = pruneDraft(keep, source.columns(next, probe), source.rows(next, probe))
      const merged = mergeDraft(nextInitial, pruned)
      if (stale) setChanged(changedBetween(latest.current.rows, source.rows(next, merged), source.columns(next, merged)))
      setBaseline(modelSignature(source.columns(next, nextInitial), source.rows(next, nextInitial)))
      setData(next)
      setInitial(nextInitial)
      setEdits(pruned)
      setPhase('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setFailure({ kind: 'load', detail: messageOf(error), stale })
      setPhase(latest.current.data === null ? 'failed' : 'ready')
    }
  }, [begin])

  const firstDraft = useRef(initialDraft ?? EMPTY_DRAFT)
  useEffect(() => { void load(false, firstDraft.current) }, [load])

  const startReview = async () => {
    const { data: current, draft: chosen } = latest.current
    if (current === null) return
    const controller = begin()
    setPhase('reviewing')
    setFailure(null)
    try {
      const next = await adapterRef.current.review(current, chosen, controller.signal)
      if (controller.signal.aborted) return
      setReview(next)
      setPhase('confirm')
    } catch (error) {
      if (controller.signal.aborted) return
      if (adapterRef.current.isStale(error)) { void load(true, latest.current.edits); return }
      setFailure({ kind: 'review', detail: messageOf(error) })
      setPhase('ready')
    }
  }

  const runApply = async (token: T) => {
    const controller = begin()
    setPhase('applying')
    setFailure(null)
    setProgress(null)
    try {
      const outcome = await adapterRef.current.apply(token, controller.signal, (done, total) => {
        if (!controller.signal.aborted) setProgress({ done, total })
      })
      if (controller.signal.aborted) return
      setProgress({ done: outcome.done, total: outcome.total })
      setResult(outcome)
      setResume(outcome.next === undefined ? null : { token: outcome.next })
      setPhase(outcome.next === undefined ? 'done' : 'partial')
      onAppliedRef.current?.(outcome)
    } catch (error) {
      if (controller.signal.aborted) return
      if (adapterRef.current.isStale(error)) { setReview(null); void load(true, latest.current.edits); return }
      // The last step may or may not have landed; Continue re-sends the same
      // frozen token, which the server treats as the same request.
      setResume({ token })
      setFailure({ kind: 'apply', detail: messageOf(error) })
      setPhase('partial')
    }
  }

  const select = (key: string, choice: NonNullable<ResolveSelection[string]>) => {
    setEdits((current) => ({ ...current, selection: { ...current.selection, [key]: choice } }))
  }

  const dispose = (columnId: string, disposition: ResolveDisposition, reason?: string) => {
    const next: ResolveDraft = { ...edits, columns: { ...edits.columns, [columnId]: { disposition, reason } } }
    setEdits(next)
    if (adapterRef.current.reloadWhen?.(draft, mergeDraft(initial, next))) void load(false, next)
  }

  // Nothing is left to park once the resolve is done.
  const minimize = onMinimize && phase !== 'done' ? () => onMinimize(latest.current.edits) : undefined
  const dirty = data !== null && phase !== 'done' && modelSignature(columns, rows) !== baseline

  const blockers: string[] = []
  if (data !== null) {
    const unanswered = rows.filter((row) => row.kind === 'required' && !row.choice)
    if (unanswered.length) blockers.push(fill(tr('resolve_required_blocker', 'Choose one for: {fields}'), { fields: unanswered.map((row) => row.label).join(', ') }))
    for (const column of columns) {
      if (column.disposition === 'remove' && !column.removeReason?.trim()) blockers.push(fill(tr('resolve_remove_reason_blocker', 'Give a reason to remove {name}'), { name: column.title }))
    }
    blockers.push(...(adapter.blockers?.(data, draft) ?? []))
  }

  const failureText = failure?.kind === 'load' ? tr('resolve_load_failed', 'Could not load the records.')
    : failure?.kind === 'review' ? tr('resolve_failed', 'Could not check the changes. Nothing was saved.')
      : failure?.kind === 'apply' ? tr('resolve_apply_failed', 'Stopped before finishing. Continue picks up where it stopped.')
        : ''
  const retry = () => { void load(Boolean(failure?.stale), latest.current.edits) }
  const stale = changed.size > 0
  const banners = (stale ? 1 : 0) + (online ? 0 : 1)

  const renderEmpty = (value: string) => (value ? value : (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{tr('resolve_empty', 'Empty')}</span>
    </>
  ))

  const confirmItems: ConfirmReviewItem[] = review ? [
    ...review.changes.map((change) => ({
      label: change.label,
      value: (
        <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1">
          <span className="sr-only">{tr('before', 'Before')}:</span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{renderEmpty(change.before)}</span>
          <span aria-hidden="true" className="text-gray-400">→</span>
          <span className="sr-only">{tr('after', 'After')}:</span>
          <span>{renderEmpty(change.after)}</span>
        </span>
      ),
    })),
    // Council D1: a required answer is listed even when the server supplied it
    // -- once: an answer that changes a value is already above, before and after.
    ...rows
      .filter((row) => row.kind === 'required' && !review.changes.some((change) => change.label === row.label))
      .map((row) => ({ label: row.label, value: row.final.text || tr('resolve_choose', 'Choose one') })),
  ] : []

  const working = phase === 'loading' || phase === 'reviewing' || phase === 'applying'
  const footerStatus = (() => {
    if (phase === 'applying') {
      return progress ? fill(tr('resolve_progress', 'Resolving {done} of {total}…'), progress) : tr('processing', 'Processing…')
    }
    if (phase === 'partial' && !failure && progress) return fill(tr('resolve_partial', 'Resolved {done} of {total}. Continue to finish the rest.'), progress)
    return ''
  })()

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="xl"
      unsavedChanges={{ dirty }}
      closeDisabled={phase === 'applying'}
      onMinimize={minimize}
      headerExtra={minimize ? <MinimizeButton onMinimize={minimize} disabled={phase === 'applying'} tr={(key, fallback) => tr(key, fallback)} /> : undefined}
    >
      <div className="space-y-2" style={{ '--rg-chrome': `${15 + banners * 3.5}rem` } as CSSProperties}>
        {stale && phase !== 'done' ? (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{tr('resolve_stale_banner', 'These records changed since you opened them. Your choices are kept; changed values are marked.')}</span>
          </p>
        ) : null}
        {!online && phase !== 'done' ? (
          <p id={offlineId} role="status" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            {tr('resolve_online_only', 'Resolving needs a connection. Your choices stay here.')}
          </p>
        ) : null}

        {phase === 'done' && result ? (
          <div className="space-y-2">
            <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
              <CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{tr('resolved', 'Resolved')}</span>
              {review?.undoable ? <InfoHint text={tr('resolve_undo_hint', 'Undo from History puts the records back as they were.')} label={tr('resolve_undo_label', 'About undo')} align="auto" /> : null}
            </p>
            {result.after.length ? (
              <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-700/60 dark:border-gray-700">
                {result.after.map((item, index) => (
                  <div key={index} className="flex items-start justify-between gap-3 px-3 py-2">
                    <dt className="min-w-0 max-w-[45%] break-words text-xs text-gray-500 dark:text-gray-400">{item.label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium text-gray-900 dark:text-gray-100">{renderEmpty(item.value)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {result.notes?.map((note, index) => <p key={index} className="text-xs text-gray-600 dark:text-gray-300">{note}</p>)}
          </div>
        ) : data !== null ? (
          <ResolveGrid
            columns={columns}
            rows={rows}
            changedCells={changed}
            busy={phase !== 'ready'}
            t={t}
            onSelect={select}
            onDisposition={dispose}
          />
        ) : phase === 'failed' ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            <p className="font-medium">{failureText}</p>
            {failure?.detail ? <p className="mt-1 break-words text-xs">{failure.detail}</p> : null}
            <button type="button" className="btn-secondary mt-2" onClick={retry}>{tr('retry', 'Retry')}</button>
          </div>
        ) : (
          <div aria-busy="true" className="space-y-2">
            <span role="status" className="sr-only">{tr('loading', 'Loading...')}</span>
            {[0, 1, 2, 3, 4].map((index) => <div key={index} aria-hidden="true" className="h-9 rounded-md bg-gray-100 motion-safe:animate-pulse dark:bg-gray-700/60" />)}
          </div>
        )}

        {phase !== 'done' && phase !== 'failed' ? (
          <div className="sticky bottom-0 -mx-3 -mb-3 space-y-2 border-t border-gray-200 bg-white px-3 pb-3 pt-3 dark:border-gray-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
            {failure && data !== null ? (
              <div role="alert" className="text-xs text-red-700 dark:text-red-300">
                <p className="font-medium">{failureText}</p>
                {failure.detail ? <p className="break-words">{failure.detail}</p> : null}
                {failure.kind === 'load' ? <button type="button" className="btn-secondary mt-1" onClick={retry}>{tr('retry', 'Retry')}</button> : null}
              </div>
            ) : null}
            {footerStatus ? <p role="status" className="text-xs font-medium text-gray-700 dark:text-gray-200">{footerStatus}</p> : null}
            {phase === 'ready' && blockers.length ? (
              <ul id={statusId} className="space-y-0.5 text-xs text-amber-800 dark:text-amber-200">
                {blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}
              </ul>
            ) : null}
            <div className="flex justify-end">
              {phase === 'partial' && resume ? (
                <button type="button" className="btn-primary w-full sm:w-auto sm:min-w-[10rem]" disabled={!online} onClick={() => { void runApply(resume.token) }}>
                  {tr('continue', 'Continue')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary w-full sm:w-auto sm:min-w-[10rem]"
                  disabled={phase !== 'ready' || blockers.length > 0 || !online}
                  aria-describedby={[phase === 'ready' && blockers.length ? statusId : '', online ? '' : offlineId].filter(Boolean).join(' ') || undefined}
                  onClick={() => { void startReview() }}
                >
                  {working && data !== null ? tr('processing', 'Processing…') : tr('resolve', 'Resolve')}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {phase === 'confirm' && review ? (
        <ConfirmDialog
          title={tr('resolve_confirm_title', 'Check before you resolve')}
          message={review.message}
          items={confirmItems}
          note={review.undoable ? tr('resolve_undo_note', 'You can undo this from History.') : undefined}
          confirmLabel={tr('resolve', 'Resolve')}
          cancelLabel={tr('back', 'Back')}
          layer="nested"
          onConfirm={() => { void runApply(review.token) }}
          onClose={() => setPhase('ready')}
          t={(key) => t(key)}
        >
          {review.changes.length ? null : <p className="text-xs text-gray-600 dark:text-gray-300">{tr('resolve_no_changes', 'No field values change.')}</p>}
          {review.warnings?.length ? (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
              {review.warnings.map((warning, index) => (
                <li key={index} className="flex items-start gap-1">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="min-w-0">{warning}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </Modal>
  )
}
