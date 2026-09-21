import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import { useApp } from '../../AppContext.tsx'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import Modal from '../shared/Modal.tsx'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls.tsx'
import { DateTimeEntryInput } from '../shared/DateEntryInput.tsx'
import { SHIFT_BRANCH_CHANGED_EVENT, SHIFT_STATE_CHANGED_EVENT } from '../pos/ShiftGate.tsx'
import ShiftSummary from './ShiftSummary.tsx'
import ShiftCountPair, { ShiftSubmitRow, shiftCountBlockerKey } from './ShiftCountFields.tsx'
import {
  amendShift,
  cancelShift,
  carryOverCloseSeedMs,
  closeShiftById,
  fetchShiftHistory,
  listShifts,
  orderShiftRows,
  parseShiftCount,
  pendingShiftMutation,
  reopenShift,
  shiftClosingCounts,
  shiftCountPairBlocker,
  shiftOpeningCounts,
  shiftLocalDateTimeFromMs,
  shiftLocalDateTimeToIso,
  type Shift,
  type ShiftAmendment,
} from '../../api/shiftTransport.ts'

type Props = {
  branchId?: number | null
  userId?: number | string | null
  limit?: number
  layer?: 'default' | 'nested'
  label?: ReactNode
  buttonClassName?: string
  notify?: (message: string, tone?: string) => void
}

function closingCountInvalid(value: string): boolean {
  return value.trim() !== '' && parseShiftCount(value) == null
}

type EditDraft = {
  expectedRevision: number
  reason: string
  openedAt: string
  closedAt: string
  openingUsd: string
  openingKhr: string
  additionalUsd: string
  additionalKhr: string
  closingUsd: string
  closingKhr: string
  openingNote: string
  closingNote: string
}

type CloseDraft = { closedAt: string; closingUsd: string; closingKhr: string; additionalUsd: string; additionalKhr: string; closingNote: string }
type ReopenDraft = { reason: string; openingUsd: string; openingKhr: string; openingNote: string }
type ActionMode = 'edit' | 'close' | 'reopen' | 'cancel' | null

// A historic close still needs an explicit closing timestamp so the server can
// place it in the correct interval.  The drawer counts are report-only and
// remain blank by default.
//
// The moment it opens with is the LATEST one the Worker will accept for THIS
// row, through the same rule the POS carry-over close seeds from
// (carryOverCloseSeedMs): a minute before `close_before` -- the opening of the
// segment that follows this row, which the server states on the row itself --
// clamped up to the row's own opening. Seeded from the bare clock instead,
// the default press was answered 409 "Closing time overlaps the next shift
// segment." for every row that had a later segment, which is every drawer left
// open on an earlier day once today has been registered.
//
// With no row (the popup's own reset) or no bound stated, the current local
// minute is still the seed: only the clock bounds the close then, and a
// prefilled time keeps an otherwise valid close from looking blocked.
const blankClose = (shift?: Shift | null): CloseDraft => ({
  closedAt: shift && !shift.closed_at
    ? shiftLocalDateTimeFromMs(carryOverCloseSeedMs(shift.close_before, shift.opened_at, Date.now()))
    : dateTimeLocal(new Date().toISOString()),
  closingUsd: '', closingKhr: '', additionalUsd: '', additionalKhr: '', closingNote: '',
})
const blankReopen = (): ReopenDraft => ({ reason: '', openingUsd: '', openingKhr: '', openingNote: '' })
const refreshMountedShiftState = () => window.dispatchEvent(new Event(SHIFT_STATE_CHANGED_EVENT))

function operationalBranchId(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const first = (window.sessionStorage.getItem('pos_branch') || '').split(',')[0]?.trim()
    const parsed = Number(first)
    return first && Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch { return null }
}

function dateTimeLocal(value: string | null): string {
  const ms = value ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(ms) ? '' : shiftLocalDateTimeFromMs(ms)
}

const editDraft = (shift: Shift): EditDraft => ({
  expectedRevision: shift.revision,
  reason: '',
  openedAt: dateTimeLocal(shift.opened_at),
  closedAt: dateTimeLocal(shift.closed_at),
  openingUsd: shift.opening_float_usd == null ? '' : String(shift.opening_float_usd),
  openingKhr: shift.opening_float_khr == null ? '' : String(shift.opening_float_khr),
  additionalUsd: shift.additional_cash_usd ? String(shift.additional_cash_usd) : '',
  additionalKhr: shift.additional_cash_khr ? String(shift.additional_cash_khr) : '',
  closingUsd: shift.closing_counted_usd == null ? '' : String(shift.closing_counted_usd),
  closingKhr: shift.closing_counted_khr == null ? '' : String(shift.closing_counted_khr),
  openingNote: shift.opening_note || '',
  closingNote: shift.closing_note || '',
})

const amendmentFields = [
  ['opened_at', 'shift_opened_at'],
  ['closed_at', 'shift_closed_at'],
  ['opening_float_usd', 'shift_float_usd'],
  ['opening_float_khr', 'shift_float_khr'],
  ['additional_cash_usd', 'shift_recon_additional_cash'],
  ['additional_cash_khr', 'shift_recon_additional_cash'],
  ['closing_counted_usd', 'shift_counted_usd'],
  ['closing_counted_khr', 'shift_counted_khr'],
  ['opening_note', 'shift_opening_note'],
  ['closing_note', 'shift_closing_note'],
  ['cancelled_at', 'shift_cancelled_at'],
  ['cancelled_by_user_name', 'shift_cancelled_by'],
  ['cancel_reason', 'shift_cancel_reason'],
] as const

function jsonRecord(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

/** Exported for tests/shiftAmendForm.test.ts, which renders the real
 * before -> after list rather than grepping this file for it. */
export function AmendmentList({ rows, segments = [] }: { rows: ShiftAmendment[]; segments?: Shift[] }) {
  const { t, fmtUSD, fmtKHR } = useApp() as {
    t: (key: string) => string
    fmtUSD: (value: unknown) => string
    fmtKHR: (value: unknown) => string
  }
  const formatValue = (field: string, value: unknown) => {
    if (value == null || value === '') return '—'
    if (field.endsWith('_at')) return fmtDateTime24(String(value))
    if (field.endsWith('_usd')) return fmtUSD(value)
    if (field.endsWith('_khr')) return fmtKHR(value)
    return String(value)
  }
  if (!rows.length) return <p className="text-xs text-gray-500 dark:text-gray-400">{t('shift_no_amendments')}</p>
  return (
    <ol className="space-y-3 border-l border-gray-200 pl-3 dark:border-zinc-700">
      {rows.map((row) => {
        const before = jsonRecord(row.before_json)
        const after = jsonRecord(row.after_json)
        const changes = amendmentFields.filter(([field]) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
        return (
          <li key={row.id} className="text-xs leading-relaxed">
            <div className="font-medium text-gray-800 dark:text-gray-100">{row.reason}</div>
            {/* Which segment this record belongs to -- only worth printing
                when the record has more than one, which is exactly when the
                timeline mixes them. */}
            <div className="text-gray-500 dark:text-gray-400">
              {row.actor_name || `${t('shift_staff')} ${row.actor_user_id}`} · {fmtDateTime24(row.created_at)}
              {segments.length > 1 ? ` · ${segments.find((segment) => segment.id === row.shift_session_id)?.shift_code || ''}` : ''}
            </div>
            {changes.length ? (
              <dl className="mt-1.5 space-y-1 rounded-lg bg-slate-50 p-2 dark:bg-zinc-800/70">
                {changes.map(([field, label]) => (
                  <div key={field} className="grid min-w-0 grid-cols-[minmax(5rem,0.7fr)_minmax(0,1fr)] gap-2">
                    <dt className="text-gray-500 dark:text-gray-400">{t(label)}</dt>
                    <dd className="min-w-0 break-words text-gray-700 dark:text-gray-200">{formatValue(field, before[field])} → {formatValue(field, after[field])}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export default function ShiftHistoryModal({ branchId, userId, limit = DEFAULT_PAGE_SIZE, layer = 'default', label, buttonClassName = 'btn-secondary min-h-11 text-xs', notify }: Props) {
  const app = useApp() as { user?: { id: number | string; username?: unknown; role_code?: unknown; permissions?: unknown; role_permissions?: unknown }; t: (key: string) => string; notify?: (message: string, tone?: string) => void }
  const { t } = app
  const sendNotice = notify || app.notify
  const listRequest = useRef(0)
  const detailsRequest = useRef(0)
  const [fallbackBranch, setFallbackBranch] = useState(operationalBranchId)
  const activeBranchId = branchId === undefined ? fallbackBranch : branchId
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Shift[]>([])
  const [scope, setScope] = useState<'all' | 'own'>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Shift | null>(null)
  const [amendments, setAmendments] = useState<ShiftAmendment[]>([])
  // Every segment of the selected record, oldest first. A reopened shift is
  // ONE row in the list, so its float has to show what that row stands for.
  const [segments, setSegments] = useState<Shift[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [action, setAction] = useState<ActionMode>(null)
  const [edit, setEdit] = useState<EditDraft | null>(null)
  const [close, setClose] = useState<CloseDraft>(blankClose)
  const [reopen, setReopen] = useState<ReopenDraft>(blankReopen)
  const [cancelReason, setCancelReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(false)
  const actorScope = JSON.stringify([activeBranchId, userId, app.user?.id, app.user?.username, app.user?.role_code, app.user?.permissions, app.user?.role_permissions])
  const [paging, setPaging] = useState({ scope: actorScope, page: 1, size: Math.min(200, Math.max(1, limit)) })
  const page = paging.scope === actorScope ? paging.page : 1
  const pageSize = paging.size
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number | null }>({ page: 1, total: null })
  const listScope = `${actorScope}:${page}:${pageSize}:${open}`
  const scopeRef = useRef(listScope)
  const scopeGeneration = useRef({})
  const mutationRef = useRef<object | null>(null)
  useEffect(() => () => { scopeGeneration.current = {}; mutationRef.current = null }, [])
  if (scopeRef.current !== listScope) {
    scopeRef.current = listScope
    scopeGeneration.current = {}
    mutationRef.current = null
    listRequest.current += 1
    detailsRequest.current += 1
    setRows([])
    setSelected(null)
    setAmendments([])
    setSegments([])
    setAction(null)
    setError('')
    setDetailsError('')
    setPageInfo({ page, total: null })
    setLoading(true)
    setEdit(null)
    setClose(blankClose())
    setReopen(blankReopen())
    setCancelReason('')
    setPending(false)
    setSaving(false)
    setDetailsLoading(false)
  }
  const renderGeneration = scopeGeneration.current
  const beginMutation = () => {
    if (scopeRef.current !== listScope || scopeGeneration.current !== renderGeneration || mutationRef.current) return null
    const generation = renderGeneration
    const operation = {}
    mutationRef.current = operation
    setSaving(true)
    return () => scopeRef.current === listScope && scopeGeneration.current === generation && mutationRef.current === operation
  }

  useEffect(() => {
    if (branchId !== undefined || !open) return
    const sync = () => setFallbackBranch(operationalBranchId())
    sync()
    window.addEventListener(SHIFT_BRANCH_CHANGED_EVENT, sync)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener(SHIFT_BRANCH_CHANGED_EVENT, sync)
      window.removeEventListener('focus', sync)
    }
  }, [branchId, open])

  const load = useCallback(async (fresh = false) => {
    if (scopeRef.current !== listScope) return
    const requestId = ++listRequest.current
    setLoading(true)
    setError('')
    try {
      const result = await listShifts({ branchId: activeBranchId, userId, page, pageSize }, { fresh })
      if (requestId === listRequest.current && scopeRef.current === listScope) {
        setRows(orderShiftRows(result.shifts))
        setScope(result.scope)
        setPageInfo({ page: result.page ?? page, total: result.total ?? result.shifts.length })
      }
    } catch (cause) {
      if (requestId === listRequest.current && scopeRef.current === listScope) setError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (requestId === listRequest.current && scopeRef.current === listScope) setLoading(false)
    }
  }, [activeBranchId, page, pageSize, t, userId, actorScope, listScope])

  useEffect(() => {
    if (!open) return
    // Opening or navigating a page is an explicit read, like Refresh. A page
    // cached before another page's refresh must not revive obsolete totals.
    void load(true)
    const refresh = () => { void load(true) }
    window.addEventListener(SHIFT_STATE_CHANGED_EVENT, refresh)
    return () => { window.removeEventListener(SHIFT_STATE_CHANGED_EVENT, refresh); listRequest.current += 1; detailsRequest.current += 1 }
  }, [load, open])

  const resetAction = () => {
    setPending(false)
    setAction(null)
    setClose(blankClose())
    setReopen(blankReopen())
    setCancelReason('')
  }

  const openDetails = async (shift: Shift) => {
    if (scopeRef.current !== listScope) return
    const requestId = ++detailsRequest.current
    setSelected(shift)
    setEdit(editDraft(shift))
    setAmendments([])
    setSegments([])
    setAction(null)
    setDetailsLoading(true)
    setDetailsError('')
    try {
      const result = await fetchShiftHistory(shift.id)
      if (requestId === detailsRequest.current && scopeRef.current === listScope) {
        setSelected(result.shift)
        setEdit(editDraft(result.shift))
        setAmendments(result.amendments)
        setSegments(result.segments || [result.shift])
        const saved = pendingShiftMutation(app.user?.id, shift.id)
        if (saved) {
          const value = (key: string) => saved.body[key] == null ? '' : String(saved.body[key])
          setPending(true)
          setAction(saved.action)
          if (saved.action === 'close') setClose({ closedAt: dateTimeLocal(value('closed_at')), closingUsd: value('closing_counted_usd'), closingKhr: value('closing_counted_khr'), additionalUsd: value('additional_cash_usd'), additionalKhr: value('additional_cash_khr'), closingNote: value('closing_note') })
          if (saved.action === 'reopen') setReopen({ reason: value('reason'), openingUsd: value('opening_float_usd'), openingKhr: value('opening_float_khr'), openingNote: value('opening_note') })
          if (saved.action === 'cancel') setCancelReason(value('reason'))
          if (saved.action === 'edit') setEdit({ expectedRevision: Number(saved.body.expected_revision), reason: value('reason'), openedAt: dateTimeLocal(value('opened_at')), closedAt: dateTimeLocal(value('closed_at')), openingUsd: value('opening_float_usd'), openingKhr: value('opening_float_khr'), additionalUsd: value('additional_cash_usd'), additionalKhr: value('additional_cash_khr'), closingUsd: value('closing_counted_usd'), closingKhr: value('closing_counted_khr'), openingNote: value('opening_note'), closingNote: value('closing_note') })
        } else setPending(false)
      }
    } catch (cause) {
      if (requestId === detailsRequest.current && scopeRef.current === listScope) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (requestId === detailsRequest.current && scopeRef.current === listScope) setDetailsLoading(false)
    }
  }

  const replaceRow = (shift: Shift) => {
    setSelected(shift)
    setEdit(editDraft(shift))
    setRows((current) => orderShiftRows(current.map((row) => row.id === shift.id ? shift : row)))
  }

  const refreshDetails = async (shift: Shift, isCurrent: () => boolean) => {
    if (!isCurrent()) return
    const requestId = ++detailsRequest.current
    setDetailsLoading(true)
    try {
      const history = await fetchShiftHistory(shift.id)
      if (isCurrent() && requestId === detailsRequest.current) {
        replaceRow(history.shift)
        setAmendments(history.amendments)
        setSegments(history.segments || [history.shift])
        setDetailsError('')
      }
    } catch (cause) {
      if (isCurrent() && requestId === detailsRequest.current) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (isCurrent() && requestId === detailsRequest.current) setDetailsLoading(false)
    }
  }

  const reportSaveError = (cause: unknown, fallbackKey: string) => {
    setPending((cause as { outcome?: string })?.outcome === 'unknown')
    if ((cause as { outcome?: string })?.outcome === 'unknown') return // shared banner owns the unresolved warning
    const message = cause instanceof Error ? cause.message : t(fallbackKey)
    if ((cause as { outcome?: string })?.outcome !== 'unknown' && Number((cause as { status?: unknown } | null)?.status) === 409) setDetailsError(message)
    sendNotice?.(message, 'error')
  }

  const saveEdit = async () => {
    if (!selected || !edit || !edit.reason.trim() || !edit.openedAt || saving) return
    const opening = shiftOpeningCounts(edit.openingUsd, edit.openingKhr)
    const closing = edit.closedAt ? shiftClosingCounts(edit.closingUsd, edit.closingKhr) : { usd: null, khr: null }
    if (closingCountInvalid(edit.openingUsd) || closingCountInvalid(edit.openingKhr)
      || (edit.closedAt && (closingCountInvalid(edit.closingUsd) || closingCountInvalid(edit.closingKhr)
        || closingCountInvalid(edit.additionalUsd) || closingCountInvalid(edit.additionalKhr)))) return
    const isCurrent = beginMutation()
    if (!isCurrent) return
    try {
      const result = await amendShift(selected.id, {
        actorId: app.user?.id,
        expectedRevision: edit.expectedRevision,
        reason: edit.reason.trim(),
        openedAt: shiftLocalDateTimeToIso(edit.openedAt),
        openingFloatUsd: opening.usd,
        openingFloatKhr: opening.khr,
        additionalCashUsd: edit.additionalUsd.trim() === '' ? undefined : Number(edit.additionalUsd),
        additionalCashKhr: edit.additionalKhr.trim() === '' ? undefined : Number(edit.additionalKhr),
        openingNote: edit.openingNote.trim() || null,
        closedAt: edit.closedAt ? shiftLocalDateTimeToIso(edit.closedAt) : null,
        closingCountedUsd: closing.usd,
        closingCountedKhr: closing.khr,
        closingNote: edit.closedAt ? edit.closingNote.trim() || null : null,
      })
      if (!isCurrent()) return
      replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_amend_saved'), 'success')
      await refreshDetails(result.shift, isCurrent)
    } catch (cause) {
      if (isCurrent()) reportSaveError(cause, 'shift_amend_failed')
    } finally { if (isCurrent()) { mutationRef.current = null; setSaving(false) } }
  }

  const saveClose = async () => {
    if (!selected || !close.closedAt || saving) return
    const closing = shiftClosingCounts(close.closingUsd, close.closingKhr)
    if (closingCountInvalid(close.closingUsd) || closingCountInvalid(close.closingKhr)
      || closingCountInvalid(close.additionalUsd) || closingCountInvalid(close.additionalKhr)) return
    const isCurrent = beginMutation()
    if (!isCurrent) return
    try {
      const result = await closeShiftById(selected.id, {
        actorId: app.user?.id,
        expectedRevision: selected.revision,
        closedAt: shiftLocalDateTimeToIso(close.closedAt),
        // The accounting transport accepts null as "not counted". Casts
        // preserve compatibility with the pre-integration transport type.
        closingCountedUsd: closing.usd as number,
        closingCountedKhr: closing.khr as number,
        additionalCashUsd: close.additionalUsd.trim() === '' ? null : Number(close.additionalUsd),
        additionalCashKhr: close.additionalKhr.trim() === '' ? null : Number(close.additionalKhr),
        closingNote: close.closingNote.trim() || null,
      })
      if (!isCurrent()) return
      if (result.shift) replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_close_saved'), 'success')
      await refreshDetails(result.shift, isCurrent)
    } catch (cause) {
      if (isCurrent()) reportSaveError(cause, 'shift_end_failed')
    } finally { if (isCurrent()) { mutationRef.current = null; setSaving(false) } }
  }

  const saveReopen = async () => {
    if (!selected || !reopen.reason.trim() || saving) return
    const opening = shiftOpeningCounts(reopen.openingUsd, reopen.openingKhr)
    if (closingCountInvalid(reopen.openingUsd) || closingCountInvalid(reopen.openingKhr)) return
    const isCurrent = beginMutation()
    if (!isCurrent) return
    try {
      const result = await reopenShift(selected.id, {
        actorId: app.user?.id,
        expectedRevision: selected.revision,
        reason: reopen.reason.trim(),
        openingFloatUsd: opening.usd,
        openingFloatKhr: opening.khr,
        openingNote: reopen.openingNote.trim() || null,
      })
      if (!isCurrent()) return
      setRows((current) => orderShiftRows([...current.filter((row) => row.id !== result.shift.id), result.shift]))
      setSelected(result.shift)
      setEdit(editDraft(result.shift))
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_reopen_saved'), 'success')
      await refreshDetails(result.shift, isCurrent)
    } catch (cause) {
      if (isCurrent()) reportSaveError(cause, 'shift_reopen_failed')
    } finally { if (isCurrent()) { mutationRef.current = null; setSaving(false) } }
  }

  const saveCancel = async () => {
    if (!selected || !cancelReason.trim() || saving) return
    const isCurrent = beginMutation()
    if (!isCurrent) return
    try {
      const result = await cancelShift(selected.id, selected.revision, cancelReason.trim(), app.user?.id)
      if (!isCurrent()) return
      replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_cancel_saved'), 'success')
      await refreshDetails(result.shift, isCurrent)
    } catch (cause) {
      if (isCurrent()) reportSaveError(cause, 'shift_cancel_failed')
    } finally { if (isCurrent()) { mutationRef.current = null; setSaving(false) } }
  }

  const editDirty = !!(selected && edit && JSON.stringify(edit) !== JSON.stringify(editDraft(selected)))
  const closeDirty = Object.values(close).some((value) => value.trim() !== '')
  const reopenDirty = Object.values(reopen).some((value) => value.trim() !== '')
  const dirty = action === 'edit' ? editDirty : action === 'close' ? closeDirty : action === 'reopen' ? reopenDirty : action === 'cancel' ? cancelReason.trim() !== '' : false

  // Why each form's primary action cannot proceed yet -- printed beside the
  // button by ShiftSubmitRow, never hidden in a bare `disabled`. The count
  // rule is the shared one (blank is unknown, explicit 0 is counted); the other
  // reasons are the form's own required fields, in the order they appear.
  const editCountBlocker = edit
    ? shiftCountPairBlocker(edit.openingUsd, edit.openingKhr, { blankMeansUncounted: true })
    : null
  const editReason = !edit ? null
    : !edit.openedAt ? t('shift_opened_at_required')
      : editCountBlocker ? t(shiftCountBlockerKey(editCountBlocker))
        : edit.closedAt && (closingCountInvalid(edit.closingUsd) || closingCountInvalid(edit.closingKhr)) ? t(shiftCountBlockerKey('invalid'))
        : edit.closedAt && (closingCountInvalid(edit.additionalUsd) || closingCountInvalid(edit.additionalKhr)) ? t(shiftCountBlockerKey('invalid'))
        : !edit.reason.trim() ? t('shift_reason_required')
          : null
  const closeReason = !close.closedAt ? t('shift_close_time_required')
    : closingCountInvalid(close.closingUsd) || closingCountInvalid(close.closingKhr)
      || closingCountInvalid(close.additionalUsd) || closingCountInvalid(close.additionalKhr) ? t(shiftCountBlockerKey('invalid'))
      : null
  const reopenCountBlocker = shiftCountPairBlocker(reopen.openingUsd, reopen.openingKhr, { blankMeansUncounted: true })
  const reopenReason = !reopen.reason.trim() ? t('shift_reopen_reason')
    : reopenCountBlocker ? t(shiftCountBlockerKey(reopenCountBlocker))
      : null
  const cancelAction = <button type="button" className="btn-secondary" onClick={resetAction} disabled={saving || pending}>{t('shift_action_cancel')}</button>
  const dismiss = () => {
    if (saving) return
    setOpen(false)
    setSelected(null)
    setAction(null)
  }

  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label || t('shift_history')}
      </button>
      {open ? (
        <Modal
          title={selected ? `${fmtDateOnly(selected.business_date)} · ${selected.shift_code}` : t('shift_history')}
          onClose={dismiss}
          closeDisabled={saving}
          size="xl"
          layer={layer}
          unsavedChanges={{ dirty }}
        >
          {selected ? (
            <div className="space-y-4">
              <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => { detailsRequest.current += 1; setSelected(null); resetAction() }} disabled={saving || dirty}>
                <ArrowLeft className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t('back')}
              </button>
              <ShiftSummary shift={selected} detail />
              {detailsLoading ? <p role="status" className="text-sm text-gray-500">{t('shift_current_loading')}</p> : null}
              {detailsError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><span>{detailsError}</span><button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={saving} onClick={() => { if (selected) void openDetails(selected) }}>{t('refresh')}</button></div> : null}

              {!detailsLoading && !detailsError && (pending || selected.capabilities.can_edit || selected.capabilities.can_close || selected.capabilities.can_reopen || selected.capabilities.can_cancel) ? (
                <section className="space-y-3" aria-label={t('shift_actions')}>
                  <div className="flex flex-wrap gap-2">
                    {selected.capabilities.can_edit ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={saving || pending || dirty && action !== 'edit'} onClick={() => { if (action === 'edit') resetAction(); else { setEdit(editDraft(selected)); setAction('edit') } }}><Pencil className="mr-1 inline h-3.5 w-3.5" />{t('shift_action_edit')}</button> : null}
                    {selected.capabilities.can_close ? <button type="button" className="min-h-11 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50" disabled={saving || pending || dirty && action !== 'close'} onClick={() => { if (action === 'close') resetAction(); else { setClose(blankClose(selected)); setAction('close') } }}>{t('shift_action_close')}</button> : null}
                    {selected.capabilities.can_reopen ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={saving || pending || dirty && action !== 'reopen'} onClick={() => { if (action === 'reopen') resetAction(); else { setReopen(blankReopen()); setAction('reopen') } }}>{t('shift_action_reopen')}</button> : null}
                    {selected.capabilities.can_cancel ? <button type="button" className="btn-danger min-h-11 px-3 text-xs" disabled={saving || pending || dirty && action !== 'cancel'} onClick={() => { if (action === 'cancel') resetAction(); else { setCancelReason(''); setAction('cancel') } }}>{t('shift_action_cancel_shift')}</button> : null}
                  </div>

                  {action === 'edit' && edit ? (
                    <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                      <h3 className="text-sm font-semibold">{t('shift_amend')}</h3>
                      <fieldset disabled={saving || pending} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <div className="text-xs"><span className="block">{t('shift_opened_at')}</span><DateTimeEntryInput className="mt-1" value={edit.openedAt} onChange={(next) => setEdit({ ...edit, openedAt: next })} t={t} dateAriaLabel={`${t('shift_opened_at')} · ${t('date')}`} timeAriaLabel={`${t('shift_opened_at')} · ${t('time')}`} /></div>
                        <div className="text-xs"><span className="block">{t('shift_closed_at')}</span><DateTimeEntryInput className="mt-1" value={edit.closedAt} disabled={!selected.closed_at} onChange={(next) => setEdit({ ...edit, closedAt: next })} t={t} dateAriaLabel={`${t('shift_closed_at')} · ${t('date')}`} timeAriaLabel={`${t('shift_closed_at')} · ${t('time')}`} /></div>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')} usd={edit.openingUsd} khr={edit.openingKhr} onUsd={(value) => setEdit({ ...edit, openingUsd: value })} onKhr={(value) => setEdit({ ...edit, openingKhr: value })} />
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_additional_cash')} usdLabel={t('shift_additional_usd')} khrLabel={t('shift_additional_khr')} hint={t('shift_additional_cash_hint')} hintDetail={t('shift_additional_cash_example')} usd={edit.additionalUsd} khr={edit.additionalKhr} disabled={!edit.closedAt} onUsd={(value) => setEdit({ ...edit, additionalUsd: value })} onKhr={(value) => setEdit({ ...edit, additionalKhr: value })} />
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')} hint={t('shift_registered_cash_hint')} usd={edit.closingUsd} khr={edit.closingKhr} disabled={!edit.closedAt} onUsd={(value) => setEdit({ ...edit, closingUsd: value })} onKhr={(value) => setEdit({ ...edit, closingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_opening_note')}<input className="input mt-1" value={edit.openingNote} onChange={(event) => setEdit({ ...edit, openingNote: event.target.value })} /></label>
                        <label className="text-xs sm:col-span-2">{t('shift_closing_note')}<input className="input mt-1" value={edit.closingNote} disabled={!edit.closedAt} onChange={(event) => setEdit({ ...edit, closingNote: event.target.value })} /></label>
                        <label className="text-xs font-semibold sm:col-span-2">{t('shift_reason_required')}<textarea className="input mt-1 min-h-20" required value={edit.reason} onChange={(event) => setEdit({ ...edit, reason: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={editReason} busy={saving} label={pending ? t('retry') : t('shift_save_amendment')} onClick={() => void saveEdit()} secondary={cancelAction} />
                    </div>
                  ) : null}

                  {action === 'close' ? (
                    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                      {/* The bound, when the server states one: the instant
                          this close has to precede, which is also the instant
                          the closing time below was prefilled from. Without it
                          that prefill is a number the operator cannot check,
                          and the 409 naming "the next shift segment" names a
                          segment they never saw. One row, with the same key and
                          formatter the POS carry-over strip uses. */}
                      <div><h3 className="text-sm font-semibold">{t('shift_close_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_close_time_hint')}</p>
                        {selected.close_before ? <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300"><span className="font-medium">{t('shift_previous_open_close_before')}</span> · {fmtDateTime24(selected.close_before)}</p> : null}</div>
                      <fieldset disabled={saving || pending} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <div className="text-xs font-semibold sm:col-span-2"><span className="block">{t('shift_close_time_required')}</span><DateTimeEntryInput className="mt-1" value={close.closedAt} onChange={(next) => setClose({ ...close, closedAt: next })} t={t} dateAriaLabel={`${t('shift_close_time_required')} · ${t('date')}`} timeAriaLabel={`${t('shift_close_time_required')} · ${t('time')}`} /></div>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_additional_cash')} usdLabel={t('shift_additional_usd')} khrLabel={t('shift_additional_khr')} hint={t('shift_additional_cash_hint')} hintDetail={t('shift_additional_cash_example')} usd={close.additionalUsd} khr={close.additionalKhr} onUsd={(value) => setClose({ ...close, additionalUsd: value })} onKhr={(value) => setClose({ ...close, additionalKhr: value })} />
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')} hint={t('shift_registered_cash_hint')} usd={close.closingUsd} khr={close.closingKhr} onUsd={(value) => setClose({ ...close, closingUsd: value })} onKhr={(value) => setClose({ ...close, closingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_closing_note')}<input className="input mt-1" value={close.closingNote} onChange={(event) => setClose({ ...close, closingNote: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={closeReason} busy={saving} label={pending ? t('retry') : t('shift_action_close')} onClick={() => void saveClose()} secondary={cancelAction} buttonClassName="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white" />
                    </div>
                  ) : null}

                  {action === 'reopen' ? (
                    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
                      <div><h3 className="text-sm font-semibold">{t('shift_reopen_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_reopen_hint')}</p></div>
                      <fieldset disabled={saving || pending} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <label className="text-xs font-semibold sm:col-span-2">{t('shift_reopen_reason')}<textarea className="input mt-1 min-h-20" required value={reopen.reason} onChange={(event) => setReopen({ ...reopen, reason: event.target.value })} /></label>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')} usd={reopen.openingUsd} khr={reopen.openingKhr} onUsd={(value) => setReopen({ ...reopen, openingUsd: value })} onKhr={(value) => setReopen({ ...reopen, openingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_opening_note')}<input className="input mt-1" value={reopen.openingNote} onChange={(event) => setReopen({ ...reopen, openingNote: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={reopenReason} busy={saving} label={pending ? t('retry') : t('shift_action_reopen')} onClick={() => void saveReopen()} secondary={cancelAction} />
                    </div>
                  ) : null}

                  {action === 'cancel' ? (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
                      <div><h3 className="text-sm font-semibold">{t('shift_cancel_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_cancel_hint')}</p></div>
                      <label className="block text-xs font-semibold">{t('shift_cancel_reason')}<textarea className="input mt-1 min-h-20" required maxLength={500} disabled={saving || pending} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
                      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={resetAction} disabled={saving || pending}>{t('shift_action_cancel')}</button><button type="button" className="btn-danger" disabled={saving || !cancelReason.trim()} onClick={() => void saveCancel()}>{saving ? t('saving_label') : t('shift_action_cancel_shift')}</button></div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* The SEGMENTS of this record, oldest first. A reopen continues
                  a shift into a new row and the list shows the record as one
                  row, so the float is where the chain is readable -- and each
                  segment opens as its own detail. Shown only when there is
                  more than one: a shift that was never reopened has nothing
                  to chain. */}
              {!detailsLoading && !detailsError && segments.length > 1 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('shift_segments')}</h3>
                  <ol className="space-y-2">
                    {segments.map((segment) => (
                      <li key={segment.id}>
                        <button
                          type="button"
                          onClick={() => { if (segment.id !== selected.id) void openDetails(segment) }}
                          disabled={saving || dirty}
                          className={`block w-full rounded-xl text-left outline-none ring-blue-500 transition focus-visible:ring-2 ${segment.id === selected.id ? 'ring-2' : 'hover:bg-blue-50 dark:hover:bg-blue-950/20'}`}
                        >
                          <ShiftSummary shift={segment} />
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section aria-busy={detailsLoading}>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('shift_amendments')}</h3>
                {!detailsLoading && !detailsError ? <AmendmentList rows={amendments} segments={segments} /> : null}
              </section>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{scope === 'all' ? t('shift_history_all') : t('shift_history_own')}</p>
                <button type="button" onClick={() => void load(true)} className="btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={loading}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />{t('refresh')}</button>
              </div>
              {loading ? <p role="status" className="py-6 text-center text-sm text-gray-500">{t('shift_current_loading')}</p>
                : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
                : rows.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-gray-500">{t('shift_history_empty')}</p>
                : <div className="max-h-[min(65vh,38rem)] space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">{rows.map((shift) => <button key={shift.id} type="button" onClick={() => void openDetails(shift)} className="block w-full rounded-xl text-left outline-none ring-blue-500 transition hover:bg-blue-50 focus-visible:ring-2 dark:hover:bg-blue-950/20"><ShiftSummary shift={shift} /></button>)}</div>}
              <div className="min-h-11">
              {!loading && !error && pageInfo.total != null ? <PaginationControls compact page={pageInfo.page} pageSize={pageSize} totalItems={pageInfo.total} t={t}
                onPageChange={(next) => setPaging({ scope: actorScope, page: next, size: pageSize })}
                onPageSizeChange={(size) => setPaging({ scope: actorScope, page: 1, size })} /> : null}
              </div>
            </div>
          )}
        </Modal>
      ) : null}
    </>
  )
}
