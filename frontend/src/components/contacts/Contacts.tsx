import type { ComponentType, SVGProps } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { Suspense, useState } from 'react'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useIsPageActive } from '../shared/pageActivity'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
type ContactTabId = 'customers' | 'suppliers' | 'delivery' | 'duplicates'
type ContactTabIcon = ComponentType<SVGProps<SVGSVGElement>>

interface AppContextValue {
  t: TranslateFn
  notify: NotifyFn
  hasPermission: (key: string) => boolean
}

interface ContactTabDefinition {
  id: ContactTabId
  label: string
  icon: ContactTabIcon
}

interface ContactTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  initialSearch?: string
}

interface ContactTabFallbackProps {
  t: TranslateFn
  label: string
}

const useApp = useAppHook as () => AppContextValue

const TABS = (t: TranslateFn): ContactTabDefinition[] => [
  { id: 'customers', label: t('customers') || 'Customers', icon: Users },
  { id: 'suppliers', label: t('suppliers') || 'Suppliers', icon: Warehouse },
  { id: 'delivery', label: t('pos_delivery') || 'Delivery', icon: Truck },
  { id: 'duplicates', label: t('possible_duplicates') || 'Possible Duplicates', icon: AlertTriangle },
]

const loadCustomersTab = async (): Promise<{ CustomersTab: ComponentType<ContactTabProps> }> => (
  await import('./CustomersTab') as unknown as { CustomersTab: ComponentType<ContactTabProps> }
)
const loadSuppliersTab = async (): Promise<{ SuppliersTab: ComponentType<ContactTabProps> }> => (
  await import('./SuppliersTab') as unknown as { SuppliersTab: ComponentType<ContactTabProps> }
)
const loadDeliveryTab = async (): Promise<{ DeliveryTab: ComponentType<ContactTabProps> }> => (
  await import('./DeliveryTab') as unknown as { DeliveryTab: ComponentType<ContactTabProps> }
)
type DuplicatesTabProps = ContactTabProps & {
  // Table kind matches contactDuplicates.ts's ContactTableKind
  // ('customers' | 'suppliers' | 'delivery_contacts'); tab id is this
  // page's own ContactTabId ('customers' | 'suppliers' | 'delivery') --
  // DuplicatesTab maps between the two before calling this, since it's
  // the one place both vocabularies need to meet.
  onResolve?: (tab: ContactTabId, name: string) => void
  includeSuppliers?: boolean
}

const loadDuplicatesTab = async (): Promise<{ default: ComponentType<DuplicatesTabProps> }> => (
  await import('./DuplicatesTab') as unknown as { default: ComponentType<DuplicatesTabProps> }
)
const CustomersTab = lazyRetry(() => loadCustomersTab().then((module) => ({ default: module.CustomersTab })), 'contacts-customers-tab')
const SuppliersTab = lazyRetry(() => loadSuppliersTab().then((module) => ({ default: module.SuppliersTab })), 'contacts-suppliers-tab')
const DeliveryTab = lazyRetry(() => loadDeliveryTab().then((module) => ({ default: module.DeliveryTab })), 'contacts-delivery-tab')
const DuplicatesTab = lazyRetry(() => loadDuplicatesTab(), 'contacts-duplicates-tab')

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

export default function Contacts() {
  const { t, notify, hasPermission } = useApp()
  const isActive = useIsPageActive('contacts')
  // Supplier privacy (Part 383 R2): the Suppliers section is admin-managed
  // -- an employee only sees it when granted 'contacts_suppliers' (admins
  // pass via the 'all' grant). Batches elsewhere still show the supplier
  // NAME; this hides the contact records themselves. The backend enforces
  // the same gate on every /suppliers endpoint, so hiding the tab is
  // presentation, not the security boundary.
  const canSeeSuppliers = hasPermission('contacts_suppliers')
  const [tab, setTab] = useState<ContactTabId>('customers')
  // Set when "Resolve" is clicked on a cluster in the Possible Duplicates
  // tab -- switches to the record's real tab and seeds that tab's own
  // search box with the contact's name, so the matching records land
  // side by side in the list the operator already knows how to edit/
  // merge/delete from. Keyed per-tab (not a single shared string) so
  // switching tabs manually doesn't leave a stale search behind on a
  // tab the operator didn't ask to jump to.
  const [resolveSearch, setResolveSearch] = useState<Partial<Record<ContactTabId, string>>>({})
  const resolveContact = (targetTab: ContactTabId, name: string): void => {
    setResolveSearch((current) => ({ ...current, [targetTab]: name }))
    setTab(targetTab)
  }

  const prefetchTab = (tabId: ContactTabId): void => {
    if (tabId === 'customers') {
      void loadCustomersTab()
    } else if (tabId === 'suppliers') {
      void loadSuppliersTab()
    } else if (tabId === 'delivery') {
      void loadDeliveryTab()
    } else if (tabId === 'duplicates') {
      void loadDuplicatesTab()
    }
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      {/* Page-level Import All / Export All controls were removed: they
          duplicated each tab's own scoped Import/Export/Add row (which now
          lives in the merged toolbar below that tab's search row), so this
          page keeps a single Import/Export set per tab instead of two. */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {TABS(t).filter(({ id }) => id !== 'suppliers' || canSeeSuppliers).map(({ id, label, icon: Icon }) => (
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

      {tab === 'customers' ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('customers') || 'customers'} />}>
          <CustomersTab t={t} notify={notify} active={isActive} initialSearch={resolveSearch.customers} />
        </Suspense>
      ) : null}
      {tab === 'suppliers' && canSeeSuppliers ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('suppliers') || 'suppliers'} />}>
          <SuppliersTab t={t} notify={notify} active={isActive} initialSearch={resolveSearch.suppliers} />
        </Suspense>
      ) : null}
      {tab === 'delivery' ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('pos_delivery') || 'delivery'} />}>
          <DeliveryTab t={t} notify={notify} active={isActive} initialSearch={resolveSearch.delivery} />
        </Suspense>
      ) : null}
      {tab === 'duplicates' ? (
        <Suspense fallback={<ContactTabFallback t={t} label={t('possible_duplicates') || 'possible duplicates'} />}>
          <DuplicatesTab t={t} notify={notify} active={isActive} onResolve={resolveContact} includeSuppliers={canSeeSuppliers} />
        </Suspense>
      ) : null}
    </div>
  )
}
