import { useCallback, useEffect, useMemo, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Modal from '../shared/Modal.tsx'
import { getReturnReasonPresets } from '../../api/returnsReadTransport.ts'
import { getReturnReasonImpact, replaceReturnReason, saveReturnReasonPresets } from '../../api/returnsTransport.ts'
import {
  buildDefaultReturnReasonPresets,
  normalizeReturnReasonList,
  removeReturnReasonPreset,
  resolveReturnReasonPresets,
  type ReturnReasonPresets,
  type ReturnReasonPresetResponse,
  type ReturnReasonScope,
} from './helpers/returnReasonPresets.ts'

type Props = {
  onClose: () => void
  onChanged?: () => void
  notify: (message: string, type?: string) => void
  t: (key: string) => string
}

export default function ReturnReasonManagerModal({ onClose, onChanged, notify, t }: Props) {
  const fallback = useMemo(() => buildDefaultReturnReasonPresets(t), [t])
  const [scope, setScope] = useState<ReturnReasonScope>('customer')
  const [presets, setPresets] = useState<ReturnReasonPresets>(fallback)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getReturnReasonPresets() as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, fallback))
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to load saved return reasons', 'error')
    } finally {
      setLoading(false)
    }
  }, [fallback, notify])

  useEffect(() => { void load() }, [load])

  const persist = async (next: ReturnReasonPresets, successMessage: string) => {
    setSaving(true)
    try {
      const response = await saveReturnReasonPresets(next) as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, next))
      notify(successMessage, 'success')
      onChanged?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to save return reasons', 'error')
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    const label = draft.trim().replace(/\s+/g, ' ')
    if (!label) return
    const nextList = normalizeReturnReasonList([...presets[scope], label])
    if (nextList.length === presets[scope].length) {
      notify('That reason already exists.', 'info')
      return
    }
    setDraft('')
    await persist({ ...presets, [scope]: nextList }, 'Saved return reason added.')
  }

  const rename = async (from: string) => {
    const to = window.prompt('Rename saved return reason', from)?.trim().replace(/\s+/g, ' ')
    if (!to || to.toLocaleLowerCase() === from.toLocaleLowerCase()) return
    setSaving(true)
    try {
      const impact = await getReturnReasonImpact({ return_scope: scope, from, to }) as { linked_records?: number; target_exists?: boolean }
      const linked = Number(impact.linked_records || 0)
      const targetNote = impact.target_exists ? ' The target already exists, so the presets will merge.' : ''
      const replaceLinked = linked > 0 && window.confirm(
        `${linked} live ${scope} return${linked === 1 ? '' : 's'} use "${from}".${targetNote}\n\nOK: update those exact matches too.\nCancel: rename only the saved preset.\nAudit and stock history remain unchanged.`,
      )
      const response = await replaceReturnReason({
        return_scope: scope,
        from,
        to,
        scope: replaceLinked ? 'linked' : 'presets_only',
        presets,
      }) as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, presets))
      notify(replaceLinked ? 'Saved reason and linked returns updated.' : 'Saved reason updated; existing returns were preserved.', 'success')
      onChanged?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to rename return reason', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (value: string) => {
    if (!window.confirm(`Remove "${value}" from saved choices? Existing returns keep their recorded reason.`)) return
    await persist(removeReturnReasonPreset(presets, scope, value), 'Saved choice removed; existing returns were preserved.')
  }

  return (
    <Modal title="Return reasons" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['customer', 'supplier'] as ReturnReasonScope[]).map((value) => (
            <button key={value} type="button" onClick={() => setScope(value)} className={`h-8 rounded-md px-2 text-xs font-semibold capitalize ${scope === value ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500'}`}>
              {value}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 gap-1.5">
          <input className="input h-9 min-w-0 flex-1 text-sm" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add() }} placeholder="Add reusable reason" />
          <button type="button" className="btn-primary h-9 shrink-0 px-3 text-xs" disabled={saving || !draft.trim()} onClick={() => void add()}>Add</button>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading ? <div className="py-6 text-center text-sm text-slate-400">Loading…</div> : presets[scope].length ? presets[scope].map((reason) => (
            <div key={reason.toLocaleLowerCase()} className="flex min-w-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{reason}</span>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 dark:text-blue-300" onClick={() => void rename(reason)} disabled={saving} aria-label={`Rename ${reason}`} title="Preview and rename"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 hover:bg-red-50 dark:text-red-300" onClick={() => void remove(reason)} disabled={saving} aria-label={`Remove ${reason}`} title="Remove saved choice"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )) : <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400 dark:border-slate-700">No saved reasons. Free-text entry remains available.</div>}
        </div>
      </div>
    </Modal>
  )
}
