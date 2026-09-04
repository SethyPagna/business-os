import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../../app/AppContextCore.tsx'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Modal from '../shared/Modal.tsx'
import ShiftSummary from './ShiftSummary.tsx'
import { amendShift, fetchShiftHistory, listShifts, type Shift, type ShiftAmendment } from '../../api/shiftTransport.ts'

type Props = {
  userId?: number | string | null
  canManage?: boolean
  limit?: number
  compact?: boolean
  notify?: (message: string, tone?: string) => void
}

type Draft = {
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

const datetimeLocal = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const initialDraft = (shift: Shift): Draft => ({
  reason: '', openedAt: datetimeLocal(shift.opened_at), closedAt: datetimeLocal(shift.closed_at),
  openingUsd: String(shift.opening_float_usd ?? 0), openingKhr: String(shift.opening_float_khr ?? 0),
  closingUsd: shift.closing_counted_usd == null ? '' : String(shift.closing_counted_usd),
  closingKhr: shift.closing_counted_khr == null ? '' : String(shift.closing_counted_khr),
  openingNote: shift.opening_note || '', closingNote: shift.closing_note || '',
})

function AmendmentList({ rows }: { rows: ShiftAmendment[] }) {
  const { t } = useApp() as { t: (key: string) => string }
  if (!rows.length) return <p className="text-xs text-gray-500 dark:text-gray-400">{t('shift_no_amendments')}</p>
  return (
    <ol className="space-y-2 border-l border-gray-200 pl-3 dark:border-zinc-700">
      {rows.map((row) => (
        <li key={row.id} className="text-xs leading-relaxed">
          <div className="font-medium text-gray-800 dark:text-gray-100">{row.reason}</div>
          <div className="text-gray-500 dark:text-gray-400">{row.actor_name || `${t('shift_staff')} ${row.actor_user_id}`} · {fmtDateTime24(row.created_at)}</div>
        </li>
      ))}
    </ol>
  )
}

export default function ShiftHistoryPanel({ userId, canManage = false, limit = 20, compact = false, notify }: Props) {
  const { t } = useApp() as { t: (key: string) => string }
  const detailsRequest = useRef(0)
  const listRequest = useRef(0)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [rows, setRows] = useState<Shift[]>([])
  const [scope, setScope] = useState<'all' | 'own'>('own')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Shift | null>(null)
  const [amendments, setAmendments] = useState<ShiftAmendment[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const requestId = ++listRequest.current
    setLoading(true); setError(''); setRows([])
    try {
      const result = await listShifts({ userId, limit })
      if (requestId === listRequest.current) { setRows(result.shifts); setScope(result.scope) }
    } catch (cause) {
      if (requestId === listRequest.current) setError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally { if (requestId === listRequest.current) setLoading(false) }
  }, [limit, userId, t])

  useEffect(() => { void load(); return () => { listRequest.current += 1 } }, [load])
  useEffect(() => { setSelected(null); setSaving(false); return () => { detailsRequest.current += 1 } }, [userId])

  const openDetails = async (shift: Shift) => {
    const requestId = ++detailsRequest.current
    setSelected(shift); setDraft(initialDraft(shift)); setAmendments([]); setDetailsLoading(true); setDetailsError('')
    try {
      const result = await fetchShiftHistory(shift.id)
      if (requestId === detailsRequest.current) {
        setSelected(result.shift); setDraft(initialDraft(result.shift)); setAmendments(result.amendments)
      }
    } catch (cause) {
      if (requestId === detailsRequest.current) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
    } finally { if (requestId === detailsRequest.current) setDetailsLoading(false) }
  }

  const save = async () => {
    if (!selected || !draft || !draft.reason.trim() || saving || detailsLoading || detailsError) return
    const requestId = ++detailsRequest.current
    setSaving(true)
    try {
      const result = await amendShift(selected.id, {
        reason: draft.reason.trim(), openedAt: new Date(draft.openedAt).toISOString(),
        openingFloatUsd: Number(draft.openingUsd) || 0, openingFloatKhr: Number(draft.openingKhr) || 0,
        openingNote: draft.openingNote.trim() || null,
        closedAt: draft.closedAt ? new Date(draft.closedAt).toISOString() : null,
        closingCountedUsd: draft.closedAt ? Number(draft.closingUsd) || 0 : null,
        closingCountedKhr: draft.closedAt ? Number(draft.closingKhr) || 0 : null,
        closingNote: draft.closingNote.trim() || null,
      })
      if (requestId !== detailsRequest.current) return
      // The write is committed even if the follow-up history read fails.
      setSelected(result.shift); setDraft(initialDraft(result.shift))
      setRows((current) => current.map((row) => row.id === result.shift.id ? result.shift : row))
      notify?.(t('shift_amend_saved'), 'success')
      try {
        const history = await fetchShiftHistory(result.shift.id)
        if (requestId === detailsRequest.current) {
          setSelected(history.shift); setDraft(initialDraft(history.shift)); setAmendments(history.amendments)
        }
      } catch (cause) {
        if (requestId === detailsRequest.current) setDetailsError(cause instanceof Error ? cause.message : t('shift_history_failed'))
      }
    } catch (cause) {
      if (requestId === detailsRequest.current) notify?.(cause instanceof Error ? cause.message : t('shift_amend_failed'), 'error')
    } finally { if (requestId === detailsRequest.current) setSaving(false) }
  }

  const dirty = !!(canManage && selected && draft && JSON.stringify(draft) !== JSON.stringify(initialDraft(selected)))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('shift_history')}</h3><p className="text-xs text-gray-500 dark:text-gray-400">{scope === 'all' ? t('shift_history_all') : t('shift_history_own')}</p></div>
        <button type="button" onClick={() => void load()} className="btn-secondary min-h-11 shrink-0 px-3 text-xs" disabled={loading}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />{t('refresh')}</button>
      </div>
      {loading ? <p className="py-4 text-center text-sm text-gray-500">{t('shift_current_loading')}</p> : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p> : rows.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-500">{t('shift_history_empty')}</p> : (
        <div className="space-y-2">{rows.map((shift) => <button key={shift.id} type="button" onClick={() => void openDetails(shift)} className="block w-full text-left"><ShiftSummary shift={shift} title={t('shift_code')} compact={compact} /></button>)}</div>
      )}
      {selected && draft ? <Modal title={`${t('shift_code')} ${selected.shift_code}`} onClose={() => { if (saving) return; detailsRequest.current += 1; setSelected(null) }} wide unsavedChanges={{ dirty }}>
        <div className="space-y-4">
          <ShiftSummary shift={selected} title={t('shift_code')} />
          {detailsLoading ? <p role="status" className="text-sm text-gray-500">{t('shift_current_loading')}</p> : detailsError ? <p role="alert" className="text-sm text-red-600">{detailsError}</p> : null}
          {canManage ? <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
            <div className="flex items-center gap-2 text-sm font-semibold"><Pencil className="h-4 w-4" />{t('shift_amend')}</div>
            <fieldset disabled={saving || detailsLoading || !!detailsError} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_label]:min-w-0 [&_input]:min-w-0 [&_input]:max-w-full">
              <label className="text-xs">{t('shift_opened_at')}<input className="input mt-1" type="datetime-local" value={draft.openedAt} onChange={(e) => setDraft({ ...draft, openedAt: e.target.value })} /></label>
              <label className="text-xs">{t('shift_closed_at')}<input className="input mt-1" type="datetime-local" value={draft.closedAt} disabled={!selected.closed_at} onChange={(e) => setDraft({ ...draft, closedAt: e.target.value })} /></label>
              <label className="text-xs">{t('shift_float_usd')}<input className="input mt-1" type="number" min="0" step="0.01" value={draft.openingUsd} onChange={(e) => setDraft({ ...draft, openingUsd: e.target.value })} /></label>
              <label className="text-xs">{t('shift_float_khr')}<input className="input mt-1" type="number" min="0" step="100" value={draft.openingKhr} onChange={(e) => setDraft({ ...draft, openingKhr: e.target.value })} /></label>
              <label className="text-xs">{t('shift_counted_usd')}<input className="input mt-1" type="number" min="0" step="0.01" value={draft.closingUsd} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingUsd: e.target.value })} /></label>
              <label className="text-xs">{t('shift_counted_khr')}<input className="input mt-1" type="number" min="0" step="100" value={draft.closingKhr} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingKhr: e.target.value })} /></label>
            <label className="block text-xs sm:col-span-2">{t('shift_opening_note')}<input className="input mt-1" value={draft.openingNote} onChange={(e) => setDraft({ ...draft, openingNote: e.target.value })} /></label>
            <label className="block text-xs sm:col-span-2">{t('shift_closing_note')}<input className="input mt-1" value={draft.closingNote} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingNote: e.target.value })} /></label>
            <label className="block text-xs font-semibold sm:col-span-2">{t('shift_reason_required')}<textarea className="input mt-1 min-h-20" required value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
            </fieldset>
            <div className="flex justify-end"><button type="button" className="btn-primary" disabled={saving || detailsLoading || !!detailsError || !draft.reason.trim() || !draft.openedAt} onClick={() => void save()}>{saving ? t('saving_label') : t('shift_save_amendment')}</button></div>
          </div> : null}
          <section aria-busy={detailsLoading}><h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('shift_amendments')}</h3>{!detailsLoading && !detailsError ? <AmendmentList rows={amendments} /> : null}</section>
        </div>
      </Modal> : null}
    </div>
  )
}
