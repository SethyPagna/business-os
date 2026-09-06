import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import { useApp } from '../../AppContext.tsx'
import { BUSINESS_TIME_ZONE } from '../../constants.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import Modal from '../shared/Modal.tsx'
import { SHIFT_BRANCH_CHANGED_EVENT, SHIFT_STATE_CHANGED_EVENT } from '../pos/ShiftGate.tsx'
import ShiftSummary from './ShiftSummary.tsx'
import ShiftCountPair, { ShiftSubmitRow, shiftCountBlockerKey } from './ShiftCountFields.tsx'
import {
  amendShift,
  cancelShift,
  closeShiftById,
  fetchShiftHistory,
  listShifts,
  orderShiftRows,
  reopenShift,
  shiftCountOrZero,
  shiftCountPairBlocker,
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

type EditDraft = {
  expectedRevision: number
  reason: string
  openedAt: string
  closedAt: string
  openingUsd: string
  openingKhr: string
  closingUsd: string
  closingKhr: string
  openingNote: string
  closingNote: string
}

type CloseDraft = { closedAt: string; closingUsd: string; closingKhr: string; closingNote: string }
type ReopenDraft = { reason: string; openingUsd: string; openingKhr: string; openingNote: string }
type ActionMode = 'edit' | 'close' | 'reopen' | 'cancel' | null

const blankClose = (): CloseDraft => ({ closedAt: '', closingUsd: '', closingKhr: '', closingNote: '' })
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
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

const editDraft = (shift: Shift): EditDraft => ({
  expectedRevision: shift.revision,
  reason: '',
  openedAt: dateTimeLocal(shift.opened_at),
  closedAt: dateTimeLocal(shift.closed_at),
  openingUsd: String(shift.opening_float_usd ?? 0),
  openingKhr: String(shift.opening_float_khr ?? 0),
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

function AmendmentList({ rows }: { rows: ShiftAmendment[] }) {
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
            <div className="text-gray-500 dark:text-gray-400">{row.actor_name || `${t('shift_staff')} ${row.actor_user_id}`} · {fmtDateTime24(row.created_at)}</div>
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

export default function ShiftHistoryModal({ branchId, userId, limit = 50, layer = 'default', label, buttonClassName = 'btn-secondary min-h-11 text-xs', notify }: Props) {
  const app = useApp() as { t: (key: string) => string; notify?: (message: string, tone?: string) => void }
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
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [action, setAction] = useState<ActionMode>(null)
  const [edit, setEdit] = useState<EditDraft | null>(null)
  const [close, setClose] = useState<CloseDraft>(blankClose)
  const [reopen, setReopen] = useState<ReopenDraft>(blankReopen)
  const [cancelReason, setCancelReason] = useState('')
  const [saving, setSaving] = useState(false)

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

  const load = useCallback(async () => {
    const requestId = ++listRequest.current
    setLoading(true)
    setError('')
    try {
      const result = await listShifts({ branchId: activeBranchId, userId, limit })
      if (requestId === listRequest.current) {
        setRows(orderShiftRows(result.shifts))
        setScope(result.scope)
      }
    } catch (cause) {
      if (requestId === listRequest.current) setError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (requestId === listRequest.current) setLoading(false)
    }
  }, [activeBranchId, limit, t, userId])

  useEffect(() => {
    if (!open) return
    void load()
    return () => { listRequest.current += 1; detailsRequest.current += 1 }
  }, [load, open])

  const resetAction = () => {
    setAction(null)
    setClose(blankClose())
    setReopen(blankReopen())
    setCancelReason('')
  }

  const openDetails = async (shift: Shift) => {
    const requestId = ++detailsRequest.current
    setSelected(shift)
    setEdit(editDraft(shift))
    setAmendments([])
    setAction(null)
    setDetailsLoading(true)
    setDetailsError('')
    try {
      const result = await fetchShiftHistory(shift.id)
      if (requestId === detailsRequest.current) {
        setSelected(result.shift)
        setEdit(editDraft(result.shift))
        setAmendments(result.amendments)
      }
    } catch (cause) {
      if (requestId === detailsRequest.current) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (requestId === detailsRequest.current) setDetailsLoading(false)
    }
  }

  const replaceRow = (shift: Shift) => {
    setSelected(shift)
    setEdit(editDraft(shift))
    setRows((current) => orderShiftRows(current.map((row) => row.id === shift.id ? shift : row)))
  }

  const refreshDetails = async (shift: Shift) => {
    const requestId = ++detailsRequest.current
    setDetailsLoading(true)
    try {
      const history = await fetchShiftHistory(shift.id)
      if (requestId === detailsRequest.current) {
        replaceRow(history.shift)
        setAmendments(history.amendments)
        setDetailsError('')
      }
    } catch (cause) {
      if (requestId === detailsRequest.current) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally {
      if (requestId === detailsRequest.current) setDetailsLoading(false)
    }
  }

  const reportSaveError = (cause: unknown, fallbackKey: string) => {
    const message = cause instanceof Error ? cause.message : t(fallbackKey)
    if (Number((cause as { status?: unknown } | null)?.status) === 409) setDetailsError(message)
    sendNotice?.(message, 'error')
  }

  const saveEdit = async () => {
    if (!selected || !edit || !edit.reason.trim() || !edit.openedAt || saving) return
    // Blank counts are 0 (the shared shiftCountOrZero rule); only an invalid
    // entry stays null and stops the save -- and the row beside the button
    // has already said which.
    const openingFloatUsd = shiftCountOrZero(edit.openingUsd)
    const openingFloatKhr = shiftCountOrZero(edit.openingKhr)
    const closingCountedUsd = edit.closedAt ? shiftCountOrZero(edit.closingUsd) : null
    const closingCountedKhr = edit.closedAt ? shiftCountOrZero(edit.closingKhr) : null
    if (openingFloatUsd == null || openingFloatKhr == null
      || (edit.closedAt && (closingCountedUsd == null || closingCountedKhr == null))) return
    setSaving(true)
    try {
      const result = await amendShift(selected.id, {
        expectedRevision: edit.expectedRevision,
        reason: edit.reason.trim(),
        openedAt: shiftLocalDateTimeToIso(edit.openedAt),
        openingFloatUsd,
        openingFloatKhr,
        openingNote: edit.openingNote.trim() || null,
        closedAt: edit.closedAt ? shiftLocalDateTimeToIso(edit.closedAt) : null,
        closingCountedUsd,
        closingCountedKhr,
        closingNote: edit.closedAt ? edit.closingNote.trim() || null : null,
      })
      replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_amend_saved'), 'success')
      await refreshDetails(result.shift)
    } catch (cause) {
      reportSaveError(cause, 'shift_amend_failed')
    } finally { setSaving(false) }
  }

  const saveClose = async () => {
    if (!selected || !close.closedAt || saving) return
    const closingCountedUsd = shiftCountOrZero(close.closingUsd)
    const closingCountedKhr = shiftCountOrZero(close.closingKhr)
    if (closingCountedUsd == null || closingCountedKhr == null) return
    setSaving(true)
    try {
      const result = await closeShiftById(selected.id, {
        expectedRevision: selected.revision,
        closedAt: shiftLocalDateTimeToIso(close.closedAt),
        closingCountedUsd,
        closingCountedKhr,
        closingNote: close.closingNote.trim() || null,
      })
      if (result.shift) replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_close_saved'), 'success')
      await refreshDetails(result.shift)
    } catch (cause) {
      reportSaveError(cause, 'shift_end_failed')
    } finally { setSaving(false) }
  }

  const saveReopen = async () => {
    if (!selected || !reopen.reason.trim() || saving) return
    const openingFloatUsd = shiftCountOrZero(reopen.openingUsd)
    const openingFloatKhr = shiftCountOrZero(reopen.openingKhr)
    if (openingFloatUsd == null || openingFloatKhr == null) return
    setSaving(true)
    try {
      const result = await reopenShift(selected.id, {
        expectedRevision: selected.revision,
        reason: reopen.reason.trim(),
        openingFloatUsd,
        openingFloatKhr,
        openingNote: reopen.openingNote.trim() || null,
      })
      setRows((current) => orderShiftRows([...current.filter((row) => row.id !== result.shift.id), result.shift]))
      setSelected(result.shift)
      setEdit(editDraft(result.shift))
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_reopen_saved'), 'success')
      await refreshDetails(result.shift)
    } catch (cause) {
      reportSaveError(cause, 'shift_reopen_failed')
    } finally { setSaving(false) }
  }

  const saveCancel = async () => {
    if (!selected || !cancelReason.trim() || saving) return
    setSaving(true)
    try {
      const result = await cancelShift(selected.id, selected.revision, cancelReason.trim())
      replaceRow(result.shift)
      resetAction()
      refreshMountedShiftState()
      sendNotice?.(t('shift_cancel_saved'), 'success')
      await refreshDetails(result.shift)
    } catch (cause) {
      reportSaveError(cause, 'shift_cancel_failed')
    } finally { setSaving(false) }
  }

  const editDirty = !!(selected && edit && JSON.stringify(edit) !== JSON.stringify(editDraft(selected)))
  const closeDirty = Object.values(close).some((value) => value.trim() !== '')
  const reopenDirty = Object.values(reopen).some((value) => value.trim() !== '')
  const dirty = action === 'edit' ? editDirty : action === 'close' ? closeDirty : action === 'reopen' ? reopenDirty : action === 'cancel' ? cancelReason.trim() !== '' : false

  // Why each form's primary action cannot proceed yet -- printed beside the
  // button by ShiftSubmitRow, never hidden in a bare `disabled`. The count
  // rule is the shared one (either currency is enough, blank is 0); the other
  // reasons are the form's own required fields, in the order they appear.
  const editCountBlocker = edit
    ? shiftCountPairBlocker(edit.openingUsd, edit.openingKhr) || (edit.closedAt ? shiftCountPairBlocker(edit.closingUsd, edit.closingKhr) : null)
    : null
  const editReason = !edit ? null
    : !edit.openedAt ? t('shift_opened_at_required')
      : editCountBlocker ? t(shiftCountBlockerKey(editCountBlocker))
        : !edit.reason.trim() ? t('shift_reason_required')
          : null
  const closeCountBlocker = shiftCountPairBlocker(close.closingUsd, close.closingKhr)
  const closeReason = !close.closedAt ? t('shift_close_time_required')
    : closeCountBlocker ? t(shiftCountBlockerKey(closeCountBlocker))
      : null
  const reopenCountBlocker = shiftCountPairBlocker(reopen.openingUsd, reopen.openingKhr)
  const reopenReason = !reopen.reason.trim() ? t('shift_reopen_reason')
    : reopenCountBlocker ? t(shiftCountBlockerKey(reopenCountBlocker))
      : null
  const cancelAction = <button type="button" className="btn-secondary" onClick={resetAction} disabled={saving}>{t('shift_action_cancel')}</button>
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

              {!detailsLoading && !detailsError && (selected.capabilities.can_edit || selected.capabilities.can_close || selected.capabilities.can_reopen || selected.capabilities.can_cancel) ? (
                <section className="space-y-3" aria-label={t('shift_actions')}>
                  <div className="flex flex-wrap gap-2">
                    {selected.capabilities.can_edit ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={dirty && action !== 'edit'} onClick={() => { if (action === 'edit') resetAction(); else { setEdit(editDraft(selected)); setAction('edit') } }}><Pencil className="mr-1 inline h-3.5 w-3.5" />{t('shift_action_edit')}</button> : null}
                    {selected.capabilities.can_close ? <button type="button" className="min-h-11 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50" disabled={dirty && action !== 'close'} onClick={() => { if (action === 'close') resetAction(); else { setClose(blankClose()); setAction('close') } }}>{t('shift_action_close')}</button> : null}
                    {selected.capabilities.can_reopen ? <button type="button" className="btn-secondary min-h-11 px-3 text-xs" disabled={dirty && action !== 'reopen'} onClick={() => { if (action === 'reopen') resetAction(); else { setReopen(blankReopen()); setAction('reopen') } }}>{t('shift_action_reopen')}</button> : null}
                    {selected.capabilities.can_cancel ? <button type="button" className="btn-danger min-h-11 px-3 text-xs" disabled={dirty && action !== 'cancel'} onClick={() => { if (action === 'cancel') resetAction(); else { setCancelReason(''); setAction('cancel') } }}>{t('shift_action_cancel_shift')}</button> : null}
                  </div>

                  {action === 'edit' && edit ? (
                    <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                      <h3 className="text-sm font-semibold">{t('shift_amend')}</h3>
                      <fieldset disabled={saving} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <label className="text-xs">{t('shift_opened_at')}<input className="input mt-1" type="datetime-local" value={edit.openedAt} onChange={(event) => setEdit({ ...edit, openedAt: event.target.value })} /></label>
                        <label className="text-xs">{t('shift_closed_at')}<input className="input mt-1" type="datetime-local" value={edit.closedAt} disabled={!selected.closed_at} onChange={(event) => setEdit({ ...edit, closedAt: event.target.value })} /></label>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')} usd={edit.openingUsd} khr={edit.openingKhr} onUsd={(value) => setEdit({ ...edit, openingUsd: value })} onKhr={(value) => setEdit({ ...edit, openingKhr: value })} />
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')} usd={edit.closingUsd} khr={edit.closingKhr} disabled={!edit.closedAt} onUsd={(value) => setEdit({ ...edit, closingUsd: value })} onKhr={(value) => setEdit({ ...edit, closingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_opening_note')}<input className="input mt-1" value={edit.openingNote} onChange={(event) => setEdit({ ...edit, openingNote: event.target.value })} /></label>
                        <label className="text-xs sm:col-span-2">{t('shift_closing_note')}<input className="input mt-1" value={edit.closingNote} disabled={!edit.closedAt} onChange={(event) => setEdit({ ...edit, closingNote: event.target.value })} /></label>
                        <label className="text-xs font-semibold sm:col-span-2">{t('shift_reason_required')}<textarea className="input mt-1 min-h-20" required value={edit.reason} onChange={(event) => setEdit({ ...edit, reason: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={editReason} busy={saving} label={t('shift_save_amendment')} onClick={() => void saveEdit()} secondary={cancelAction} />
                    </div>
                  ) : null}

                  {action === 'close' ? (
                    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                      <div><h3 className="text-sm font-semibold">{t('shift_close_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_close_time_hint')}</p></div>
                      <fieldset disabled={saving} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <label className="text-xs font-semibold sm:col-span-2">{t('shift_close_time_required')}<input className="input mt-1" type="datetime-local" required value={close.closedAt} onChange={(event) => setClose({ ...close, closedAt: event.target.value })} /></label>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_counted_cash')} usdLabel={t('shift_counted_usd')} khrLabel={t('shift_counted_khr')} usd={close.closingUsd} khr={close.closingKhr} onUsd={(value) => setClose({ ...close, closingUsd: value })} onKhr={(value) => setClose({ ...close, closingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_closing_note')}<input className="input mt-1" value={close.closingNote} onChange={(event) => setClose({ ...close, closingNote: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={closeReason} busy={saving} label={t('shift_action_close')} onClick={() => void saveClose()} secondary={cancelAction} buttonClassName="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white" />
                    </div>
                  ) : null}

                  {action === 'reopen' ? (
                    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
                      <div><h3 className="text-sm font-semibold">{t('shift_reopen_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_reopen_hint')}</p></div>
                      <fieldset disabled={saving} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_input]:min-w-0 [&_input]:max-w-full">
                        <label className="text-xs font-semibold sm:col-span-2">{t('shift_reopen_reason')}<textarea className="input mt-1 min-h-20" required value={reopen.reason} onChange={(event) => setReopen({ ...reopen, reason: event.target.value })} /></label>
                        <ShiftCountPair className="sm:col-span-2" label={t('shift_opening_cash')} usdLabel={t('shift_float_usd')} khrLabel={t('shift_float_khr')} usd={reopen.openingUsd} khr={reopen.openingKhr} onUsd={(value) => setReopen({ ...reopen, openingUsd: value })} onKhr={(value) => setReopen({ ...reopen, openingKhr: value })} />
                        <label className="text-xs sm:col-span-2">{t('shift_opening_note')}<input className="input mt-1" value={reopen.openingNote} onChange={(event) => setReopen({ ...reopen, openingNote: event.target.value })} /></label>
                      </fieldset>
                      <ShiftSubmitRow reason={reopenReason} busy={saving} label={t('shift_action_reopen')} onClick={() => void saveReopen()} secondary={cancelAction} />
                    </div>
                  ) : null}

                  {action === 'cancel' ? (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
                      <div><h3 className="text-sm font-semibold">{t('shift_cancel_title')}</h3><p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{t('shift_cancel_hint')}</p></div>
                      <label className="block text-xs font-semibold">{t('shift_cancel_reason')}<textarea className="input mt-1 min-h-20" required maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
                      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={resetAction} disabled={saving}>{t('shift_action_cancel')}</button><button type="button" className="btn-danger" disabled={saving || !cancelReason.trim()} onClick={() => void saveCancel()}>{saving ? t('saving_label') : t('shift_action_cancel_shift')}</button></div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section aria-busy={detailsLoading}>
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('shift_amendments')}</h3>
                {!detailsLoading && !detailsError ? <AmendmentList rows={amendments} /> : null}
              </section>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{scope === 'all' ? t('shift_history_all') : t('shift_history_own')}</p>
                <button type="button" onClick={() => void load()} className="btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={loading}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />{t('refresh')}</button>
              </div>
              {loading ? <p role="status" className="py-6 text-center text-sm text-gray-500">{t('shift_current_loading')}</p>
                : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
                : rows.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-gray-500">{t('shift_history_empty')}</p>
                : <div className="max-h-[min(65vh,38rem)] space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">{rows.map((shift) => <button key={shift.id} type="button" onClick={() => void openDetails(shift)} className="block w-full rounded-xl text-left outline-none ring-blue-500 transition hover:bg-blue-50 focus-visible:ring-2 dark:hover:bg-blue-950/20"><ShiftSummary shift={shift} /></button>)}</div>}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  )
}
