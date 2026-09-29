import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../shared/Modal.tsx'
import ReasonListEditor from '../shared/ReasonListEditor.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
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

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

type Props = {
  onClose: () => void
  onChanged?: () => void
  notify: (message: string, type?: string) => void
  t: (key: string) => string
  tr: Translate
}

export default function ReturnReasonManagerModal({ onClose, onChanged, notify, t, tr }: Props) {
  const fallback = useMemo(() => buildDefaultReturnReasonPresets(t), [t])
  const [scope, setScope] = useState<ReturnReasonScope>('customer')
  const [presets, setPresets] = useState<ReturnReasonPresets>(fallback)
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getReturnReasonPresets() as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, fallback))
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('return_reason_load_failed', 'Failed to load saved return reasons'), 'error')
    } finally {
      setLoading(false)
    }
  }, [fallback, notify, tr])

  useEffect(() => { void load() }, [load])

  const persist = async (next: ReturnReasonPresets, successMessage: string) => {
    setSaving(true)
    try {
      const response = await saveReturnReasonPresets(next) as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, next))
      notify(successMessage, 'success')
      onChanged?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('return_reason_save_failed', 'Failed to save return reasons'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const add = async (label: string) => {
    if (!label) return
    const nextList = normalizeReturnReasonList([...presets[scope], label])
    if (nextList.length === presets[scope].length) {
      notify(tr('return_reason_exists_notice', 'That reason already exists.'), 'info')
      return
    }
    setDraft('')
    await persist({ ...presets, [scope]: nextList }, tr('return_reason_added', 'Saved return reason added.'))
  }

  const rename = async (from: string, to: string): Promise<boolean> => {
    if (to.toLocaleLowerCase() === from.toLocaleLowerCase()) return true
    setSaving(true)
    try {
      const impact = await getReturnReasonImpact({ return_scope: scope, from, to }) as { linked_records?: number; target_exists?: boolean }
      const linked = Number(impact.linked_records || 0)
      const targetNote = impact.target_exists ? ` ${tr('return_reason_merge_notice', 'The target already exists, so the presets will merge.')}` : ''
      const scopeLabel = tr(scope, scope === 'customer' ? 'Customer' : 'Supplier').toLocaleLowerCase()
      // Both answers save the rename, as on the native prompt this replaced:
      // Confirm also rewrites the matching returns, Cancel renames only the
      // saved choice. The buttons say which is which, as in Inventory.
      const replaceLinked = linked > 0 && await askToConfirm({
        title: tr('rename_reason_prompt', 'Rename saved reason'),
        message: tr('return_reason_replace_confirm_intro', '{count} live {scope} return(s) use "{from}".{targetNote}')
          .replace('{count}', String(linked))
          .replace('{scope}', scopeLabel)
          .replace('{from}', from)
          .replace('{targetNote}', targetNote),
        items: [
          { label: tr('before', 'Before'), value: from },
          { label: tr('after', 'After'), value: to },
        ],
        note: tr('return_reason_replace_confirm_note', 'Audit and stock history remain unchanged.'),
        confirmLabel: tr('reason_update_linked_too', 'Update linked records too'),
        cancelLabel: tr('reason_rename_saved_only', 'Rename saved reason only'),
      })
      const response = await replaceReturnReason({
        return_scope: scope,
        from,
        to,
        scope: replaceLinked ? 'linked' : 'presets_only',
        presets,
      }) as ReturnReasonPresetResponse
      setPresets(resolveReturnReasonPresets(response, presets))
      notify(replaceLinked
        ? tr('return_reason_updated_linked', 'Saved reason and linked returns updated.')
        : tr('return_reason_updated_only', 'Saved reason updated; existing returns were preserved.'), 'success')
      onChanged?.()
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('return_reason_rename_failed', 'Failed to rename return reason'), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  // The shared editor asks this through the confirm dialog before remove() runs.
  const removeConfirm = (value: string) => ({
    title: tr('remove', 'Remove'),
    message: tr('return_reason_remove_confirm', 'Remove "{name}" from saved choices? Existing returns keep their recorded reason.').replace('{name}', value),
    confirmLabel: tr('remove', 'Remove'),
    danger: true,
  })
  const remove = async (value: string) => {
    await persist(removeReturnReasonPreset(presets, scope, value), tr('return_reason_removed', 'Saved choice removed; existing returns were preserved.'))
  }

  const rows = useMemo(() => presets[scope].map((reason) => ({ id: reason.toLocaleLowerCase(), label: reason })), [presets, scope])

  return (
    <Modal title={tr('return_reasons_title', 'Return reasons')} onClose={onClose} size="sm" unsavedChanges={{ dirty: editorDirty }}>
      <div className="space-y-2.5">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['customer', 'supplier'] as ReturnReasonScope[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={scope === value} onClick={() => setScope(value)} className={`min-h-8 rounded-md px-2 text-xs font-semibold leading-relaxed ${scope === value ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500'}`}>
              {tr(value, value === 'customer' ? 'Customer' : 'Supplier')}
            </button>
          ))}
        </div>
        <ReasonListEditor
          items={rows}
          tr={tr}
          loading={loading}
          busy={saving}
          draft={draft}
          onDraftChange={setDraft}
          onAdd={(label) => add(label)}
          addPlaceholder={tr('new_reason_placeholder', 'Add a reusable reason')}
          onRename={(row, to) => rename(row.label, to)}
          onDelete={(row) => remove(row.label)}
          deleteConfirm={(row) => removeConfirm(row.label)}
          onDirtyChange={setEditorDirty}
          emptyText={<>{tr('no_saved_reasons', 'No saved reasons yet for this workflow.')} {tr('return_reason_free_text_note', 'Free-text entry remains available.')}</>}
        />
      </div>
      {confirmDialog}
    </Modal>
  )
}
