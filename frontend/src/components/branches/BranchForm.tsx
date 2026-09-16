import { useEffect, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import { useFormDirty } from '../../utils/formDirty.ts'
import {
  clearWorkDraft,
  flushPendingWorkDraft,
  readWorkDraft,
  scheduleWorkDraftWrite,
  scopedWorkDraftKey,
} from '../../utils/workDrafts.ts'
import { useModalClose } from '../shared/modalCloseContext.ts'

// S4-21: the registry key for this form's unsaved work. Exported so the
// modal hosting the form asks about the SAME entry the form registers --
// two hand-written literals would drift and the ✕ would stop guarding.
export function branchFormWorkKey(branchId?: string | number | null): string {
  return `branch-form-${branchId ?? 'new'}`
}

export function branchFormDraftBaseKey(branchId?: string | number | null): string {
  return `branch_${branchId ?? 'new'}`
}

type BranchFlag = 0 | 1

interface BranchRecord {
  id?: string | number
  name?: string | null
  location?: string | null
  phone?: string | null
  manager?: string | null
  notes?: string | null
  is_default?: BranchFlag | boolean | null
  is_active?: BranchFlag | boolean | null
  updated_at?: string | null
}

interface BranchFormState {
  name: string
  location: string
  phone: string
  manager: string
  notes: string
  is_default: BranchFlag | boolean
  is_active: BranchFlag | boolean
}

interface BranchFormProps {
  branch: BranchRecord
  onSave: (form: BranchFormState) => Promise<void> | void
  onClose: () => void
}

const useApp = useAppHook as () => {
  t: (key: string) => string | undefined
}

function initialBranchForm(branch: BranchRecord): BranchFormState {
  return {
    name: branch?.name || '',
    location: branch?.location || '',
    phone: branch?.phone || '',
    manager: branch?.manager || '',
    notes: branch?.notes || '',
    is_default: branch?.is_default || 0,
    is_active: branch?.is_active ?? 1,
  }
}

function restoreBranchForm(base: BranchFormState, draft?: Partial<BranchFormState> | null): BranchFormState {
  if (!draft || typeof draft !== 'object') return base
  return {
    // Identity fields are fixed. Old saved drafts may still contain editable
    // name/active values, so discard those fields while restoring metadata.
    name: base.name,
    location: typeof draft.location === 'string' ? draft.location : base.location,
    phone: typeof draft.phone === 'string' ? draft.phone : base.phone,
    manager: typeof draft.manager === 'string' ? draft.manager : base.manager,
    notes: typeof draft.notes === 'string' ? draft.notes : base.notes,
    is_default: typeof draft.is_default === 'boolean' || draft.is_default === 0 || draft.is_default === 1
      ? draft.is_default
      : base.is_default,
    is_active: base.is_active,
  }
}

export default function BranchForm({ branch, onSave, onClose }: BranchFormProps) {
  const { t } = useApp()
  const draftKey = scopedWorkDraftKey(branchFormDraftBaseKey(branch.id))
  const restoredDraftRef = useRef<ReturnType<typeof readWorkDraft<Partial<BranchFormState>>> | undefined>(undefined)
  if (restoredDraftRef.current === undefined) {
    restoredDraftRef.current = readWorkDraft<Partial<BranchFormState>>(draftKey, {
      notOlderThanMs: branch.updated_at ? Date.parse(branch.updated_at) || 0 : 0,
    })
  }
  const [form, setForm] = useState<BranchFormState>(() => restoreBranchForm(
    initialBranchForm(branch),
    restoredDraftRef.current?.data,
  ))
  const [saving, setSaving] = useState(false)

  // S4-21: one declaration, five consumers -- the ✕ on the modal above,
  // the navigation-away guard, beforeunload, the sidebar dot and the
  // app-update gate. `saved` latches so a completed save is not still
  // reported as work at risk while the host unmounts the form.
  const { dirty } = useFormDirty(form, String(branch.id))
  const savedRef = useRef(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = (dirty || !!restoredDraftRef.current) && !savedRef.current
  const requestClose = useModalClose(onClose)
  useEffect(() => registerDirtyWork({
    key: branchFormWorkKey(branch.id),
    pageId: 'branches',
    label: `${t('branch') || 'Branch'}${branch.name ? ` — ${branch.name}` : ''}`,
    isDirty: () => dirtyRef.current,
    // No save hook: saving runs required-name validation, which would
    // surface an error on a page the operator is trying to leave.
    discard: () => clearWorkDraft(draftKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [branch.id, branch.name, draftKey, t])

  useEffect(() => () => {
    // This cleanup is declared before the writer cleanup so a minimize or
    // guarded navigation flushes the last typed value before unmount.
    flushPendingWorkDraft(draftKey)
  }, [draftKey])

  useEffect(() => {
    if (!dirtyRef.current) return
    return scheduleWorkDraftWrite(draftKey, form)
  }, [draftKey, form])

  const set = <Key extends keyof BranchFormState>(key: Key, value: BranchFormState[Key]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      await onSave(form)
      // Saved for real: nothing is at risk any more, so the close below
      // must not raise the discard prompt (the classic save-then-prompt
      // bug). Latched before onClose, never after.
      savedRef.current = true
      dirtyRef.current = false
      restoredDraftRef.current = null
      clearWorkDraft(draftKey)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <div>
        <label htmlFor="branch-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('branch_name') || 'Branch Name'} *
        </label>
        <input
          id="branch-name"
          name="branch_name"
          className="input"
          value={form.name}
          readOnly
          aria-readonly="true"
          autoComplete="organization"
        />
      </div>

      <div>
        <label htmlFor="branch-location" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('location') || 'Location'} / {t('address') || 'Address'}
        </label>
        <input
          id="branch-location"
          name="branch_location"
          className="input"
          value={form.location}
          onChange={(event) => set('location', event.target.value)}
          placeholder={t('location_placeholder') || 'e.g. 123 Main St, Phnom Penh'}
          autoComplete="street-address"
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="branch-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('phone') || 'Phone'}
          </label>
          <input
            id="branch-phone"
            name="branch_phone"
            className="input"
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
            placeholder={t('branch_phone_placeholder') || '012 345 678'}
            autoComplete="tel"
          />
        </div>

        <div>
          <label htmlFor="branch-manager" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('manager') || 'Manager'}
          </label>
          <input
            id="branch-manager"
            name="branch_manager"
            className="input"
            value={form.manager}
            onChange={(event) => set('manager', event.target.value)}
            placeholder={t('manager_placeholder') || 'Manager name'}
            autoComplete="name"
          />
        </div>
      </div>

      <div>
        <label htmlFor="branch-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('notes') || 'Notes'}
        </label>
        <textarea
          id="branch-notes"
          name="branch_notes"
          className="input resize-none"
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder={t('notes_placeholder') || 'Any notes...'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/20">
          <input
            id="branch-default"
            name="branch_default"
            aria-label="Set branch as default"
            type="checkbox"
            checked={!!form.is_default}
            onChange={(event) => set('is_default', event.target.checked ? 1 : 0)}
            className="h-4 w-4"
          />
          <div className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('set_default')}</div>
        </label>

      </div>

      {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx's own
          fix. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
        <button className="btn-primary flex-1" type="submit" disabled={saving}>
          {saving ? t('saving') : (t('save_branch') || 'Save Branch')}
        </button>
        {/* Cancel is a dismissal too, so it goes through the modal's guard
            rather than straight to onClose -- S4-21. */}
        <button className="btn-secondary" type="button" onClick={requestClose}>
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}
