import type { ComponentType, SVGProps } from 'react'
import { Suspense, lazy, useState } from 'react'
import BookUser from 'lucide-react/dist/esm/icons/book-user.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { downloadZipFilesAsync } from '../../utils/csv'
import { CustomersTab as CustomersTabBase } from './CustomersTab'
import Modal from '../shared/Modal'
import PageHeader from '../shared/PageHeader'
import { useIsPageActive } from '../shared/pageActivity'
import { getFirstLoaderError, settleLoaderMap, withLoaderTimeout } from '../../utils/loaders.ts'

const CONTACTS_EXPORT_LOAD_TIMEOUT_MS = 12000

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type ContactTabId = 'customers' | 'suppliers' | 'delivery'
type ImportContactType = 'customer' | 'supplier' | 'deliveryContact'
type ContactsModal = 'pickImportType' | 'import' | null
type ContactTabIcon = ComponentType<SVGProps<SVGSVGElement>>

interface AppContextValue {
  t: TranslateFn
  notify: NotifyFn
}

interface ContactTabDefinition {
  id: ContactTabId
  label: string
  icon: ContactTabIcon
}

interface ContactExportRow {
  name?: unknown
  membership_number?: unknown
  phone?: unknown
  email?: unknown
  company?: unknown
  contact_person?: unknown
  area?: unknown
  address?: unknown
  notes?: unknown
  created_at?: unknown
}

interface ApiListResponse {
  items?: unknown
}

interface ContactApi {
  getCustomers: () => Promise<unknown>
  getSuppliers: () => Promise<unknown>
  getDeliveryContacts: () => Promise<unknown>
}

interface ContactTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
}

interface ContactImportModalProps {
  type: ImportContactType
  onClose: () => void
  onDone: () => void
}

interface ContactTabFallbackProps {
  t: TranslateFn
  label: string
}

interface ImportTypePickerProps {
  onSelect: (type: ImportContactType) => void
  onClose: () => void
  t: TranslateFn
}

interface ExportZipFile {
  filename: string
  rows: Array<Record<string, unknown>>
}

const useApp = useAppHook as () => AppContextValue

function getContactApi(): ContactApi {
  if (!window.api) throw new Error('Contacts API is not available.')
  return window.api as ContactApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function asExportValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function normalizeContactExportRows(value: unknown): ContactExportRow[] {
  if (Array.isArray(value)) return value
  const payload = value as ApiListResponse | null | undefined
  if (Array.isArray(payload?.items)) return payload.items as ContactExportRow[]
  return []
}

const TABS = (t: TranslateFn): ContactTabDefinition[] => [
  { id: 'customers', label: t('customers') || 'Customers', icon: Users },
  { id: 'suppliers', label: t('suppliers') || 'Suppliers', icon: Warehouse },
  { id: 'delivery', label: t('pos_delivery') || 'Delivery', icon: Truck },
]

const CustomersTab = CustomersTabBase as ComponentType<ContactTabProps>
const ContactImportModal = lazy(() => (
  import('./ContactImportModal').then((module) => ({
    default: module.default as ComponentType<ContactImportModalProps>,
  }))
))
const loadSuppliersTab = async (): Promise<{ SuppliersTab: ComponentType<ContactTabProps> }> => (
  await import('./SuppliersTab') as unknown as { SuppliersTab: ComponentType<ContactTabProps> }
)
const loadDeliveryTab = async (): Promise<{ DeliveryTab: ComponentType<ContactTabProps> }> => (
  await import('./DeliveryTab') as unknown as { DeliveryTab: ComponentType<ContactTabProps> }
)
const SuppliersTab = lazy(() => loadSuppliersTab().then((module) => ({ default: module.SuppliersTab })))
const DeliveryTab = lazy(() => loadDeliveryTab().then((module) => ({ default: module.DeliveryTab })))

function ContactTabFallback({ t, label }: ContactTabFallbackProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
        <div className="mb-2 h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {(typeof t === 'function' ? t('loading') : '') || 'Loading'} {label}...
        </p>
      </div>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 md:block">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
          <div className="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="ml-auto h-9 w-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="space-y-3 px-4 py-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={`contacts-tab-fallback-row-${index}`} className="grid grid-cols-[32px,1.2fr,1fr,1fr,1fr,32px] items-center gap-3">
              <div className="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`contacts-tab-fallback-card-${index}`} className="rounded-xl border border-slate-200 bg-white/90 px-3 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ImportTypePicker({ onSelect, onClose, t }: ImportTypePickerProps) {
  const T = (key: string, fallback: string): string => t(key) || fallback

  return (
    <Modal
      title={(
        <span className="inline-flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {T('import_all_contacts_title', 'Import All Contacts')}
        </span>
      )}
      onClose={onClose}
    >
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {T('import_all_select_type', 'Select the contact type to import:')}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-blue-400" onClick={() => onSelect('customer')}>
          <Users className="h-6 w-6 text-blue-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_customers_btn', 'Customers')}
          </span>
        </button>
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-purple-400" onClick={() => onSelect('supplier')}>
          <Warehouse className="h-6 w-6 text-purple-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_suppliers_btn', 'Suppliers')}
          </span>
        </button>
        <button className="card flex cursor-pointer flex-col items-center gap-2 p-4 hover:border-orange-400" onClick={() => onSelect('deliveryContact')}>
          <Truck className="h-6 w-6 text-orange-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {T('import_delivery_btn', 'Delivery')}
          </span>
        </button>
      </div>
    </Modal>
  )
}

export default function Contacts() {
  const { t, notify } = useApp()
  const isActive = useIsPageActive('contacts')
  const [tab, setTab] = useState<ContactTabId>('customers')
  const [modal, setModal] = useState<ContactsModal>(null)
  const [importType, setImportType] = useState<ImportContactType | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const prefetchTab = (tabId: ContactTabId): void => {
    if (tabId === 'suppliers') {
      void loadSuppliersTab()
    } else if (tabId === 'delivery') {
      void loadDeliveryTab()
    }
  }

  const handleExportAll = async () => {
    try {
      const api = getContactApi()
      const result = await settleLoaderMap({
        customers: () => withLoaderTimeout(
          () => api.getCustomers(),
          'Contacts export customers',
          CONTACTS_EXPORT_LOAD_TIMEOUT_MS,
        ),
        suppliers: () => withLoaderTimeout(
          () => api.getSuppliers(),
          'Contacts export suppliers',
          CONTACTS_EXPORT_LOAD_TIMEOUT_MS,
        ),
        delivery: () => withLoaderTimeout(
          () => api.getDeliveryContacts(),
          'Contacts export delivery',
          CONTACTS_EXPORT_LOAD_TIMEOUT_MS,
        ),
      })
      const customers = normalizeContactExportRows(result.values.customers)
      const suppliers = normalizeContactExportRows(result.values.suppliers)
      const delivery = normalizeContactExportRows(result.values.delivery)
      const today = new Date().toISOString().slice(0, 10)

      const files: ExportZipFile[] = []

      if (customers.length > 0) {
        files.push({
          filename: `contacts-customers-${today}.csv`,
          rows: customers.map((c) => ({
            Name: asExportValue(c.name),
            Membership_Number: asExportValue(c.membership_number),
            Phone: asExportValue(c.phone),
            Email: asExportValue(c.email),
            Company: asExportValue(c.company),
            Address: asExportValue(c.address),
            Notes: asExportValue(c.notes),
            Created: asExportValue(c.created_at),
          })),
        })
      }
      if (suppliers.length > 0) {
        files.push({
          filename: `contacts-suppliers-${today}.csv`,
          rows: suppliers.map((s) => ({
            Name: asExportValue(s.name),
            Phone: asExportValue(s.phone),
            Email: asExportValue(s.email),
            Company: asExportValue(s.company),
            Contact_Person: asExportValue(s.contact_person),
            Address: asExportValue(s.address),
            Notes: asExportValue(s.notes),
            Created: asExportValue(s.created_at),
          })),
        })
      }
      if (delivery.length > 0) {
        files.push({
          filename: `contacts-delivery-${today}.csv`,
          rows: delivery.map((d) => ({
            Name: asExportValue(d.name),
            Phone: asExportValue(d.phone),
            Area: asExportValue(d.area),
            Address: asExportValue(d.address),
            Notes: asExportValue(d.notes),
            Created: asExportValue(d.created_at),
          })),
        })
      }

      if (files.length) {
        await downloadZipFilesAsync(`contacts-export-${today}.zip`, files)
      }

      const total = customers.length + suppliers.length + delivery.length
      if (!result.hasAnySuccess) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to export contacts'))
      }
      if (result.hasErrors) {
        notify(t('contacts_partial_export') || 'Some contact groups were unavailable, so only the ready data was exported.', 'warning')
      }
      notify(`${t('all_contacts_exported') || 'All contacts exported'} (${total} ${t('entries') || 'records'})`)
    } catch (error) {
      notify(`Export failed: ${getErrorMessage(error, 'Failed to export contacts')}`, 'error')
    }
  }

  const openImportPicker = () => setModal('pickImportType')

  const handleTypeSelected = (type: ImportContactType) => {
    setImportType(type)
    setModal('import')
  }

  const handleImportDone = () => {
    setReloadKey((value) => value + 1)
    setModal(null)
    setImportType(null)
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <PageHeader
        icon={BookUser}
        tone="blue"
        title={t('contacts')}
        subtitle=""
        className="mb-4"
        stackOnMobile={false}
        actionsClassName="min-w-0"
        actions={(
          <div className="ml-auto flex min-w-0 flex-shrink gap-1 overflow-x-auto pb-0.5">
            <button
              className="btn-secondary flex flex-shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-xs sm:text-sm"
              onClick={openImportPicker}
              title={t('import_all_contacts_title') || 'Import contacts'}
              aria-label={t('imports') || 'Imports'}
            >
              <Upload className="h-4 w-4" />
              <span>{t('imports') || 'Imports'}</span>
            </button>
            <button
              className="btn-secondary flex flex-shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-xs sm:text-sm"
              onClick={handleExportAll}
              title={t('export_all_contacts') || 'Export all contacts as CSVs'}
              aria-label={t('export') || 'Export'}
            >
              <Download className="h-4 w-4" />
              <span>{t('export') || 'Export'}</span>
            </button>
          </div>
        )}
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {TABS(t).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            onMouseEnter={() => prefetchTab(id)}
            onFocus={() => prefetchTab(id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors sm:px-5 ${
              tab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'customers' && <CustomersTab key={`c-${reloadKey}`} t={t} notify={notify} active={isActive} />}
      {tab === 'suppliers' ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('suppliers') || 'suppliers'} />}>
          <SuppliersTab key={`s-${reloadKey}`} t={t} notify={notify} active={isActive} />
        </Suspense>
      ) : null}
      {tab === 'delivery' ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('pos_delivery') || 'delivery'} />}>
          <DeliveryTab key={`d-${reloadKey}`} t={t} notify={notify} active={isActive} />
        </Suspense>
      ) : null}

      {modal === 'pickImportType' ? (
        <ImportTypePicker onSelect={handleTypeSelected} onClose={() => setModal(null)} t={t} />
      ) : null}
      {modal === 'import' && importType ? (
        <Suspense fallback={null}>
          <ContactImportModal
            type={importType}
            onClose={() => {
              setModal(null)
              setImportType(null)
            }}
            onDone={handleImportDone}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
