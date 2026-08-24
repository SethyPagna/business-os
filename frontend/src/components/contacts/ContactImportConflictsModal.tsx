import { useEffect, useMemo, useState } from 'react'
import GitMerge from 'lucide-react/dist/esm/icons/git-merge.js'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import Modal from '../shared/Modal'
import { getImportJobReview, updateImportJobDecisions } from '../../api/importJobsTransport'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

type RowDecision = { action?: string; field_overrides?: Record<string, unknown> } | null

type ReviewRow = {
  rowNumber: number
  action: string
  identifier: string | null
  existingId: number | null
  message: string | null
  warnings?: Array<{ kind: string; message: string }>
  data?: Record<string, unknown>
  decision?: RowDecision
}

interface ContactImportConflictsModalProps {
  jobId: string | number
  entityLabel: string
  t?: TranslateFn
  notify: NotifyFn
  onClose: () => void
  // Called once every conflict on this job has a resolution recorded, so
  // the caller (BackgroundImportTracker) can drop the "Resolve conflicts"
  // urgency styling without a full re-poll.
  onAllResolved?: () => void
}

type RowChoice = 'merge' | 'different' | 'delete'

// Contacts import (customers/suppliers/delivery_contacts) never creates a
// second contact sharing an existing one's exact name -- classifyContacts
// (importEngine.ts) auto-merges a name-only match into the existing record
// by default. That's the right default, but it was previously silent: the
// only way to learn it happened was reading a "row-number notation" line
// in the read-only Report modal after the fact, and there was no way at
// all to say "no, this really is a different person" short of manually
// editing the CSV and re-uploading. This modal is that missing decision
// point, reusing the same backend machinery products' own review flow
// already relies on (GET /:id/review, PATCH /:id/decisions) -- nothing
// new on the wire, just the first UI to actually drive it for contacts.
//
// Two choices per conflicting row:
//  - Merge (default, matches current behavior): leave it alone, the
//    imported row's fields fold into the existing contact.
//  - Different person: the reviewer supplies a name that isn't already
//    taken, recorded as a decision ({ action: 'force_create',
//    field_overrides: { name } }) -- classifyContacts re-matches by the
//    OVERRIDDEN name at apply time, which by construction can't collide,
//    so this can never silently create a second contact sharing a name
//    the way just flipping "force_create" alone (with the name
//    unchanged) would have.
export default function ContactImportConflictsModal({ jobId, entityLabel, t, notify, onClose, onAllResolved }: ContactImportConflictsModalProps) {
  const tr = (key: string, fallbackEn: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallbackEn
  }
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<number, RowChoice>>({})
  const [renameDrafts, setRenameDrafts] = useState<Record<number, string>>({})
  const [resolvedRows, setResolvedRows] = useState<Set<number>>(() => new Set())
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [savingBulk, setSavingBulk] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set())
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Pulls BOTH conflict kinds in one paginated request -- name_match
    // (needs a real merge/different-person/delete decision, see the full
    // per-row flow below) and membership_phone_conflict (already resolved
    // safely by classifyContacts itself -- the existing customer's phone
    // is never overwritten -- so this just needs to be visible for review,
    // not decided). Previously only name_match was ever fetched, so a
    // phone conflict on an import had nowhere to show up at all short of
    // reading the raw per-row JSON.
    getImportJobReview(jobId, { warningKind: 'name_match,membership_phone_conflict', pageSize: 200 })
      .then((result) => {
        if (cancelled) return
        const payload = (result || {}) as { rows?: ReviewRow[] }
        const loadedRows = Array.isArray(payload.rows) ? payload.rows : []
        setRows(loadedRows)
        // A row's decision (saved via PATCH /:id/decisions) used to only
        // ever live in local component state -- reopening this modal, or
        // BackgroundImportTracker remounting it, re-fetched the same rows
        // with no memory of what was already decided, so a "different
        // person"/delete choice that genuinely saved looked like it never
        // had. GET /:id/review now echoes each row's own decision back;
        // restore choices/resolved/rename state from that server truth
        // instead of assuming every row is fresh.
        const nextChoices: Record<number, RowChoice> = {}
        const nextDrafts: Record<number, string> = {}
        const nextResolved = new Set<number>()
        for (const row of loadedRows) {
          const decision = row.decision
          if (decision?.action === 'skip') {
            nextChoices[row.rowNumber] = 'delete'
            nextResolved.add(row.rowNumber)
          } else if (decision?.action === 'force_create') {
            nextChoices[row.rowNumber] = 'different'
            nextResolved.add(row.rowNumber)
            const name = decision.field_overrides?.name
            if (typeof name === 'string' && name) nextDrafts[row.rowNumber] = name
          }
        }
        setChoices(nextChoices)
        setRenameDrafts(nextDrafts)
        setResolvedRows(nextResolved)
        setSelectedRows(new Set())
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : tr('contacts_import_conflicts_load_failed', 'Could not load name conflicts for this import'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const nameMatchWarning = (row: ReviewRow) => (row.warnings || []).find((w) => w.kind === 'name_match') || null
  const phoneConflictWarning = (row: ReviewRow) => (row.warnings || []).find((w) => w.kind === 'membership_phone_conflict') || null
  // Grouped by conflict type per row, matching how classifyContacts
  // itself distinguishes them: a row with a name_match keeps the full
  // merge/different/delete flow below (name conflicts are the only kind
  // that changes what gets written), even if it also happens to carry a
  // phone-conflict warning -- that message still shows alongside it. A
  // row with ONLY a phone conflict gets its own lighter, read-only-style
  // group underneath, since there's nothing to decide (see comment above
  // the fetch call).
  const nameConflictRows = useMemo(() => rows.filter((row) => nameMatchWarning(row)), [rows])
  const phoneOnlyConflictRows = useMemo(() => rows.filter((row) => !nameMatchWarning(row) && phoneConflictWarning(row)), [rows])

  const suggestedRename = (name: string): string => {
    const trimmed = name.trim()
    const match = /^(.*) \((\d+)\)$/.exec(trimmed)
    if (match) return `${match[1]} (${Number(match[2]) + 1})`
    return `${trimmed} (2)`
  }

  const setChoice = (rowNumber: number, choice: RowChoice, importedName: string) => {
    setChoices((current) => ({ ...current, [rowNumber]: choice }))
    if (choice === 'different' && !renameDrafts[rowNumber]) {
      setRenameDrafts((current) => ({ ...current, [rowNumber]: suggestedRename(importedName) }))
    }
  }

  const saveMerge = async (row: ReviewRow) => {
    // Merge is the existing default -- classifyContacts already does this
    // with no decision recorded at all, so "confirm merge" just marks the
    // row resolved locally. Nothing to send.
    setResolvedRows((current) => new Set(current).add(row.rowNumber))
  }

  const saveDifferentPerson = async (row: ReviewRow) => {
    const newName = (renameDrafts[row.rowNumber] || '').trim()
    if (!newName) {
      notify(tr('contacts_import_conflict_name_required', 'Enter a name for this contact before saving'), 'error')
      return
    }
    const existingNames = new Set(rows.map((r) => String(r.data?.name || '').trim().toLowerCase()).filter(Boolean))
    if (existingNames.has(newName.toLowerCase()) && newName.toLowerCase() !== String(row.data?.name || '').trim().toLowerCase()) {
      // Only a soft heads-up against colliding with another row already
      // queued in this same review list -- the real, authoritative check
      // (against the live database, including this row's own new
      // classification) happens again server-side when the job applies.
      notify(tr('contacts_import_conflict_name_collides', 'Another row in this import is already using that name -- pick a different one'), 'error')
      return
    }
    setSavingRow(row.rowNumber)
    try {
      await updateImportJobDecisions(jobId, {
        [String(row.rowNumber)]: { action: 'force_create', field_overrides: { name: newName } },
      })
      setResolvedRows((current) => new Set(current).add(row.rowNumber))
      notify(tr('contacts_import_conflict_saved', 'Saved -- will import as a new, separate contact'), 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : tr('contacts_import_conflict_save_failed', 'Could not save this decision'), 'error')
    } finally {
      setSavingRow(null)
    }
  }

  const saveDelete = async (row: ReviewRow) => {
    setSavingRow(row.rowNumber)
    try {
      await updateImportJobDecisions(jobId, {
        [String(row.rowNumber)]: { action: 'skip' },
      })
      setResolvedRows((current) => new Set(current).add(row.rowNumber))
      notify(tr('contacts_import_conflict_deleted', 'Saved -- this row will be skipped, nothing will be imported for it'), 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : tr('contacts_import_conflict_save_failed', 'Could not save this decision'), 'error')
    } finally {
      setSavingRow(null)
    }
  }

  const handleSave = (row: ReviewRow) => {
    const choice = choices[row.rowNumber] || 'merge'
    if (choice === 'different') void saveDifferentPerson(row)
    else if (choice === 'delete') void saveDelete(row)
    else void saveMerge(row)
  }

  const toggleSelected = (rowNumber: number) => {
    setSelectedRows((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  const toggleExpanded = (rowNumber: number) => {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  // Bulk select/merge/delete/different only ever operate on name
  // conflicts -- phone-only rows have a single "Acknowledge" action (see
  // acknowledgePhoneConflict below), not a decision to bulk-apply.
  const unresolvedRows = useMemo(() => nameConflictRows.filter((row) => !resolvedRows.has(row.rowNumber)), [nameConflictRows, resolvedRows])
  const allUnresolvedSelected = unresolvedRows.length > 0 && unresolvedRows.every((row) => selectedRows.has(row.rowNumber))

  const toggleSelectAll = () => {
    if (allUnresolvedSelected) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(unresolvedRows.map((row) => row.rowNumber)))
    }
  }

  // Phone conflicts never change what gets written (classifyContacts
  // already pins/flags safely either way), so there's nothing to send --
  // this just marks the row reviewed, same as merge does for name
  // conflicts above.
  const acknowledgePhoneConflict = (rowNumber: number) => {
    setResolvedRows((current) => new Set(current).add(rowNumber))
  }

  // Bulk "same person -- merge": merge never records a decision (see
  // saveMerge above), so this is purely local -- but doing it for every
  // selected row in one click, instead of one Save click per row, is the
  // whole point of adding selection here.
  const bulkMerge = () => {
    setResolvedRows((current) => {
      const next = new Set(current)
      selectedRows.forEach((rowNumber) => next.add(rowNumber))
      return next
    })
    setSelectedRows(new Set())
  }

  // Bulk "delete/skip selected" and bulk "keep separate selected" both hit
  // PATCH /:id/decisions exactly once for the whole selection (it already
  // accepts a decisions map keyed by row number and merges it into
  // policy_json in one write) instead of one request per row.
  const bulkSave = async (choice: 'delete' | 'different') => {
    const targetRows = rows.filter((row) => selectedRows.has(row.rowNumber) && !resolvedRows.has(row.rowNumber))
    if (!targetRows.length) return
    setSavingBulk(true)
    try {
      const decisions: Record<string, { action: string; field_overrides?: Record<string, unknown> }> = {}
      for (const row of targetRows) {
        if (choice === 'delete') {
          decisions[String(row.rowNumber)] = { action: 'skip' }
        } else {
          const importedName = String(row.data?.name || '')
          const newName = (renameDrafts[row.rowNumber] || suggestedRename(importedName)).trim()
          decisions[String(row.rowNumber)] = { action: 'force_create', field_overrides: { name: newName } }
        }
      }
      await updateImportJobDecisions(jobId, decisions)
      setResolvedRows((current) => {
        const next = new Set(current)
        targetRows.forEach((row) => next.add(row.rowNumber))
        return next
      })
      setChoices((current) => {
        const next = { ...current }
        targetRows.forEach((row) => { next[row.rowNumber] = choice })
        return next
      })
      setSelectedRows(new Set())
      notify(
        choice === 'delete'
          ? tr('contacts_import_conflict_bulk_deleted', 'Saved -- selected rows will be skipped')
          : tr('contacts_import_conflict_bulk_different', 'Saved -- selected rows will import as new, separate contacts'),
        'success',
      )
    } catch (err) {
      notify(err instanceof Error ? err.message : tr('contacts_import_conflict_save_failed', 'Could not save this decision'), 'error')
    } finally {
      setSavingBulk(false)
    }
  }

  const unresolvedCount = rows.filter((row) => !resolvedRows.has(row.rowNumber)).length

  useEffect(() => {
    if (!loading && rows.length > 0 && unresolvedCount === 0) onAllResolved?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, unresolvedCount, rows.length])

  return (
    <Modal title={tr('contacts_import_conflicts_title', 'Resolve name conflicts').replace('{type}', entityLabel)} onClose={onClose} size="lg" draggable>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr(
            'contacts_import_conflicts_intro',
            'Each row below has the same name as an existing contact. By default it will merge into that contact. If it\'s actually a different person, give it a name that\'s not already in use.',
          )}
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {tr('loading', 'Loading...')}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/10 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            {tr('contacts_import_no_conflicts', 'No name or phone conflicts on this import.')}
          </div>
        ) : (
          <>
            {nameConflictRows.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {tr('contacts_import_conflicts_group_name', 'Name conflicts')}
                </p>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/60">
                  <label className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={allUnresolvedSelected} onChange={toggleSelectAll} disabled={unresolvedRows.length === 0} />
                    {tr('select_all', 'Select all')}
                  </label>
                  <span className="text-gray-400 dark:text-gray-500">
                    {selectedRows.size > 0 ? tr('contacts_import_conflicts_selected', '{count} selected').replace('{count}', String(selectedRows.size)) : ''}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button type="button" disabled={!selectedRows.size || savingBulk} onClick={bulkMerge} className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50">
                      <GitMerge className="mr-1 inline h-3.5 w-3.5" />
                      {tr('contacts_import_conflict_bulk_merge_action', 'Merge selected')}
                    </button>
                    <button type="button" disabled={!selectedRows.size || savingBulk} onClick={() => bulkSave('different')} className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50">
                      <UserPlus className="mr-1 inline h-3.5 w-3.5" />
                      {tr('contacts_import_conflict_bulk_different_action', 'Keep separate selected')}
                    </button>
                    <button type="button" disabled={!selectedRows.size || savingBulk} onClick={() => bulkSave('delete')} className="btn-secondary px-2.5 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400">
                      <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                      {savingBulk ? tr('saving', 'Saving...') : tr('contacts_import_conflict_bulk_delete_action', 'Delete selected')}
                    </button>
                  </div>
                </div>

                <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {nameConflictRows.map((row) => {
                const warning = nameMatchWarning(row)
                const phoneWarning = phoneConflictWarning(row)
                const importedName = String(row.data?.name || '')
                const importedPhone = String(row.data?.phone || '')
                const isResolved = resolvedRows.has(row.rowNumber)
                const choice = choices[row.rowNumber] || 'merge'
                const isSelected = selectedRows.has(row.rowNumber)
                const isExpanded = expandedRows.has(row.rowNumber)
                const detailEntries = Object.entries(row.data || {}).filter(([key]) => !key.startsWith('_'))
                return (
                  <div
                    key={row.rowNumber}
                    className={`rounded-xl border p-3 text-sm ${isResolved ? 'border-green-200 bg-green-50/60 dark:border-green-900/40 dark:bg-green-900/10' : 'border-gray-200 dark:border-zinc-700'}`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                        {!isResolved ? (
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(row.rowNumber)} />
                        ) : null}
                        {tr('row', 'Row')} {row.rowNumber} -- {importedName}
                        {importedPhone ? <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">({importedPhone})</span> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => toggleExpanded(row.rowNumber)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {tr('contacts_import_conflict_view_details', 'Details')}
                        </button>
                        {isResolved ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {choice === 'delete' ? tr('deleted', 'Deleted') : tr('resolved', 'Resolved')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{warning?.message || row.message}</p>
                    {phoneWarning ? (
                      <p className="-mt-2 mb-3 text-xs text-amber-600 dark:text-amber-400">{phoneWarning.message}</p>
                    ) : null}

                    {isExpanded ? (
                      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-2 text-xs dark:bg-zinc-800/60">
                        {detailEntries.map(([key, value]) => (
                          <div key={key} className="truncate">
                            <span className="text-gray-400 dark:text-gray-500">{key}: </span>
                            <span className="text-gray-700 dark:text-gray-200">{String(value ?? '')}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mb-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setChoice(row.rowNumber, 'merge', importedName)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          choice === 'merge'
                            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        {tr('contacts_import_conflict_merge_action', 'Same person -- merge')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChoice(row.rowNumber, 'different', importedName)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          choice === 'different'
                            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {tr('contacts_import_conflict_different_action', 'Different person -- keep separate')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setChoice(row.rowNumber, 'delete', importedName)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          choice === 'delete'
                            ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {tr('contacts_import_conflict_delete_action', "Don't import this row")}
                      </button>
                    </div>

                    {choice === 'different' ? (
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          type="text"
                          value={renameDrafts[row.rowNumber] ?? suggestedRename(importedName)}
                          onChange={(e) => setRenameDrafts((current) => ({ ...current, [row.rowNumber]: e.target.value }))}
                          placeholder={tr('contacts_import_conflict_new_name_placeholder', 'New, distinct name')}
                          className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={isResolved || savingRow === row.rowNumber}
                      onClick={() => handleSave(row)}
                      className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
                    >
                      {savingRow === row.rowNumber ? tr('saving', 'Saving...') : isResolved ? tr('saved', 'Saved') : tr('save', 'Save')}
                    </button>
                  </div>
                )
              })}
                </div>
              </>
            ) : null}

            {phoneOnlyConflictRows.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {tr('contacts_import_conflicts_group_phone', 'Phone conflicts')}
                </p>
                <div className="max-h-[16rem] space-y-2 overflow-y-auto pr-1">
                  {phoneOnlyConflictRows.map((row) => {
                    const warning = phoneConflictWarning(row)
                    const importedName = String(row.data?.name || '')
                    const importedPhone = String(row.data?.phone || '')
                    const isResolved = resolvedRows.has(row.rowNumber)
                    return (
                      <div
                        key={row.rowNumber}
                        className={`rounded-xl border p-3 text-sm ${isResolved ? 'border-green-200 bg-green-50/60 dark:border-green-900/40 dark:bg-green-900/10' : 'border-gray-200 dark:border-zinc-700'}`}
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {tr('row', 'Row')} {row.rowNumber} -- {importedName}
                            {importedPhone ? <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">({importedPhone})</span> : null}
                          </div>
                          {isResolved ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {tr('acknowledged', 'Acknowledged')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => acknowledgePhoneConflict(row.rowNumber)}
                              className="btn-secondary px-2.5 py-1 text-xs"
                            >
                              {tr('contacts_import_conflict_acknowledge_action', 'Acknowledge')}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{warning?.message || row.message}</p>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : null}
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-zinc-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {rows.length > 0
              ? tr('contacts_import_conflicts_remaining', '{count} unresolved').replace('{count}', String(unresolvedCount))
              : ''}
          </span>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={onClose}>
            {tr('done', 'Done')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
