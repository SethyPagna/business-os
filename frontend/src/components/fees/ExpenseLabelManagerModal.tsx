import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Archive from 'lucide-react/dist/esm/icons/archive.js'
import ArchiveRestore from 'lucide-react/dist/esm/icons/archive-restore.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Modal from '../shared/Modal.tsx'
import ReasonListEditor from '../shared/ReasonListEditor.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import {
  addFeeLabel,
  classifyFeeLabel,
  feeTypeChoices,
  getFeeLabelImpact,
  getFeeLabelTypeImpact,
  getFeeLabels,
  getFeeTypes,
  replaceFeeLabel,
  setFeeLabelArchived,
  type FeeLabelSuggestion,
  type FeeType,
  type FeeTypeEntry,
} from '../../api/feesTransport.ts'
import { feeTypeDisplayName } from './FeeForm.tsx'
import ExpenseTypesSection from './ExpenseTypesSection.tsx'
import { catalogFailureText } from './expenseCatalogErrors.ts'

const EntityRecordsFloat = lazyRetry(() => import('../shared/EntityRecordsFloat.tsx'), 'expense-catalog-records-float')

type Props = {
  canEdit: () => boolean
  onClose: () => void
  onChanged: () => void | Promise<void>
  notify: (message: string, type?: string) => void
  t: (key: string) => string | undefined
  /** The viewer may read the audit trail (audit_log at the full tier), so a registered label or type offers its Records. */
  canViewRecords?: boolean
  fmtUSD?: (value: number | string) => string
  fmtKHR?: (value: number | string) => string
}

type Tab = 'labels' | 'types'
// A list row is the label as the Worker sent it, keyed by its lower-cased text (the catalog id is not the list key).
type LabelEntry = Omit<FeeLabelSuggestion, 'id'>

// Labels and types of an expense, managed in two sections of one dialog. A label is added here (or by typing it on an expense),
// renamed or merged, given a default type, and archived; a type is added, renamed and archived. Nothing is deleted.
export default function ExpenseLabelManagerModal({ canEdit, onClose, onChanged, notify, t, canViewRecords = false, fmtUSD = String, fmtKHR = String }: Props) {
  const [tab, setTab] = useState<Tab>('labels')
  // The history of one label or type: the audit rows of that catalog row (acts on it, rename, archive), the same rows as the Audit Log page.
  const [records, setRecords] = useState<{ entity: 'fee_label' | 'fee_type'; id: number; subject: string } | null>(null)
  const [typesOpened, setTypesOpened] = useState(false)
  const [labels, setLabels] = useState<FeeLabelSuggestion[]>([])
  const [types, setTypes] = useState<FeeTypeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [classifying, setClassifying] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editorDirty, setEditorDirty] = useState(false)
  const [typesDirty, setTypesDirty] = useState(false)
  const tr = useCallback((key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [labelResponse, typeResponse] = await Promise.all([
        getFeeLabels({ includeArchived: true }),
        getFeeTypes().catch(() => null),
      ])
      setLabels(Array.isArray(labelResponse?.labels) ? labelResponse.labels : [])
      if (Array.isArray(typeResponse?.types)) setTypes(typeResponse.types)
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_labels_load_failed', 'Could not load expense labels'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify, tr])

  useEffect(() => { void load() }, [load])

  const addLabel = async (label: string) => {
    if (!canEdit()) return
    setAdding(true)
    try {
      await addFeeLabel(label)
      if (!canEdit()) return
      notify(tr('expense_label_added', 'Expense label added.'), 'success')
      setDraft('')
      await Promise.all([load(), Promise.resolve(onChanged())])
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_label_add_failed', 'Could not add the expense label'), 'error')
    } finally {
      setAdding(false)
    }
  }

  const rename = async (entry: LabelEntry, to: string): Promise<boolean> => {
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
      notify(catalogFailureText(error, tr, 'expense_label_update_failed', 'Could not update the expense label'), 'error')
      return false
    } finally {
      setRenaming(null)
    }
  }

  const classify = async (entry: LabelEntry, feeType: FeeType) => {
    if (!canEdit()) return
    if (feeType === entry.fee_type && (entry.type_counts?.length || 1) === 1) return
    setClassifying(entry.label)
    try {
      const impact = await getFeeLabelTypeImpact(entry.label)
      if (!canEdit()) return
      const linked = Number(impact.linked_records || 0)
      const nextLabel = feeTypeDisplayName(feeType, t)
      const current = (impact.type_counts || [])
        .map((row) => `${row.uses} ${feeTypeDisplayName(row.fee_type, t)}`)
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
      notify(catalogFailureText(error, tr, 'expense_label_classify_failed', 'Could not classify the expense label'), 'error')
    } finally {
      setClassifying(null)
    }
  }

  const setArchived = async (entry: LabelEntry, archived: boolean) => {
    if (!canEdit()) return
    setArchiving(entry.label)
    try {
      if (archived) {
        if (!(await askToConfirm({
          title: tr('expense_label_archive_title', 'Archive expense label?'),
          message: entry.label,
          items: [{ label: tr('expense_uses_it', 'Expenses using it'), value: entry.uses }],
          note: tr('expense_archive_note', 'Hidden from the choices for new expenses. Existing expenses keep it, and you can restore it any time.'),
          confirmLabel: tr('expense_archive', 'Archive'),
        }))) return
        if (!canEdit()) return
      }
      await setFeeLabelArchived(entry.label, archived)
      if (!canEdit()) return
      notify(archived ? tr('expense_label_archived', 'Expense label archived.') : tr('expense_label_restored', 'Expense label restored.'), 'success')
      await Promise.all([load(), Promise.resolve(onChanged())])
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_label_archive_failed', 'Could not change the expense label'), 'error')
    } finally {
      setArchiving(null)
    }
  }

  // Types changed in the other section: the selects here must offer the new list, and the page behind refreshes.
  const onTypesChanged = useCallback(async () => {
    try {
      const response = await getFeeTypes()
      if (Array.isArray(response?.types)) setTypes(response.types)
    } catch { /* the selects keep the last list */ }
    await Promise.resolve(onChanged())
  }, [onChanged])

  const rows = useMemo(() => {
    const mapped = labels.map((entry) => ({
      ...entry,
      id: entry.label.toLocaleLowerCase(),
      catalogId: entry.id,
      muted: entry.archived === true,
      meta: [
        `${entry.uses} ${tr('records', 'records')}`,
        entry.type_counts && entry.type_counts.length > 1 ? tr('mixed_categories', 'mixed categories') : null,
        entry.archived ? tr('expense_archived_tag', 'Archived') : null,
      ].filter(Boolean).join(' · '),
    }))
    return [...mapped.filter((row) => !row.muted), ...mapped.filter((row) => row.muted)]
  }, [labels, tr])

  const busy = renaming !== null || classifying !== null || archiving !== null || adding
  const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800'
  const tabs: Array<[Tab, string]> = [['labels', tr('labels', 'Labels')], ['types', tr('expense_tab_types', 'Types')]]

  return (
    <Modal title={tr('manage_expense_labels', 'Expense labels and types')} onClose={onClose} size="sm" unsavedChanges={{ dirty: renaming !== null || editorDirty || typesDirty }}>
      <div className="space-y-2.5">
        <div role="tablist" aria-label={tr('manage_expense_labels', 'Expense labels and types')} className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {tabs.map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-expense-catalog-tab={id}
              onClick={() => { setTab(id); if (id === 'types') setTypesOpened(true) }}
              className={`min-h-8 min-w-0 rounded-md px-1 text-xs font-semibold leading-relaxed ${tab === id ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {text}
            </button>
          ))}
        </div>
        {/* Both sections stay mounted so text typed in one survives a look at the other. */}
        <div hidden={tab !== 'labels'}>
          <ReasonListEditor
            items={rows}
            tr={tr}
            loading={loading}
            busy={busy}
            draft={draft}
            onDraftChange={setDraft}
            onAdd={addLabel}
            addPlaceholder={tr('expense_label_add_placeholder', 'Add a label')}
            canRename={(entry) => entry.archived !== true}
            onRename={(entry, to) => rename(entry, to)}
            onDirtyChange={setEditorDirty}
            emptyText={tr('no_expense_labels', 'No expense labels yet.')}
            renderExtra={(entry) => (
              <>
                {canViewRecords && entry.catalogId != null ? (
                  <button
                    type="button"
                    className={iconButton}
                    data-expense-records="label"
                    onClick={() => setRecords({ entity: 'fee_label', id: entry.catalogId as number, subject: entry.label })}
                    aria-label={`${tr('field_history', 'Records')} ${entry.label}`}
                    title={tr('field_history', 'Records')}
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                <AppSelect
                  value={entry.fee_type}
                  ariaLabel={`${tr('fee_type', 'Type')}: ${entry.label}`}
                  buttonClassName="h-8 w-[7.5rem] px-2 py-0 text-xs"
                  options={feeTypeChoices(types, entry.fee_type).map((option) => ({ value: option.value, label: feeTypeDisplayName(option.value, t) }))}
                  onChange={(value) => void classify(entry, value as FeeType)}
                  disabled={busy || entry.archived === true}
                />
                <button
                  type="button"
                  className={iconButton}
                  disabled={busy}
                  onClick={() => void setArchived(entry, entry.archived !== true)}
                  aria-label={`${entry.archived ? tr('restore', 'Restore') : tr('expense_archive', 'Archive')} ${entry.label}`}
                  title={entry.archived ? tr('restore', 'Restore') : tr('expense_archive', 'Archive')}
                >
                  {entry.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </>
            )}
          />
        </div>
        {/* The Types section reads the usage count of every type, so it loads on the first look and stays mounted after. */}
        {typesOpened ? (
          <div hidden={tab !== 'types'}>
            <ExpenseTypesSection
              canEdit={canEdit}
              askToConfirm={askToConfirm}
              notify={notify}
              tr={tr}
              t={t}
              onChanged={onTypesChanged}
              onDirtyChange={setTypesDirty}
              canViewRecords={canViewRecords}
              onOpenRecords={setRecords}
            />
          </div>
        ) : null}
      </div>
      {confirmDialog}
      {records ? (
        <Suspense fallback={null}>
          <EntityRecordsFloat
            entity={records.entity}
            entityId={records.id}
            subject={records.subject}
            onClose={() => setRecords(null)}
            t={(key) => t(key) || key}
            fmtUSD={fmtUSD}
            fmtKHR={fmtKHR}
          />
        </Suspense>
      ) : null}
    </Modal>
  )
}
