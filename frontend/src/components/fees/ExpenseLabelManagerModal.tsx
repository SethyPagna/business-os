import { useCallback, useEffect, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Modal from '../shared/Modal.tsx'
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
  onClose: () => void
  onChanged: () => void | Promise<void>
  notify: (message: string, type?: string) => void
  t: (key: string) => string | undefined
}

export default function ExpenseLabelManagerModal({ onClose, onChanged, notify, t }: Props) {
  const [labels, setLabels] = useState<FeeLabelSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [classifying, setClassifying] = useState<string | null>(null)
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getFeeLabels()
      setLabels(Array.isArray(response?.labels) ? response.labels : [])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to load expense labels', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { void load() }, [load])

  const rename = async (entry: FeeLabelSuggestion) => {
    const to = window.prompt(tr('rename_expense_label', 'Rename or merge expense label'), entry.label)?.trim().replace(/\s+/g, ' ')
    if (!to || to.toLocaleLowerCase() === entry.label.toLocaleLowerCase()) return
    setRenaming(entry.label)
    try {
      const impact = await getFeeLabelImpact(entry.label, to) as { linked_records?: number; target_exists?: boolean }
      const linked = Number(impact.linked_records || 0)
      const mergeNote = impact.target_exists ? ` "${to}" already exists, so these labels will merge.` : ''
      if (!window.confirm(
        `${linked} live expense record${linked === 1 ? '' : 's'} use "${entry.label}".${mergeNote}\n\nReplace only those exact matches with "${to}"? Audit history remains unchanged.`,
      )) return
      await replaceFeeLabel(entry.label, to)
      notify(impact.target_exists ? 'Expense labels merged.' : 'Expense label and linked records updated.', 'success')
      await Promise.all([load(), Promise.resolve(onChanged())])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to update expense label', 'error')
    } finally {
      setRenaming(null)
    }
  }

  const classify = async (entry: FeeLabelSuggestion, feeType: FeeType) => {
    if (feeType === entry.fee_type && (entry.type_counts?.length || 1) === 1) return
    setClassifying(entry.label)
    try {
      const impact = await getFeeLabelTypeImpact(entry.label)
      const linked = Number(impact.linked_records || 0)
      const typeLabel = FEE_TYPE_OPTIONS.find((option) => option.value === feeType)
      const nextLabel = typeLabel ? (t(typeLabel.labelKey) || typeLabel.fallback) : feeType
      const current = (impact.type_counts || [])
        .map((row) => `${row.uses} ${t(FEE_TYPE_OPTIONS.find((option) => option.value === row.fee_type)?.labelKey || '') || row.fee_type}`)
        .join(', ')
      if (!window.confirm(
        `${linked} live expense record${linked === 1 ? '' : 's'} use "${entry.label}"${current ? ` (${current})` : ''}.\n\nClassify every exact label match as ${nextLabel}? The source label and audit history remain unchanged.`,
      )) return
      const result = await classifyFeeLabel(entry.label, feeType)
      notify(`${Number(result.changed) || 0} expense record${Number(result.changed) === 1 ? '' : 's'} classified as ${nextLabel}.`, 'success')
      await Promise.all([load(), Promise.resolve(onChanged())])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to classify expense label', 'error')
    } finally {
      setClassifying(null)
    }
  }

  return (
    <Modal title={tr('manage_expense_labels', 'Expense labels')} onClose={onClose} size="sm" unsavedChanges={{ dirty: renaming !== null }}>
      <div className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">{tr('expense_labels_help', 'Labels come from expense records. Preview exact linked records before renaming, merging, or changing their category.')}</p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {loading ? <div className="py-8 text-center text-sm text-slate-400">{tr('loading', 'Loading…')}</div> : labels.length ? labels.map((entry) => (
            <div key={entry.label.toLocaleLowerCase()} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(7rem,8.5rem)_1.75rem] items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{entry.label}</div>
                <div className="truncate text-[11px] text-slate-400">{entry.uses} {tr('records', 'records')}{entry.type_counts && entry.type_counts.length > 1 ? ` · ${tr('mixed_categories', 'mixed categories')}` : ''}</div>
              </div>
              <AppSelect
                value={entry.fee_type}
                ariaLabel={`${tr('fee_type', 'Type')}: ${entry.label}`}
                buttonClassName="h-7 w-full px-2 py-0 text-xs"
                options={FEE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) || option.fallback }))}
                onChange={(value) => void classify(entry, value as FeeType)}
                disabled={classifying !== null || renaming !== null}
              />
              <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950" onClick={() => void rename(entry)} disabled={renaming !== null || classifying !== null} aria-label={`${tr('rename', 'Rename')} ${entry.label}`} title={tr('preview_and_replace', 'Preview and replace')}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )) : <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-700">{tr('no_expense_labels', 'No expense labels yet.')}</div>}
        </div>
      </div>
    </Modal>
  )
}
