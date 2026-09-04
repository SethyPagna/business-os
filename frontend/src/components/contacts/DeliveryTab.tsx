// ?€?€ DeliveryTab ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { consumeLongPressClick, createLongPressHandlers } from '../../utils/longPress.ts'
import { columnsFromRows } from '../../utils/exportOptions.ts'
import type { ComponentProps } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import type { PortalMenuItem } from '../shared/PortalMenu'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import type { QueryParams } from '../../api/query.ts'
import { fmtDateTime24 } from '../../utils/formatters'
import Modal from '../shared/Modal'
import RenameCascadeModal, { type RenameCascadeChoice, type RenameCascadeRequest } from '../shared/RenameCascadeModal.tsx'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import FilterMenu from '../shared/FilterMenu'
import SearchInput from '../shared/SearchInput'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { ThreeDotMenu, DetailModal, ContactTable, buildSelectedSnapshots, countActiveFlags, useContactSelection } from './shared'
import { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import { useContactDuplicateFlag } from './useContactDuplicateFlag'
import DuplicateFlagBanner from './DuplicateFlagBanner'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { buildAlphabetActionSections, buildTimeActionSections, getAvailableYears, getTimeGroupingMode } from '../../utils/groupedRecords.ts'
import { buildPeriodFilterOptions } from '../../utils/periodFilterOptions.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { runConcurrentTasks } from '../../utils/bulkOps.ts'
import { fuzzyTextMatches } from '../../utils/searchMatch.ts'
import { useDebouncedValue } from '../../utils/useDebouncedValue.ts'
import {
  CONTACT_OPTION_LIMIT,
  buildContactOptionSummary,
  createContactOption,
  getPrimaryContactOption,
  parseStoredContactOptions,
  serializeContactOptions,
} from './contactOptionUtils'
import type { ContactOption } from './contactOptionUtils'

const ContactImportModal = lazyRetry(() => import('./ContactImportModal'), 'delivery-contact-import')
const DeliveryContactReportModal = lazyRetry(() => import('./DeliveryContactReportModal'), 'delivery-contact-report')
const ExportOptionsDialog = lazyRetry(() => import('../shared/ExportOptionsDialog'), 'delivery-export-options')
const DELIVERY_CONTACT_MUTATION_TIMEOUT_MS = 12000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type DeliveryModal = 'form' | 'import' | 'detail' | 'report' | null
type SortDirection = 'asc' | 'desc'
type DeliveryGroupMode = 'time' | 'alphabet'

interface AppUser {
  id?: string | number | null
  name?: string | null
}

interface AppContextValue {
  // Per-action gate (utils/permissionActions.ts) -- the same table the
  // admin permission editor renders, so a control's visibility here always
  // matches what an admin was shown when granting the tier.
  can: (permissionKey: string, actionKey: string) => boolean
  user?: AppUser | null
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string | null
    ts?: string | number | null
  } | null
}

interface DeliveryTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  // See CustomersTab.tsx's identical prop for why this exists.
  initialSearch?: string
}

interface DeliveryContact extends Record<string, unknown> {
  id: number | string
  name?: string | null
  phone?: string | null
  area?: string | null
  address?: string | null
  notes?: string | null
  gender?: string | null
  created_at?: string | null
}

interface DeliveryPayload {
  name?: string | null
  phone?: string | null
  area?: string | null
  address?: string | null
  notes?: string | null
  gender?: string | null
  userId?: string | number | null
  userName?: string | null
  confirmDuplicate?: boolean
  __rename_cascade?: 'carry' | 'record_only'
}

interface DeliveryMutationResult {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
}

interface SectionRow extends Record<string, unknown> {
  __kind: 'section'
  section: {
    id: string
    label: string
    ids: Array<number | string>
    items: DeliveryContact[]
  }
  collapsed: boolean
}

type DeliveryDisplayRow = DeliveryContact | SectionRow

interface DeliveryApi {
  getDeliveryContacts: (query?: QueryParams) => Promise<unknown>
  createDeliveryContact: (payload: DeliveryPayload) => Promise<DeliveryMutationResult | unknown>
  updateDeliveryContact: (id: number | string, payload: DeliveryPayload) => Promise<DeliveryMutationResult | unknown>
  deleteDeliveryContact: (id: number | string) => Promise<DeliveryMutationResult | unknown>
  getDeliveryContactRenameImpact: (id: number | string, to: string) => Promise<import('../../api/renameCascadeTransport.ts').RenameImpact>
}

type ActionHistoryBarHistory = ComponentProps<typeof ActionHistoryBar>['history']

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

type ContactReadTransportModule = typeof import('../../api/contactReadTransport.ts')
type ContactWriteTransportModule = typeof import('../../api/contactWriteTransport.ts')

let contactReadTransportModulePromise: Promise<ContactReadTransportModule> | null = null
let contactWriteTransportModulePromise: Promise<ContactWriteTransportModule> | null = null

function loadContactReadTransportModule(): Promise<ContactReadTransportModule> {
  if (!contactReadTransportModulePromise) contactReadTransportModulePromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportModulePromise
}

function loadContactWriteTransportModule(): Promise<ContactWriteTransportModule> {
  if (!contactWriteTransportModulePromise) contactWriteTransportModulePromise = import('../../api/contactWriteTransport.ts')
  return contactWriteTransportModulePromise
}

function getDeliveryApi(): DeliveryApi {
  return {
    getDeliveryContacts: async (query = {}) => (await loadContactReadTransportModule()).getDeliveryContacts(query),
    createDeliveryContact: async (payload) => (await loadContactWriteTransportModule()).createDeliveryContact(payload as Record<string, unknown>),
    updateDeliveryContact: async (id, payload) => (await loadContactWriteTransportModule()).updateDeliveryContact(id, payload as Record<string, unknown>),
    deleteDeliveryContact: async (id) => (await loadContactWriteTransportModule()).deleteDeliveryContact(id),
    getDeliveryContactRenameImpact: async (id, to) => (await loadContactWriteTransportModule()).getDeliveryContactRenameImpact(id, to),
  }
}

function normalizeDeliveryRows(value: unknown): DeliveryContact[] {
  if (Array.isArray(value)) return value as DeliveryContact[]
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: DeliveryContact[] }).items
  }
  return []
}

function isSectionRow(row: DeliveryDisplayRow | null | undefined): row is SectionRow {
  return row?.__kind === 'section'
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// ?€?€ Options helpers ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
// Options stored as JSON array in the 'address' TEXT column.
// Each option: { label, name, phone, area }
// Backward-compatible: old plain strings migrated to a single option.

export function parseDeliveryOptions(raw: unknown): ContactOption[] {
  return parseStoredContactOptions(raw, { legacyField: 'area' })
}

export function serializeDeliveryOptions(opts: ContactOption[]): string {
  return serializeContactOptions(opts) || ''
}

const BLANK_OPTION = () => createContactOption({ label: '', name: '', phone: '', area: '' })

// ?€?€ OptionEditor ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
interface OptionEditorProps {
  option: ContactOption
  index: number
  total: number
  onChange: (option: ContactOption) => void
  onRemove: () => void
}

function OptionEditor({ option, index, total, onChange, onRemove }: OptionEditorProps) {
  const set = (key: keyof ContactOption, value: string) => onChange({ ...option, [key]: value })
  const fieldId = (field: string) => `delivery-option-${index}-${field}`
  return (
    <div className="border border-gray-200 dark:border-zinc-600 rounded-xl p-3 space-y-2 bg-gray-50 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">#{index + 1}</span>
        <label htmlFor={fieldId('label')} className="sr-only">Delivery option label</label>
        <input
          id={fieldId('label')}
          name={fieldId('label')}
          autoComplete="off"
          className="input text-xs py-1 flex-1"
          placeholder="Label (e.g. Morning Shift, Zone A)"
          value={option.label}
          onChange={e => set('label', e.target.value)}
        />
        {total > 1 && (
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-600 text-xs px-1.5 py-1 rounded flex-shrink-0" aria-label="Remove delivery option">x</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={fieldId('name')} className="block text-xs text-gray-400 mb-0.5">Name</label>
          <input id={fieldId('name')} name={fieldId('name')} autoComplete="name" className="input text-xs py-1" placeholder="Driver / rider name" value={option.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label htmlFor={fieldId('phone')} className="block text-xs text-gray-400 mb-0.5">Phone</label>
          <input id={fieldId('phone')} name={fieldId('phone')} autoComplete="tel" className="input text-xs py-1" placeholder="Phone number" value={option.phone} onChange={e => set('phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor={fieldId('area')} className="block text-xs text-gray-400 mb-0.5">Area / Zone</label>
        <input id={fieldId('area')} name={fieldId('area')} autoComplete="off" className="input text-xs py-1" placeholder="Coverage area or zone" value={option.area} onChange={e => set('area', e.target.value)} />
      </div>
    </div>
  )
}

// ?€?€ DeliveryForm ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
interface DeliveryFormProps {
  contact?: DeliveryContact | null
  onSave: (payload: DeliveryPayload) => Promise<unknown> | unknown
  onClose: () => void
  t: TranslateFn
}

function DeliveryForm({ contact, onSave, onClose, t }: DeliveryFormProps) {
  const init: DeliveryPayload = contact ? { ...contact } : { name: '', phone: '', area: '', address: '', notes: '', gender: '' }
  const [form, setForm] = useState<DeliveryPayload>(init)
  const [options, setOptions] = useState(() => {
    const parsed = parseDeliveryOptions(init.address)
    if (parsed.length) return parsed
    return [BLANK_OPTION()]
  })
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const set = (key: keyof DeliveryPayload, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const addOption = () => setOptions((current) => {
    if (current.length >= CONTACT_OPTION_LIMIT) return current
    return [...current, BLANK_OPTION()]
  })
  const updateOption = (index: number, nextOption: ContactOption) => setOptions((current) => current.map((option, itemIndex) => (itemIndex === index ? nextOption : option)))
  const removeOption = (index: number) => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const livePrimaryOption = getPrimaryContactOption(options, {
    fallback: { name: form.name || '', phone: form.phone || '', area: form.area || '' },
  })
  const duplicateMatches = useContactDuplicateFlag(
    'delivery_contacts',
    livePrimaryOption.name || form.name || '',
    livePrimaryOption.phone || form.phone || '',
    contact?.id,
  )
  const exactMatch = duplicateMatches.find((match) => match.severity === 'exact_match')

  // Part 563: validate, then open the review dialog; commitDelivery saves on
  // confirm. The exact-duplicate window.confirm() is folded into the dialog
  // (danger note) instead of a separate native popup.
  const handleSave = () => {
    if (saving) return
    const phoneConflict = duplicateMatches.find((match) => match.severity === 'phone_conflict')
    if (phoneConflict) {
      setLocalError(`This phone number already belongs to "${phoneConflict.name}". Each phone number can only be used by one delivery contact.`)
      return
    }
    setLocalError('')
    setConfirmOpen(true)
  }

  const buildDeliveryReviewItems = (): ConfirmReviewItem[] => {
    const items: ConfirmReviewItem[] = []
    const phone = (livePrimaryOption.phone || form.phone || '').trim()
    if (phone) items.push({ label: t('phone_number') || 'Phone', value: phone })
    const area = (livePrimaryOption.area || form.area || '').trim()
    if (area) items.push({ label: t('area') || 'Area', value: area })
    return items
  }

  const commitDelivery = async () => {
    if (saving) return
    setConfirmOpen(false)
    const primaryOption = getPrimaryContactOption(options, {
      fallback: { name: form.name || '', phone: form.phone || '', area: form.area || '' },
    })
    setSaving(true)
    try {
      await Promise.resolve(onSave({
        ...form,
        name: primaryOption.name || form.name || '',
        phone: primaryOption.phone || form.phone || '',
        area: primaryOption.area || form.area || '',
        address: serializeDeliveryOptions(options),
        gender: form.gender || '',
        confirmDuplicate: !!exactMatch,
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={contact ? `Edit Delivery Contact` : `Add Delivery Contact`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="delivery-form-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('name')} <span className="text-xs font-normal text-gray-400">(driver / rider)</span>
          </label>
          <input id="delivery-form-name" name="delivery_name" autoComplete="name" className="input" value={form.name || ''} onChange={e => set('name', e.target.value)} autoFocus placeholder="Driver name" />
        </div>
        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Contact Options
              <span className="ml-1.5 text-xs font-normal text-gray-400">Up to {CONTACT_OPTION_LIMIT} riders or zones</span>
            </label>
            <button type="button" onClick={addOption} disabled={options.length >= CONTACT_OPTION_LIMIT} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-900/20">
              + Add Option
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {options.map((option, index) => (
              <OptionEditor
                key={`delivery-option-${index}`}
                option={option}
                index={index}
                total={options.length}
                onChange={(nextOption) => updateOption(index, nextOption)}
                onRemove={() => removeOption(index)}
              />
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="delivery-form-gender" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('gender') || 'Gender'}</label>
          <AppSelect
            id="delivery-form-gender"
            name="delivery_gender"
            value={form.gender || ''}
            onChange={(nextValue) => set('gender', nextValue)}
            ariaLabel={t('gender') || 'Gender'}
            className="w-full"
            buttonClassName="h-10 w-full"
            menuClassName="min-w-[10rem]"
            options={[
              { value: '', label: t('unspecified') || 'Unspecified' },
              { value: 'male', label: t('male') || 'Male' },
              { value: 'female', label: t('female') || 'Female' },
              { value: 'other', label: t('other') || 'Other' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="delivery-form-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('notes')||'Notes'}</label>
          <textarea id="delivery-form-notes" name="delivery_notes" autoComplete="off" className="input resize-none" rows={2} value={form.notes||''} onChange={e => set('notes', e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">Provide driver name or phone number.</p>

        {localError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {localError}
          </div>
        ) : null}

        <DuplicateFlagBanner matches={duplicateMatches} entityLabel="delivery contact" />

        {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx/
            CustomerFormModal.tsx's own fix. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button type="button" className="btn-primary flex-1" onClick={handleSave} disabled={saving}>{saving ? (t('saving') || 'Saving...') : t('save')}</button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t('cancel')}</button>
        </div>
      </div>
      {confirmOpen ? (
        <ConfirmDialog
          t={t}
          title={contact ? 'Edit Delivery Contact' : 'Add Delivery Contact'}
          message={(livePrimaryOption.name || form.name || '').trim()}
          items={buildDeliveryReviewItems()}
          note={exactMatch ? `"${exactMatch.name}" already has this exact name and phone number. Create a separate delivery contact anyway?` : undefined}
          danger={!!exactMatch}
          confirmLabel={t('save') || 'Save'}
          cancelLabel={t('cancel') || 'Cancel'}
          working={saving}
          workingLabel={t('saving') || 'Saving...'}
          onConfirm={commitDelivery}
          onClose={() => { if (!saving) setConfirmOpen(false) }}
        />
      ) : null}
    </Modal>
  )
}

// ?€?€ OptionsDisplay (detail view) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function OptionsDisplay({ raw }: { raw: unknown }) {
  const opts = parseDeliveryOptions(raw)
  if (!opts.length) return <span className="text-gray-400">-</span>
  return (
    <div className="space-y-1.5">
      {opts.map((o, i) => (
        <div key={i} className="text-xs bg-gray-50 dark:bg-zinc-800 rounded-lg p-2 space-y-0.5">
          {o.label && <div className="font-semibold text-gray-700 dark:text-gray-200">{o.label}</div>}
          {o.name  && <div className="text-gray-600 dark:text-gray-300">Name: {o.name}</div>}
          {o.phone && <div className="text-gray-500">Phone: {o.phone}</div>}
          {o.area  && <div className="text-gray-500">Zone: {o.area}</div>}
        </div>
      ))}
    </div>
  )
}

function OptionsBadge({ raw }: { raw: unknown }) {
  const count = parseDeliveryOptions(raw).length
  if (!count) return null
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
      {count}
    </span>
  )
}

// ?€?€ DeliveryTab ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function DeliveryTab({ t, notify, active = true, initialSearch }: DeliveryTabProps) {
  const { can, user } = useApp()
  // routes/contacts.ts 403s DELETE and POST /bulk-delete-jobs outright for
  // the Review Required tier rather than queueing them, so those controls
  // are withheld instead of rendered and then failing on click. Add stays
  // available (that tier may create directly) and edit stays available but
  // is narrowed server-side to the name column only -- see
  // utils/permissionActions.ts, where edit is 'limited' rather than
  // 'block'.
  const canDeleteContact = can('contacts', 'delete')
  const canBulkDeleteContacts = can('contacts', 'bulk_delete')
  // Client-side export gated by the modeled 'contacts:export' action, matching
  // the Customers/Suppliers tabs and the Products precedent.
  const canExportContacts = can('contacts', 'export')

  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  // Rename prompt, same flow as CustomersTab/SuppliersTab: the save awaits
  // the user's carry / only-this-one choice before the PUT goes out.
  const [renameRequest, setRenameRequest] = useState<RenameCascadeRequest | null>(null)
  const renameResolveRef = useRef<((choice: RenameCascadeChoice) => void) | null>(null)
  const askRenameChoice = (request: RenameCascadeRequest) => new Promise<RenameCascadeChoice>((resolve) => {
    renameResolveRef.current = resolve
    setRenameRequest(request)
  })
  const handleRenameChoice = (choice: RenameCascadeChoice) => {
    setRenameRequest(null)
    const resolve = renameResolveRef.current
    renameResolveRef.current = null
    resolve?.(choice)
  }
  const [contacts, setContacts] = useState<DeliveryContact[]>([])
  const [search,   setSearch]   = useState('')
  const appliedInitialSearchRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialSearch || initialSearch === appliedInitialSearchRef.current) return
    appliedInitialSearchRef.current = initialSearch
    setSearch(initialSearch)
  }, [initialSearch])
  const [modal,    setModal]    = useState<DeliveryModal>(null)
  const [selected, setSelected] = useState<DeliveryContact | null>(null)
  const [loading,  setLoading]  = useState(true)
  // Y1: true while ANY load is in flight (incl. silent search refetches)
  // so an empty list can say Searching... instead of a false empty state.
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [yearFilter, setYearFilter] = useState('all')
  const [monthFilter, setMonthFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [groupMode, setGroupMode] = useState<DeliveryGroupMode>('time')
  // Server paging state -- see deliveryQuery below (Part-77 parity finding).
  const [deliveryPage, setDeliveryPage] = useState(1)
  const [deliveryPageSize, setDeliveryPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [deliveryTotal, setDeliveryTotal] = useState(0)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [historyReady, setHistoryReady] = useState(false)
  // Y1: same shared 180ms debounce as the other list pages (was only
  // useDeferredValue -- every keystroke could fire its own server query).
  const deferredSearch = useDebouncedValue(search, 180)
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user })
  const deliveryQuery = useMemo(() => ({
    search: deferredSearch.trim() || undefined,
    year: yearFilter !== 'all' ? yearFilter : undefined,
    month: yearFilter !== 'all' && monthFilter !== 'all' ? monthFilter : undefined,
    // Server-side ORDER BY + paging -- same wiring and reasoning as
    // SuppliersTab.tsx's supplierQuery (Part-77 parity finding).
    sort: groupMode === 'alphabet' ? 'name' : 'created',
    dir: groupMode === 'alphabet' ? 'asc' : sortDirection,
    page: deliveryPage,
    pageSize: deliveryPageSize,
  }), [deferredSearch, deliveryPage, deliveryPageSize, groupMode, monthFilter, sortDirection, yearFilter])
  // Reset to page 1 whenever the result set is re-scoped; self-heal a page
  // stranded past the last one -- see SuppliersTab.tsx's twin comments.
  useEffect(() => { setDeliveryPage(1) }, [deferredSearch, groupMode, monthFilter, sortDirection, yearFilter])
  const deliveryTotalPages = Math.max(1, Math.ceil(Math.max(0, Number(deliveryTotal || 0)) / Math.max(1, Number(deliveryPageSize || 1))))
  useEffect(() => {
    if (deliveryPage > deliveryTotalPages) setDeliveryPage(deliveryTotalPages)
  }, [deliveryPage, deliveryTotalPages])

  // Same fix as CustomersTab.tsx's own filteredBySearch (see its comment):
  // the server's delivery_contacts_fts search (part 108) is typo/joiner/
  // order-tolerant, this literal `.includes()` chain was not, so it could
  // hide a delivery contact the server correctly matched. Switched to the
  // shared `fuzzyTextMatches` over a joined haystack matching
  // delivery_contacts_fts's own column set (name, phone, area, address).
  const filteredBySearch = useMemo(() => contacts.filter((contact) => (
    fuzzyTextMatches(
      [contact.name, contact.phone, contact.area, contact.address].join(' '),
      deferredSearch,
    )
  )), [contacts, deferredSearch])

  // Same same-page gender narrowing as CustomersTab.tsx/SuppliersTab.tsx
  // (see their comments -- no server-side gender query param on GET
  // /delivery-contacts).
  const filteredByGender = useMemo(
    () => (genderFilter === 'all' ? filteredBySearch : filteredBySearch.filter((contact) => (
      genderFilter === 'unspecified' ? !contact.gender : contact.gender === genderFilter
    ))),
    [filteredBySearch, genderFilter],
  )

  const timeMode = useMemo(() => getTimeGroupingMode(yearFilter, monthFilter), [monthFilter, yearFilter])
  const availableYears = useMemo(() => getAvailableYears(filteredByGender, (contact) => contact?.created_at), [filteredByGender])
  const filteredSections = useMemo(() => (
    groupMode === 'alphabet'
      ? buildAlphabetActionSections(filteredByGender, {
        getName: (contact) => contact?.name,
        getItemId: (contact) => Number(contact?.id),
        sortDirection: 'asc',
      })
      : buildTimeActionSections(filteredByGender, {
        getDate: (contact) => contact?.created_at,
        getItemId: (contact) => Number(contact?.id),
        year: yearFilter,
        month: monthFilter,
        timeMode,
        groupMode: 'time',
        sortDirection,
      })
  ), [filteredByGender, groupMode, monthFilter, sortDirection, timeMode, yearFilter])
  useEffect(() => {
    setCollapsedSections((current) => new Set([...current].filter((id) => filteredSections.some((section) => section.id === id))))
  }, [filteredSections])
  const visibleContacts = useMemo(
    () => filteredSections.flatMap((section) => section.items),
    [filteredSections],
  )
  const displayRows = useMemo<DeliveryDisplayRow[]>(
    () => filteredSections.flatMap((section) => {
      const collapsed = collapsedSections.has(section.id)
      return [
        { __kind: 'section', section, collapsed },
        ...(!collapsed ? section.items : []),
      ] as DeliveryDisplayRow[]
    }),
    [collapsedSections, filteredSections],
  )

  const { selectedIds, setSelectedIds, toggleOne, selectAllProp, selectionModeActive, getRowLongPressState } = useContactSelection(visibleContacts)
  // H1+X5 (Part 402): exports go through the shared options dialog.
  const [exportDialog, setExportDialog] = useState<{ rows: Array<Record<string, unknown>>; baseName: string } | null>(null)
  // 11.1/11.2 (B6): in select mode a cell click toggles the row; out of it
  // the cell keeps opening the detail panel (long-press enters the mode).
  const handleContactCellClick = (contact: DeliveryContact) => {
    if (selectionModeActive) {
      toggleOne(contact.id)
      return
    }
    setSelected(contact)
    setModal('detail')
  }
  const deliveryColumns = [t('name') || 'Name', t('phone') || 'Phone', t('area_zone')||'Area / Zone', t('gender') || 'Gender', t('col_added') || 'Added']
  const contactFilterSections = useMemo(() => ([
    {
      id: 'sort',
      label: tr('sort', 'Sort'),
      searchable: true,
      options: [
        { id: 'sort-desc', label: tr('newest_first', 'Newest first'), active: sortDirection === 'desc', onClick: () => setSortDirection('desc') },
        { id: 'sort-asc', label: tr('oldest_first', 'Oldest first'), active: sortDirection === 'asc', onClick: () => setSortDirection('asc') },
        ...buildPeriodFilterOptions({
          yearFilter, setYearFilter, monthFilter, setMonthFilter, availableYears,
          allTimeLabel: tr('all_time', 'All time'),
        }),
      ],
    },
    {
      id: 'group',
      label: tr('group_by', 'Group by'),
      options: [
        { id: 'group-time', label: tr('date', 'Date'), active: groupMode === 'time', onClick: () => setGroupMode('time') },
        { id: 'group-alphabet', label: 'A-Z / ខ្មែរ', active: groupMode === 'alphabet', onClick: () => setGroupMode('alphabet') },
      ],
    },
    {
      id: 'gender',
      label: tr('gender', 'Gender'),
      options: [
        { id: 'gender-all', label: tr('all', 'All'), active: genderFilter === 'all', onClick: () => setGenderFilter('all') },
        { id: 'gender-male', label: tr('male', 'Male'), active: genderFilter === 'male', onClick: () => setGenderFilter('male') },
        { id: 'gender-female', label: tr('female', 'Female'), active: genderFilter === 'female', onClick: () => setGenderFilter('female') },
        { id: 'gender-other', label: tr('other', 'Other'), active: genderFilter === 'other', onClick: () => setGenderFilter('other') },
        { id: 'gender-unspecified', label: tr('unspecified', 'Unspecified'), active: genderFilter === 'unspecified', onClick: () => setGenderFilter('unspecified') },
      ],
    },

  ]), [availableYears, genderFilter, groupMode, monthFilter, sortDirection, tr, yearFilter])
  const activeFilterCount = countActiveFlags([yearFilter !== 'all', monthFilter !== 'all', sortDirection !== 'desc', groupMode !== 'time', genderFilter !== 'all'])
  const toggleSectionCollapsed = (sectionId: string) => setCollapsedSections((current) => {
    const next = new Set(current)
    if (next.has(sectionId)) next.delete(sectionId)
    else next.add(sectionId)
    return next
  })
  const isSectionFullySelected = (ids: Array<number | string> = []) => ids.length > 0 && ids.every((id) => selectedIds.has(Number(id)))
  const isSectionPartiallySelected = (ids: Array<number | string> = []) => ids.some((id) => selectedIds.has(Number(id))) && !isSectionFullySelected(ids)
  const toggleSectionSelection = (ids: Array<number | string>, checked: boolean) => {
    ids.forEach((id) => {
      const numericId = Number(id)
      const isSelected = selectedIds.has(numericId)
      if ((checked && !isSelected) || (!checked && isSelected)) toggleOne(numericId)
    })
  }

  const buildDeliveryPayload = useCallback((contact: Partial<DeliveryContact> = {}): DeliveryPayload => ({
    name: contact.name || '',
    phone: contact.phone || '',
    area: contact.area || '',
    address: contact.address || '',
    notes: contact.notes || '',
    gender: contact.gender || '',
    userId: user?.id,
    userName: user?.name,
    // Undo/redo replays a rename the user already decided on; carry keeps
    // the linked sales in step (same as CustomersTab's builder).
    __rename_cascade: 'carry',
  }), [user?.id, user?.name])

  const runDeliveryMutation = useCallback(async (loader: () => unknown | Promise<unknown>, label: string): Promise<DeliveryMutationResult> => (
    await withLoaderTimeout(loader, label, DELIVERY_CONTACT_MUTATION_TIMEOUT_MS) as DeliveryMutationResult
  ), [])

  const clearLoadWatchdog = useCallback(() => {
    if (loadWatchdogRef.current != null) {
      window.clearTimeout(loadWatchdogRef.current)
      loadWatchdogRef.current = null
    }
  }, [])

  const load = useCallback(async ({ silent = false, label = 'Delivery contacts' }: { silent?: boolean, label?: string } = {}): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      clearLoadWatchdog()
      setRefreshing(true)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError('')
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoadError(tr('delivery_contacts_load_slow', 'Delivery contacts are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 15000)
      }
      try {
        const data = await withLoaderTimeout(() => getDeliveryApi().getDeliveryContacts(deliveryQuery), label, 20000)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const rows = normalizeDeliveryRows(data)
        setContacts(rows)
        // Paged response envelope -- same extraction as SuppliersTab.tsx.
        const payload = data && typeof data === 'object' && !Array.isArray(data)
          ? data as { total?: unknown; page?: unknown; pageSize?: unknown }
          : null
        setDeliveryTotal(Number(payload?.total || rows.length || 0))
        if (payload) {
          setDeliveryPage(Number(payload.page || deliveryPage) || 1)
          setDeliveryPageSize(Number(payload.pageSize || deliveryPageSize) || deliveryPageSize)
        }
        loadedOnceRef.current = true
        setLoadError('')
      } catch (error: unknown) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const message = getErrorMessage(error, 'Failed to load delivery contacts')
        if (!loadedOnceRef.current) {
          setLoadError(message)
          notify(message, 'error')
        } else {
          const refreshMessage = tr('delivery_contacts_refresh_failed', 'Unable to refresh delivery contacts right now. Showing the latest loaded data.')
          setLoadError((current) => current || refreshMessage)
          notify(refreshMessage, 'warning')
        }
      } finally {
        clearLoadWatchdog()
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setLoading(false)
        setRefreshing(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [clearLoadWatchdog, deliveryPage, deliveryPageSize, deliveryQuery, notify, tr])
  useEffect(() => {
    if (!active) {
      setHistoryReady(false)
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return undefined
    }
    load({ silent: loadedOnceRef.current })
    return () => {
      clearLoadWatchdog()
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
    }
  }, [active, clearLoadWatchdog, load])
  useEffect(() => {
    if (!active) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    setHistoryReady(true)
    return undefined
  }, [active, loading])
  useEffect(() => {
    if (!active || syncChannelName !== 'deliveryContacts') return
    load({ silent: true, label: 'Delivery contacts refresh' })
  }, [active, load, syncChannelName, syncChannelTs])

  const handleSave = async (form: DeliveryPayload) => {
    if (!beginSingleAction(saveInFlightRef)) return
    if (!String(form.name || '').trim() && !String(form.phone || '').trim()) {
      finishSingleAction(saveInFlightRef)
      return notify('Driver name or phone is required', 'error')
    }
    try {
      const existingSnapshot = selected ? cloneHistorySnapshot(selected) : null
      const payload: DeliveryPayload = { ...form, userId: user?.id, userName: user?.name }
      const oldName = selected ? String(selected.name || '').trim() : ''
      const newName = String(form.name || '').trim()
      if (selected && oldName && oldName.toLowerCase() !== newName.toLowerCase()) {
        const impact = await getDeliveryApi().getDeliveryContactRenameImpact(selected.id, newName)
        if (impact.target_exists) {
          notify(`"${newName}" already exists. Use Conflicts to choose which delivery contact to keep.`, 'warning')
          return
        }
        const choice = await askRenameChoice({ kind: 'delivery_contact', from: oldName, to: newName, impact, choices: ['carry', 'only'] })
        if (choice === 'cancel') return
        payload.__rename_cascade = choice === 'carry' ? 'carry' : 'record_only'
      }
      const res = selected
        ? await runDeliveryMutation(() => getDeliveryApi().updateDeliveryContact(selected.id, payload), 'Update delivery contact')
        : await runDeliveryMutation(() => getDeliveryApi().createDeliveryContact(payload), 'Create delivery contact')
      if (res?.success === false) { notify(res.error||'Failed', 'error'); return }
      if (selected && existingSnapshot) {
        const nextSnapshot = cloneHistorySnapshot({ ...existingSnapshot, ...payload, id: selected.id })
        actionHistory.pushAction({
          label: `Edit delivery contact ${existingSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const restoreResult = await runDeliveryMutation(
              () => getDeliveryApi().updateDeliveryContact(existingSnapshot.id, buildDeliveryPayload(existingSnapshot)),
              'Undo delivery contact edit',
            )
            if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore delivery contact')
            await load({ silent: true, label: 'Delivery contacts undo edit' })
          },
          redo: async () => {
            const redoResult = await runDeliveryMutation(
              () => getDeliveryApi().updateDeliveryContact(nextSnapshot.id, buildDeliveryPayload(nextSnapshot)),
              'Redo delivery contact edit',
            )
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply delivery contact changes')
            await load({ silent: true, label: 'Delivery contacts redo edit' })
          },
        })
      } else {
        let createdContactId = extractHistoryResultId(res)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdContactId })
        if (createdContactId > 0) {
          actionHistory.pushAction({
            label: `Add delivery contact ${createdSnapshot.name || ''}`.trim(),
            undo: async () => {
              await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(createdContactId), 'Undo delivery contact create')
              await load({ silent: true, label: 'Delivery contacts undo create' })
            },
            redo: async () => {
              const recreateResult = await runDeliveryMutation(
                () => getDeliveryApi().createDeliveryContact(buildDeliveryPayload(createdSnapshot)),
                'Redo delivery contact create',
              )
              if (recreateResult?.success === false) throw new Error(recreateResult.error || 'Failed to recreate delivery contact')
              createdContactId = extractHistoryResultId(recreateResult)
              await load({ silent: true, label: 'Delivery contacts redo create' })
            },
          })
        }
      }
      // Part 157: same partial-save signal CustomersTab/SuppliersTab
      // handle -- see routes/contacts.ts's PUT handler.
      if (selected && (res as { partial?: boolean } | null)?.partial) {
        notify(t('contact_partial_update_notice') || 'Only the name was saved -- your other changes need Full Access to Contacts.', 'warning')
      } else {
        notify(selected ? (t('delivery_contact_updated')||'Updated') : (t('delivery_contact_added')||'Added'))
      }
      setModal(null); setSelected(null); await load({ silent: true, label: 'Delivery contacts after save' })
    } catch (error: unknown) { notify(getErrorMessage(error, 'Failed'), 'error') }
    finally { finishSingleAction(saveInFlightRef) }
  }

  const handleDelete = async (c: DeliveryContact) => {
    if (!beginSingleAction(deleteInFlightRef)) return
    if (!confirm(`Delete "${c.name}"?`)) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    try {
      const snapshot = cloneHistorySnapshot(c)
      await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(c.id), 'Delete delivery contact')
      let restoredContactId = 0
      actionHistory.pushAction({
        label: `Delete delivery contact ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const restoreResult = await runDeliveryMutation(
            () => getDeliveryApi().createDeliveryContact(buildDeliveryPayload(snapshot)),
            'Undo delivery contact delete',
          )
          if (restoreResult?.success === false) throw new Error(restoreResult.error || 'Failed to restore delivery contact')
          restoredContactId = extractHistoryResultId(restoreResult)
          await load({ silent: true, label: 'Delivery contacts undo delete' })
        },
        redo: async () => {
          const targetId = restoredContactId || Number(snapshot.id || 0)
          if (!targetId) return
          await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(targetId), 'Redo delivery contact delete')
          await load({ silent: true, label: 'Delivery contacts redo delete' })
        },
      })
      notify(t('delivery_contact_deleted')||'Deleted')
      setModal(null)
      setSelected(null)
      await load({ silent: true, label: 'Delivery contacts after delete' })
    }
    catch (error: unknown) { notify(getErrorMessage(error, 'Failed'), 'error') }
    finally { finishSingleAction(deleteInFlightRef) }
  }

  const handleBulkDelete = async () => {
    if (!selectedIds.size || !beginSingleAction(bulkDeleteInFlightRef, { blocked: bulkActionBusy })) return
    if (!confirm(`Delete ${selectedIds.size} delivery contact(s)?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = [...selectedIds]
    const snapshots = buildSelectedSnapshots(contacts, ids)
    const failedIds: number[] = []
    setBulkActionBusy(true)
    try {
      const deleteRun = await runConcurrentTasks(ids, async (id: number) => {
        await runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(id), 'Bulk delete delivery contacts')
        return Number(id)
      })
      const deletedCount = deleteRun.successes.length
      failedIds.push(...deleteRun.failures.map((entry) => Number(entry.item)).filter((id) => Number.isFinite(id)))
      setSelectedIds(new Set(failedIds))
      await load({ silent: true, label: 'Delivery contacts refresh after delete' })
      const failedIdSet = new Set(failedIds)
      const deletedSnapshots = snapshots.filter((snapshot) => !failedIdSet.has(Number(snapshot?.id || 0)))
      if (deletedCount > 0 && deletedSnapshots.length) {
        let restoredEntries: Array<{ restoredId: number }> = []
        actionHistory.pushAction({
          label: `Delete ${deletedCount} delivery contact${deletedCount === 1 ? '' : 's'}`,
          undo: async () => {
            const restoreRun = await runConcurrentTasks(deletedSnapshots, async (snapshot: DeliveryContact) => {
              const result = await runDeliveryMutation(() => getDeliveryApi().createDeliveryContact({
                name: snapshot.name || '',
                phone: snapshot.phone || '',
                area: snapshot.area || '',
                address: snapshot.address || '',
                notes: snapshot.notes || '',
                userId: user?.id,
                userName: user?.name,
              }), 'Restore deleted delivery contacts')
              return { restoredId: Number(result?.id || result?.data?.id || 0) }
            })
            if (restoreRun.failures.length) throw (restoreRun.failures[0]?.error || new Error('Failed to restore delivery contact'))
            restoredEntries = restoreRun.successes.map((entry) => entry.value as { restoredId: number })
            await load({ silent: true, label: 'Delivery contacts restore deleted' })
          },
          redo: async () => {
            const idsToDelete = restoredEntries.map((entry) => Number(entry.restoredId || 0)).filter((id) => id > 0)
            const redoRun = await runConcurrentTasks(idsToDelete, async (id: number) => (
              runDeliveryMutation(() => getDeliveryApi().deleteDeliveryContact(id), 'Redo bulk delivery contact delete')
            ))
            if (redoRun.failures.length) throw (redoRun.failures[0]?.error || new Error('Failed to re-delete delivery contact'))
            await load({ silent: true, label: 'Delivery contacts redo delete' })
          },
        })
      }
      if (failedIds.length) {
        notify(`Deleted ${deletedCount} delivery contact(s), ${failedIds.length} failed`, 'warning')
      } else {
        notify(`${deletedCount} ${t('deleted') || 'deleted'}`)
      }
    } finally {
      finishSingleAction(bulkDeleteInFlightRef)
      setBulkActionBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Manage (Import + Export folded into one dropdown, same pattern
          Products.tsx uses) / History / Add Delivery -- History before
          Manage per the ordering used on Products. */}
      <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory as unknown as ActionHistoryBarHistory} t={t} className="min-w-0 flex-1" showLabel dense />
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName="min-w-0 flex-1"
          trigger={(
            <button
              type="button"
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300 sm:text-sm"
              aria-haspopup="true"
              aria-label={tr('manage', 'Manage', 'គ្រប់គ្រង')}
              title={tr('manage', 'Manage', 'គ្រប់គ្រង')}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr('manage', 'Manage', 'គ្រប់គ្រង')}</span>
            </button>
          )}
          items={([
            { label: tr('import_contacts', 'Import', 'នាំចូល'), onClick: () => setModal('import'), color: 'blue', icon: <Download className="h-4 w-4 shrink-0" /> },
            ...(canExportContacts ? [{
              label: tr('export', 'Export', 'នាំចេញ'),
              color: 'green',
              icon: <Upload className="h-4 w-4 shrink-0" />,
              onClick: async () => {
                const rows = visibleContacts.map(c => {
                  const options = parseDeliveryOptions(c.address)
                  const primaryOption = getPrimaryContactOption(options, {
                    fallback: { name: c.name || '', phone: c.phone || '', area: c.area || '' },
                  })
                  return {
                    Name: c.name || '',
                    Phone: primaryOption.phone || c.phone || '',
                    Area: primaryOption.area || c.area || '',
                    ContactOptions: buildContactOptionSummary(options, { mode: 'area' }),
                    Gender: c.gender || '',
                    Notes: c.notes || '',
                    Created: c.created_at || '',
                  }
                })
                // H1+X5 (Part 402): shared options dialog instead of a
                // fixed xlsx download.
                setExportDialog({ rows, baseName: 'delivery-contacts' })
              },
            }] : []),
          ] as PortalMenuItem[])}
        />
        <button
          className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 hover:border-blue-800 sm:text-sm"
          onClick={() => { setSelected(null); setModal('form') }}
          title={tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}
          aria-label={tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="truncate">{tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')}</span>
        </button>
      </div>

      {/* Search + filter pin to the top of the page's scroll container while
          scrolling -- same `sticky top-2` treatment as Products/Inventory/
          Sales/Returns/Branches/CustomersTab/SuppliersTab (Aug 11 2026
          UI-polish request). This tab renders under Contacts.tsx's own
          Customers/Suppliers/Delivery tab bar, which is NOT sticky and
          scrolls away like the rest of that page's chrome -- only this row
          pins. No separate select-all row here: ContactTable renders its
          own selectAll control inside the table header via the `selectAll`
          prop below. */}
      <div className="sticky top-2 z-30 -mx-1 flex min-w-0 items-center gap-2 bg-gray-50/95 pb-2 pt-1 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex gap-2 items-center flex-1 min-w-0">
          <SearchInput
            id="delivery-search"
            name="delivery_search"
            value={search}
            onChange={setSearch}
            placeholder={t('search_delivery_placeholder')||'Search...'}
            className="min-w-0 max-w-xs flex-1"
          />
        </div>
        <div className="flex gap-1.5 items-center overflow-x-auto flex-nowrap flex-shrink-0">
          {loadError ? (
            <button
              type="button"
              className="btn-secondary whitespace-nowrap text-sm text-amber-700 dark:text-amber-300"
              onClick={() => load({ silent: false, label: 'Delivery contacts retry' })}
            >
              {tr('retry', 'Retry')}
            </button>
          ) : null}
          {selectedIds.size > 0 && canBulkDeleteContacts && (
            <button
              className="btn-secondary text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleBulkDelete}
              disabled={bulkActionBusy}
            >
              {tr('delete_selected_count', 'Delete {count}').replace('{count}', String(selectedIds.size))}
            </button>
          )}
          <FilterMenu
            label={tr('filters', 'Filters')}
            activeCount={activeFilterCount}
            sections={contactFilterSections}
            onClear={() => {
              setYearFilter('all')
              setMonthFilter('all')
              setSortDirection('desc')
              setGroupMode('time')
              setGenderFilter('all')
            }}
            compact
            mobileIconOnly
          />
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          {loadError}
        </div>
      ) : null}

      <ContactTable
        loading={loading}
        rows={displayRows}
        emptyLabel={refreshing ? (t('searching') || 'Searching...') : (t('no_delivery_contacts')||'No delivery contacts')}
        columns={deliveryColumns}
        selectAll={selectAllProp}
        selectionModeActive={selectionModeActive}
        totalCount={deliveryTotal || visibleContacts.length}
        page={deliveryPage}
        pageSize={deliveryPageSize}
        onPageChange={setDeliveryPage}
        onPageSizeChange={setDeliveryPageSize}
        onRetry={() => load({ silent: false, label: 'Delivery contacts retry' })}
        loadingLabel={tr('loading_delivery_contacts', 'Loading delivery contacts...')}
        loadingDetails={tr('contacts_loading_details', 'Fetching delivery contacts, filters, and grouped sections.')}
        t={t}
        renderRow={(row) => {
          if (isSectionRow(row)) {
            const section = row.section
            return (
            <tr key={section.id} className="bg-slate-100/90 dark:bg-slate-800/80">
              <td colSpan={deliveryColumns.length + 2} className="px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {selectionModeActive ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSectionFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSectionPartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleSectionSelection(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    ) : null}
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)}>
                      {row.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {row.collapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                    </button>
                  </div>
                </div>
              </td>
            </tr>
            )
          }
          const contact = row as DeliveryContact
          const options = parseDeliveryOptions(contact.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: { name: contact.name || '', phone: contact.phone || '', area: contact.area || '' },
          })
          const rowLongPressState = getRowLongPressState(Number(contact.id))
          const rowLongPress = createLongPressHandlers(rowLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(contact.id))) toggleOne(contact.id)
            },
            // No onClick: plain taps keep hitting the cells' own handlers.
          })
          return (
          <tr
            key={contact.id}
            className={`table-row cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/30 ${selectedIds.has(Number(contact.id)) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
            {...(selectionModeActive ? {} : rowLongPress)}
            onClickCapture={(event) => {
              // Swallow the ghost click that follows a fired long-press.
              if (consumeLongPressClick(rowLongPressState)) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            <td className={selectionModeActive ? 'px-3 py-2 w-10' : 'px-0 py-2 w-0'} onClick={e => e.stopPropagation()}>
              {selectionModeActive ? (
              <>
              <label htmlFor={`delivery-select-${contact.id}`} className="sr-only">{`Select ${contact.name}`}</label>
              <input id={`delivery-select-${contact.id}`} name={`delivery_select_${contact.id}`} type="checkbox" className="w-4 h-4 cursor-pointer rounded" checked={selectedIds.has(Number(contact.id))} onChange={() => toggleOne(contact.id)} />
              </>
              ) : null}
            </td>
            <td className="max-w-[13rem] cursor-pointer truncate px-3 py-1.5 font-medium text-gray-900 dark:text-white" onClick={() => handleContactCellClick(contact)}>{contact.name}</td>
            <td className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-gray-500" onClick={() => handleContactCellClick(contact)}>{primaryOption.phone || contact.phone || '-'}</td>
            <td className="max-w-[12rem] cursor-pointer truncate px-3 py-1.5 text-gray-500" onClick={() => handleContactCellClick(contact)}>{primaryOption.area || contact.area || '-'}</td>
            <td className="cursor-pointer px-3 py-1.5 text-gray-500" onClick={() => handleContactCellClick(contact)}>{contact.gender ? tr(contact.gender, contact.gender) : tr('unspecified', 'Unspecified')}</td>
            <td className="cursor-pointer whitespace-nowrap px-3 py-1.5 text-[11px] text-gray-500" onClick={() => handleContactCellClick(contact)}>{fmtDateTime24(contact.created_at)}</td>
            <td className="px-2 py-1.5 text-right" onClick={e => e.stopPropagation()}>
              <ThreeDotMenu onDetails={() => { setSelected(contact); setModal('detail') }} onEdit={() => { setSelected(contact); setModal('form') }} onDelete={canDeleteContact ? () => handleDelete(contact) : undefined} />
            </td>
          </tr>
          )
        }}
        renderCard={(row) => {
          if (isSectionRow(row)) {
            const section = row.section
            return (
            <div key={section.id} className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {selectionModeActive ? (
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSectionFullySelected(section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSectionPartiallySelected(section.ids)
                    }}
                    onChange={(event) => toggleSectionSelection(section.ids, event.target.checked)}
                    aria-label={`Select ${section.label}`}
                  />
                  ) : null}
                  <span>{section.label}</span>
                  <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                </label>
                <div className="flex items-center gap-1">
                  <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleSectionCollapsed(section.id)}>
                    {row.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            )
          }
          const contact = row as DeliveryContact
          const options = parseDeliveryOptions(contact.address)
          const primaryOption = getPrimaryContactOption(options, {
            fallback: { name: contact.name || '', phone: contact.phone || '', area: contact.area || '' },
          })
          const cardLongPressState = getRowLongPressState(Number(contact.id))
          const cardLongPress = createLongPressHandlers(cardLongPressState, {
            disabled: selectionModeActive,
            onLongPress: () => {
              if (!selectedIds.has(Number(contact.id))) toggleOne(contact.id)
            },
          })
          // Delivery contacts store their default as option[0] (the phone
          // column mirrors it), so the option count already includes the
          // default; fall back to the phone column for legacy rows.
          const contactCount = options.length || (contact.phone ? 1 : 0)
          const cardPhone = primaryOption.phone || contact.phone || ''
          const cardArea = primaryOption.area || contact.area || ''
          const cardMeta = [cardPhone, cardArea].filter(Boolean).join(' · ')
          return (
          <div
            key={contact.id}
            className={`card p-3 flex cursor-pointer select-none items-center gap-3 ${selectedIds.has(Number(contact.id)) ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}`}
            onClick={() => handleContactCellClick(contact)}
            {...(selectionModeActive ? {} : cardLongPress)}
            onClickCapture={(event) => {
              if (consumeLongPressClick(cardLongPressState)) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            {selectionModeActive ? (
            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleOne(contact.id) }}>
              <label htmlFor={`delivery-card-select-${contact.id}`} className="sr-only">{`Select ${contact.name}`}</label>
              <input id={`delivery-card-select-${contact.id}`} name={`delivery_card_select_${contact.id}`} type="checkbox" className="w-5 h-5 cursor-pointer rounded" checked={selectedIds.has(Number(contact.id))} onChange={() => toggleOne(contact.id)} />
            </div>
            ) : null}
            <div className="w-9 h-9 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center text-green-600 font-bold text-sm flex-shrink-0">
              {contact.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{contact.name}</span>
                {contactCount > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-600 dark:bg-green-900/40 dark:text-green-300" title={`${contactCount} ${tr('contact_options', 'contact options')}`}>
                    <Phone className="h-2.5 w-2.5" />{contactCount}
                  </span>
                ) : null}
              </div>
              {cardMeta ? <div className="mt-0.5 truncate text-[11px] text-gray-500">{cardMeta}</div> : null}
            </div>
          </div>
          )
        }}
      />

      {modal === 'form'   && <DeliveryForm contact={selected} onSave={handleSave} onClose={() => { setModal(null); setSelected(null) }} t={t} />}
      {modal === 'import' ? (
        <Suspense fallback={null}>
          <ContactImportModal type="deliveryContact" onClose={() => setModal(null)} onDone={() => load({ silent: true, label: 'Delivery contacts after import' })} />
        </Suspense>
      ) : null}
      {modal === 'detail' && selected && (
        <DetailModal item={selected}
          fields={(() => {
            const options = parseDeliveryOptions(selected.address)
            const primaryOption = getPrimaryContactOption(options, {
              fallback: { name: selected.name || '', phone: selected.phone || '', area: selected.area || '' },
            })
            return [
              [t('name'), selected.name],
              [t('phone'), primaryOption.phone || selected.phone],
              [t('area_zone')||'Area / Zone', primaryOption.area || selected.area],
              [t('gender') || 'Gender', selected.gender ? (tr(selected.gender, selected.gender)) : (tr('unspecified', 'Unspecified'))],
              ['Contact Options', buildContactOptionSummary(options, { mode: 'area' })],
              [t('notes'), selected.notes],
              [t('col_added')||'Added', fmtDateTime24(selected.created_at)],
            ]
          })()}
          onEdit={() => setModal('form')} onDelete={canDeleteContact ? () => handleDelete(selected) : undefined} onClose={() => { setModal(null); setSelected(null) }} t={t}
          extraButtons={[{ label: tr('delivery_report', 'Deliveries'), onClick: () => setModal('report') }]} />
      )}
      {exportDialog ? (
        <Suspense fallback={null}>
          <ExportOptionsDialog
            title={t('export_options_title') || 'Export options'}
            fileBaseName={exportDialog.baseName}
            columns={columnsFromRows(exportDialog.rows)}
            rows={exportDialog.rows}
            rememberKey="contacts-delivery"
            t={t}
            notify={notify}
            onClose={() => setExportDialog(null)}
          />
        </Suspense>
      ) : null}
      {/* X3: the per-courier totals drill -- the same pattern as the supplier
          Purchases modal, backed by /api/sales/delivery-contact-report. */}
      {modal === 'report' && selected ? (
        <Suspense fallback={null}>
          <DeliveryContactReportModal
            contactId={selected.id as number}
            contactName={String(selected.name || '')}
            t={t}
            onClose={() => setModal('detail')}
          />
        </Suspense>
      ) : null}
      <RenameCascadeModal request={renameRequest} busy={false} t={(key, fallback) => tr(key, fallback || key)} onChoose={handleRenameChoice} />
    </div>
  )
}

export { DeliveryForm, DeliveryTab }
