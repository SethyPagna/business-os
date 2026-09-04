import { useCallback, useEffect, useState } from 'react'
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
  if (!rows.length) return <p className="text-xs text-gray-500 dark:text-gray-400">No amendments recorded.</p>
  return (
    <ol className="space-y-2 border-l border-gray-200 pl-3 dark:border-zinc-700">
      {rows.map((row) => (
        <li key={row.id} className="text-xs leading-relaxed">
          <div className="font-medium text-gray-800 dark:text-gray-100">{row.reason}</div>
          <div className="text-gray-500 dark:text-gray-400">{row.actor_name || `User ${row.actor_user_id}`} · {new Date(row.created_at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  )
}

export default function ShiftHistoryPanel({ userId, canManage = false, limit = 20, compact = false, notify }: Props) {
  const [rows, setRows] = useState<Shift[]>([])
  const [scope, setScope] = useState<'all' | 'own'>('own')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Shift | null>(null)
  const [amendments, setAmendments] = useState<ShiftAmendment[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await listShifts({ userId, limit })
      setRows(result.shifts); setScope(result.scope)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read shift history')
    } finally { setLoading(false) }
  }, [limit, userId])

  useEffect(() => { void load() }, [load])

  const openDetails = async (shift: Shift) => {
    setSelected(shift); setDraft(initialDraft(shift)); setAmendments([])
    try {
      const result = await fetchShiftHistory(shift.id)
      setSelected(result.shift); setDraft(initialDraft(result.shift)); setAmendments(result.amendments)
    } catch (cause) { notify?.(cause instanceof Error ? cause.message : 'Could not read shift amendments', 'error') }
  }

  const save = async () => {
    if (!selected || !draft || !draft.reason.trim() || saving) return
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
      const history = await fetchShiftHistory(result.shift.id)
      setSelected(history.shift); setDraft(initialDraft(history.shift)); setAmendments(history.amendments)
      setRows((current) => current.map((row) => row.id === history.shift.id ? history.shift : row))
      notify?.('Shift amendment saved with an audit record.', 'success')
    } catch (cause) { notify?.(cause instanceof Error ? cause.message : 'Could not amend shift', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">Shift history</h3><p className="text-xs text-gray-500 dark:text-gray-400">{scope === 'all' ? 'Authorized shop history' : 'Your recorded shifts'}</p></div>
        <button type="button" onClick={() => void load()} className="btn-secondary min-h-9 px-3 text-xs" disabled={loading}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Refresh</button>
      </div>
      {loading ? <p className="py-4 text-center text-sm text-gray-500">Loading shifts…</p> : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p> : rows.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-gray-500">No shifts recorded.</p> : (
        <div className="space-y-2">{rows.map((shift) => <button key={shift.id} type="button" onClick={() => void openDetails(shift)} className="block w-full text-left"><ShiftSummary shift={shift} compact={compact} /></button>)}</div>
      )}
      {selected && draft ? <Modal title={`Shift ${selected.shift_code}`} onClose={() => setSelected(null)} wide unsavedChanges={{ dirty: canManage && draft.reason.trim() !== '' }}>
        <div className="space-y-4">
          <ShiftSummary shift={selected} />
          {canManage ? <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
            <div className="flex items-center gap-2 text-sm font-semibold"><Pencil className="h-4 w-4" />Amend shift</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">Opened<input className="input mt-1" type="datetime-local" value={draft.openedAt} onChange={(e) => setDraft({ ...draft, openedAt: e.target.value })} /></label>
              <label className="text-xs">Closed<input className="input mt-1" type="datetime-local" value={draft.closedAt} onChange={(e) => setDraft({ ...draft, closedAt: e.target.value })} /></label>
              <label className="text-xs">Opening USD<input className="input mt-1" type="number" min="0" step="0.01" value={draft.openingUsd} onChange={(e) => setDraft({ ...draft, openingUsd: e.target.value })} /></label>
              <label className="text-xs">Opening KHR<input className="input mt-1" type="number" min="0" step="100" value={draft.openingKhr} onChange={(e) => setDraft({ ...draft, openingKhr: e.target.value })} /></label>
              <label className="text-xs">Closing USD<input className="input mt-1" type="number" min="0" step="0.01" value={draft.closingUsd} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingUsd: e.target.value })} /></label>
              <label className="text-xs">Closing KHR<input className="input mt-1" type="number" min="0" step="100" value={draft.closingKhr} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingKhr: e.target.value })} /></label>
            </div>
            <label className="block text-xs">Opening note<input className="input mt-1" value={draft.openingNote} onChange={(e) => setDraft({ ...draft, openingNote: e.target.value })} /></label>
            <label className="block text-xs">Closing note<input className="input mt-1" value={draft.closingNote} disabled={!draft.closedAt} onChange={(e) => setDraft({ ...draft, closingNote: e.target.value })} /></label>
            <label className="block text-xs font-semibold">Reason (required)<textarea className="input mt-1 min-h-20" required value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
            <div className="flex justify-end"><button type="button" className="btn-primary" disabled={saving || !draft.reason.trim() || !draft.openedAt} onClick={() => void save()}>{saving ? 'Saving…' : 'Save amendment'}</button></div>
          </div> : null}
          <section><h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Amendment record</h3><AmendmentList rows={amendments} /></section>
        </div>
      </Modal> : null}
    </div>
  )
}
