import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../shared/Modal.tsx'
import ReasonListEditor from '../shared/ReasonListEditor.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import {
  classifyFeeLabel,
  getFeeLabelImpact,
  getFeeLabelTypeImpact,
  getFeeLabels,
  replaceFeeLabel,
  type FeeLabelSuggestion,
  type FeeType,
} from '../../api/feesTransport.ts'
import { FEE_TYPE_OPTIONS } from './FeeForm.tsx'

type Props = {
  canEdit: () => boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
  notify: (message: string, type?: string) => void
  t: (key: string) => string | undefined
}

export default function ExpenseLabelManagerModal({ canEdit, onClose, onChanged, notify, t }: Props) {
  const [labels, setLabels] = useState<FeeLabelSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [classifying, setClassifying] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  // A failure reads in the operator's language; the server's own message, when it sent one, follows.
  const failureText = (key: string, fallback: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : ''
    return detail ? `${tr(key, fallback)}: ${detail}` : tr(key, fallback)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getFeeLabels()
      setLabels(Array.isArray(response?.labels) ? response.labels : [])
    } catch (error) {
      notify(failureText('expense_labels_load_failed', 'Failed to load expense labels', error), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { void load() }, [load])

  const rename = async (entry: FeeLabelSuggestion, to: string): Promise<boolean> => {
    if (!canEdit()) return false
    if (to.toLocaleLowerCase() === entry.label.toLocaleLowerCase()) return true
    setRenaming(entry.label)
    try {
      const impact = await getFeeLabelImpact(entry.label, to) as { linked_records?: number; target_exists?: boolean }
      if (!canEdit()) return false
      const linked = Number(impact.linked_records || 0)
      if (!(await askToConfirm({
        title: impact.target_exists ? tr('expense_label_merge_title', 'Merge expense labels?') : tr('expense_label_rename_title', 'Rename expense label?'),
        message: impact.target_exists ? tr('expense_label_merge_note', '"{name}" already exists, so these labels will merge.').replace('{name}', to) : undefined,
        items: [
          { label: tr('before', 'Before'), value: entry.label },
          { label: tr('after', 'After'), value: to },
          { label: tr('expense_label_linked_records', 'Live expense records changed'), value: linked },
        ],
        note: tr('expense_label_rename_note', 'Only exact matches are replaced. Audit history remains unchanged.'),
        confirmLabel: impact.target_exists ? tr('merge', 'Merge') : tr('rename', 'Rename'),
      }))) return false
      if (!canEdit()) return false
      await replaceFeeLabel(entry.label, to)
      if (!canEdit()) return false
      notify(impact.target_exists ? tr('expense_labels_merged', 'Expense labels merged.') : tr('expense_label_updated', 'Expense label and linked records updated.'), 'success')
      await Promise.all([load(), Promise.resolve(onChanged())])
      return true
    } catch (error) {
      notify(failureText('expense_label_update_failed', 'Failed to update expense label', error), 'error')
      return false
    } finally {
      setRenaming(null)
    }
  }

  const classify = async (entry: FeeLabelSuggestion, feeType: FeeType) => {
    if (!canEdit()) return
    if (feeType === entry.fee_type && (entry.type_counts?.length || 1) === 1) return
    setClassifying(entry.label)
    try {
      const impact = await getFeeLabelTypeImpact(entry.label)
      if (!canEdit()) return
      const linked = Number(impact.linked_records || 0)
      const typeLabel = FEE_TYPE_OPTIONS.find((option) => option.value === feeType)
      const nextLabel = typeLabel ? (t(typeLabel.labelKey) || typeLabel.fallback) : feeType
      const current = (impact.type_counts || [])
        .map((row) => `${row.uses} ${t(FEE_TYPE_OPTIONS.find((option) => option.value === row.fee_type)?.labelKey || '') || row.fee_type}`)
        .join(', ')
      if (!(await askToConfirm({
        title: tr('expense_label_classify_title', 'Change expense category?'),
        message: entry.label,
        items: [
          { label: tr('before', 'Before'), value: current || '—' },
          { label: tr('after', 'After'), value: `${linked} ${nextLabel}` },
          { label: tr('expense_label_linked_records', 'Live expense records changed'), value: linked },
        ],
        note: tr('expense_label_classify_note', 'Every exact label match is classified. The source label and audit history remain unchanged.'),
      }))) return
      if (!canEdit()) return
      const result = await classifyFeeLabel(entry.label, feeType)
      if (!canEdit()) return
      notify(tr('expense_labels_classified', '{n} expense record(s) classified as {type}.').replace('{n}', String(Number(result.changed) || 0)).replace('{type}', nextLabel), 'success')
      await Promise.all([load(), Promise.resolve(onChanged())])
    } catch (error) {
      notify(failureText('expense_label_classify_failed', 'Failed to classify expense label', error), 'error')
    } finally {
      setClassifying(null)
    }
  }

  const rows = useMemo(() => labels.map((entry) => ({
    ...entry,
    id: entry.label.toLocaleLowerCase(),
    meta: `${entry.uses} ${tr('records', 'records')}${entry.type_counts && entry.type_counts.length > 1 ? ` · ${tr('mixed_categories', 'mixed categories')}` : ''}`,
  })), [labels, tr])

  // Labels come from expense records, so there is no add row and no delete:
  // a label disappears when no record uses it.
  return (
    <Modal title={tr('manage_expense_labels', 'Expense labels')} onClose={onClose} size="sm" unsavedChanges={{ dirty: renaming !== null || editorDirty }}>
      <ReasonListEditor
        items={rows}
        tr={tr}
        loading={loading}
        busy={renaming !== null || classifying !== null}
        onRename={(entry, to) => rename(entry, to)}
        onDirtyChange={setEditorDirty}
        emptyText={tr('no_expense_labels', 'No expense labels yet.')}
        renderExtra={(entry) => (
          <AppSelect
            value={entry.fee_type}
            ariaLabel={`${tr('fee_type', 'Type')}: ${entry.label}`}
            buttonClassName="h-8 w-[7.5rem] px-2 py-0 text-xs"
            options={FEE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) || option.fallback }))}
            onChange={(value) => void classify(entry, value as FeeType)}
            disabled={classifying !== null || renaming !== null}
          />
        )}
      />
      {confirmDialog}
    </Modal>
  )
}
