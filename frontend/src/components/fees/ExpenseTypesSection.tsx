import { useCallback, useEffect, useMemo, useState } from 'react'
import Archive from 'lucide-react/dist/esm/icons/archive.js'
import ArchiveRestore from 'lucide-react/dist/esm/icons/archive-restore.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import ReasonListEditor from '../shared/ReasonListEditor.tsx'
import type { ConfirmRequest } from '../shared/useConfirmDialog.tsx'
import { FEE_TYPE_NAME_MAX_CHARS } from '../../utils/feeTypeName.ts'
import {
  addFeeType,
  getFeeTypeImpact,
  getFeeTypes,
  renameFeeType,
  setFeeTypeArchived,
  type FeeTypeEntry,
} from '../../api/feesTransport.ts'
import { feeTypeDisplayName } from './FeeForm.tsx'
import { catalogFailureText, type CatalogTranslate } from './expenseCatalogErrors.ts'

// The Types half of the expense manager: the five built-in types (fixed, because the reports split on them) and the custom types an
// administrator adds, renames and archives. A rename rewrites the expenses of that exact type and records each one; an archive only
// hides the name from the pickers. Nothing is deleted.

type Props = {
  canEdit: () => boolean
  askToConfirm: (request: ConfirmRequest) => Promise<boolean>
  notify: (message: string, type?: string) => void
  tr: CatalogTranslate
  t: (key: string) => string | undefined
  onChanged: () => void | Promise<void>
  onDirtyChange: (dirty: boolean) => void
  /** The viewer may read the audit trail (audit_log at the full tier): a registered type then offers its Records. */
  canViewRecords?: boolean
  onOpenRecords?: (target: { entity: 'fee_type'; id: number; subject: string }) => void
}

// A list row is the type as the Worker sent it, keyed by its lower-cased name (the catalog id is not the list key).
type TypeEntry = Omit<FeeTypeEntry, 'id'>

export default function ExpenseTypesSection({ canEdit, askToConfirm, notify, tr, t, onChanged, onDirtyChange, canViewRecords = false, onOpenRecords }: Props) {
  const [types, setTypes] = useState<FeeTypeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getFeeTypes({ uses: true, includeArchived: true })
      setTypes(Array.isArray(response?.types) ? response.types : [])
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_types_load_failed', 'Could not load expense types'), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify, tr])

  useEffect(() => { void load() }, [load])

  const refresh = async () => { await Promise.all([load(), Promise.resolve(onChanged())]) }

  const add = async (name: string) => {
    if (!canEdit()) return
    if (name.length > FEE_TYPE_NAME_MAX_CHARS) {
      notify(catalogFailureText({ code: 'type_name_invalid' }, tr, 'expense_type_add_failed', 'Could not add the expense type'), 'error')
      return
    }
    setBusy(true)
    try {
      await addFeeType(name)
      if (!canEdit()) return
      notify(tr('expense_type_added', 'Expense type added.'), 'success')
      setDraft('')
      await refresh()
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_type_add_failed', 'Could not add the expense type'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const rename = async (entry: TypeEntry, to: string): Promise<boolean> => {
    if (!canEdit()) return false
    if (to === entry.name) return true
    if (to.length > FEE_TYPE_NAME_MAX_CHARS) {
      notify(catalogFailureText({ code: 'type_name_invalid' }, tr, 'expense_type_update_failed', 'Could not change the expense type'), 'error')
      return false
    }
    setBusy(true)
    try {
      const impact = await getFeeTypeImpact(entry.name)
      if (!canEdit()) return false
      if (!(await askToConfirm({
        title: tr('expense_type_rename_title', 'Rename expense type?'),
        items: [
          { label: tr('before', 'Before'), value: entry.name },
          { label: tr('after', 'After'), value: to },
          { label: tr('expense_label_linked_records', 'Live expense records changed'), value: Number(impact.linked_records || 0) },
        ],
        note: tr('expense_type_rename_note', 'Every expense of this type moves to the new name. Each one keeps a before and after entry in Records.'),
        confirmLabel: tr('rename', 'Rename'),
      }))) return false
      if (!canEdit()) return false
      await renameFeeType(entry.name, to)
      if (!canEdit()) return false
      notify(tr('expense_type_renamed', 'Expense type renamed.'), 'success')
      await refresh()
      return true
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_type_update_failed', 'Could not change the expense type'), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const setArchived = async (entry: TypeEntry, archived: boolean) => {
    if (!canEdit()) return
    setBusy(true)
    try {
      if (archived) {
        if (!(await askToConfirm({
          title: tr('expense_type_archive_title', 'Archive expense type?'),
          message: entry.name,
          items: [{ label: tr('expense_uses_it', 'Expenses using it'), value: Number(entry.uses || 0) }],
          note: tr('expense_archive_note', 'Hidden from the choices for new expenses. Existing expenses keep it, and you can restore it any time.'),
          confirmLabel: tr('expense_archive', 'Archive'),
        }))) return
        if (!canEdit()) return
      }
      await setFeeTypeArchived(entry.name, archived)
      if (!canEdit()) return
      notify(archived ? tr('expense_type_archived', 'Expense type archived.') : tr('expense_type_restored', 'Expense type restored.'), 'success')
      await refresh()
    } catch (error) {
      notify(catalogFailureText(error, tr, 'expense_type_update_failed', 'Could not change the expense type'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => {
    const mapped = types.map((entry) => ({
      ...entry,
      id: entry.name.toLocaleLowerCase(),
      catalogId: entry.id,
      label: feeTypeDisplayName(entry.name, t),
      muted: entry.archived,
      meta: [
        `${Number(entry.uses || 0)} ${tr('records', 'records')}`,
        entry.builtin ? tr('expense_type_builtin', 'Built in') : null,
        entry.archived ? tr('expense_archived_tag', 'Archived') : null,
      ].filter(Boolean).join(' · '),
    }))
    return [...mapped.filter((row) => !row.muted), ...mapped.filter((row) => row.muted)]
  }, [t, tr, types])

  const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800'

  return (
    <ReasonListEditor
      items={rows}
      tr={tr}
      loading={loading}
      busy={busy}
      draft={draft}
      onDraftChange={setDraft}
      onAdd={add}
      addPlaceholder={tr('expense_type_add_placeholder', 'Add a type')}
      canRename={(item) => item.registered && !item.builtin && !item.archived}
      onRename={(item, to) => rename(item, to)}
      onDirtyChange={onDirtyChange}
      renderExtra={(item) => (item.builtin || !item.registered ? null : (
        <>
          {canViewRecords && onOpenRecords && item.catalogId != null ? (
            <button
              type="button"
              className={iconButton}
              data-expense-records="type"
              onClick={() => onOpenRecords({ entity: 'fee_type', id: item.catalogId as number, subject: item.name })}
              aria-label={`${tr('field_history', 'Records')} ${item.name}`}
              title={tr('field_history', 'Records')}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={iconButton}
            disabled={busy}
            onClick={() => void setArchived(item, !item.archived)}
            aria-label={`${item.archived ? tr('restore', 'Restore') : tr('expense_archive', 'Archive')} ${item.name}`}
            title={item.archived ? tr('restore', 'Restore') : tr('expense_archive', 'Archive')}
          >
            {item.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </>
      ))}
    />
  )
}
