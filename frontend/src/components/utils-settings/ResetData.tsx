import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import PackageX from 'lucide-react/dist/esm/icons/package-x.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import Archive from 'lucide-react/dist/esm/icons/archive.js'
import { useApp as useAppFromContext } from '../../AppContext.tsx'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { refreshAppData } from '../../utils/appRefresh'
import { withLoaderTimeout } from '../../utils/loaders.ts'

type ResetMode = 'sales' | 'products' | 'all'
type ResetColor = 'red' | 'danger'
type Translate = (key: string, fallback?: string) => string | undefined
type Notify = (message: string, type?: string) => void

type AppContextValue = {
  t?: Translate
  notify: Notify
  hasPermission: (permission: string) => boolean
}

type ResetApiResult = {
  success?: boolean
  message?: string
  error?: string
}

// Only the 'products' mode reads these -- an additive, opt-in trio of
// toggles on top of its always-included base (products, batches, branch/
// batch stock, image links). All three default to false/kept, matching the
// backend's own default when the fields are omitted (see cloudflare/src/
// routes/system.ts's reset-data handler). includeImages is a TARGETED
// delete of the specific R2 files those products referenced -- never a
// blanket wipe of every stored image (that's Factory Reset / mode='all').
type ProductsResetToggles = {
  includeMovements?: boolean
  includeSales?: boolean
  includeImages?: boolean
}

type ResetApi = {
  resetData?: (mode: ResetMode, options?: ProductsResetToggles) => Promise<ResetApiResult>
  resetSection?: (section: 'customers' | 'suppliers' | 'delivery_contacts' | 'audit_log') => Promise<ResetApiResult>
  factoryReset?: () => Promise<ResetApiResult>
}

type ActionHistory = {
  pushAction?: (action: {
    scope: string
    entity: string
    label: string
    undo_payload?: Record<string, unknown>
  }) => void
}

type ConfirmResetProps = {
  title: string
  description: string
  whatDeleted: string
  whatKept?: string
  confirmWord: string
  onConfirm: () => void
  working: boolean
  elapsedSeconds?: number
  buttonLabel: string
  color?: ResetColor
  icon?: LucideIcon
  t?: Translate
  // Header above the whatDeleted list. Defaults to "This will permanently
  // delete:" for the actual resets; the migration-finalize steps override
  // it because they ZERO stock counts (recoverable via the fresh backup +
  // the very next re-import), not permanently delete rows -- calling that
  // "permanently delete" would misdescribe the action on its own confirm.
  whatHeader?: string
}

type ResetPanelProps = {
  actionHistory?: ActionHistory | null
}

type ResetOption = {
  id: ResetMode
  label: string
  desc: string
  deleted: string
  kept: string
  word: string
  icon: LucideIcon
}

const useApp = useAppFromContext as () => AppContextValue
// Was 60s/90s -- shorter than the underlying request could legitimately
// take (a fresh backup, a D1 batch delete, and for 'all'/factory reset a
// synchronous per-object R2 delete loop over every stored file before the
// backend can even respond) and shorter still than the 12s default the
// actual fetch call was using until now (see api/systemRuntime.ts's own
// note). Raised to match systemRuntime.ts's LONG_SYSTEM_ACTION_TIMEOUT_MS
// (10 minutes) so this outer client-side race isn't the thing that cuts
// the request off early again after fixing the inner one.
const RESET_DATA_TIMEOUT_MS = 10 * 60 * 1000
const FACTORY_RESET_TIMEOUT_MS = 10 * 60 * 1000
// Below this, "Working..." reads as instant feedback. Past it, a plain
// spinner with no other signal is exactly what looked like a frozen page
// in the reported bug -- so past this point the button label starts
// counting elapsed seconds instead, and the panel below it explains why
// it's still going, so a multi-minute real wipe (lots of stored images,
// mode='all'/factory reset) reads as "working as expected" instead of
// "broken".
const SLOW_ACTION_HINT_AFTER_MS = 8000

function ConfirmReset({
  title,
  description,
  whatDeleted,
  whatKept,
  confirmWord,
  onConfirm,
  working,
  elapsedSeconds = 0,
  buttonLabel,
  color = 'red',
  icon: Icon = AlertTriangle,
  t,
  whatHeader,
}: ConfirmResetProps) {
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState('')
  const showSlowHint = working && elapsedSeconds * 1000 >= SLOW_ACTION_HINT_AFTER_MS
  const workingLabel = showSlowHint
    ? `${T('reset_working', 'Working...')} ${elapsedSeconds}s`
    : T('reset_working', 'Working...')
  // Was: the confirm button's onClick fired onConfirm() (async, fire-and-
  // forget from here) and immediately reset step/typed back to 0 in the
  // same tick, collapsing the dialog back to its very first "click to
  // start" button while the actual request was still running in the
  // background. `working` was already true at that point, but step===0's
  // render never checks it -- so the moment someone clicked confirm, every
  // sign that a reset was in progress vanished, and combined with the
  // (separately fixed) too-short request timeout, the whole panel looked
  // like nothing had happened, or like it had silently failed, right up
  // until either the real completion or the timeout error showed up a
  // couple minutes later. Now step 2 stays put -- button disabled,
  // elapsed-time label ticking -- for as long as `working` is true, and
  // only resets back to the start once the request has actually settled.
  const wasWorkingRef = useRef(false)
  useEffect(() => {
    if (working) {
      wasWorkingRef.current = true
    } else if (wasWorkingRef.current) {
      wasWorkingRef.current = false
      setStep(0)
      setTyped('')
    }
  }, [working])
  const borderCls = color === 'red' ? 'border-red-200 dark:border-red-900/50' : 'border-red-500 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20'
  const btnCls = color === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-red-700 hover:bg-red-800 font-bold'

  return (
    <div className={`card border-2 p-5 sm:p-6 ${borderCls}`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-red-100 p-2 text-red-600 dark:bg-red-900/30 dark:text-red-300">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className={`mb-1 text-base font-semibold ${color === 'red' ? 'text-red-700 dark:text-red-400' : 'text-red-800 dark:text-red-300'}`}>{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        </div>
      </div>

      {whatKept ? <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">{T('reset_kept', 'Kept')}: {whatKept}</p> : null}

      {step === 0 ? (
        <button onClick={() => setStep(1)} className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls}`}>{buttonLabel}</button>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {whatHeader || T('reset_will_delete', 'This will permanently delete:')}
            </p>
            <p className="text-xs">{whatDeleted}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls}`}>{T('reset_yes_continue', 'Yes, continue')}</button>
            <button onClick={() => setStep(0)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[0]}
            <code className="mx-1 rounded bg-red-100 px-1 py-0.5 font-mono font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">{confirmWord}</code>
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[1]}
          </p>
          <input autoFocus disabled={working} className="input font-mono text-sm disabled:opacity-60" placeholder={confirmWord} value={typed} onChange={(event) => setTyped(event.target.value)} />
          <div className="flex gap-3">
            <button
              onClick={onConfirm}
              disabled={typed !== confirmWord || working}
              className={`rounded-lg px-4 py-2 text-sm text-white ${btnCls} disabled:opacity-40`}
            >
              {working ? workingLabel : buttonLabel}
            </button>
            <button onClick={() => { setStep(0); setTyped('') }} disabled={working} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
          {showSlowHint ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {T('reset_slow_hint', "Still working -- this can take a few minutes if there's a lot of stored data. Don't close this page.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// Ticks once a second while `active`, resetting to 0 whenever it flips
// back on -- used to turn a bare "Working..." label into visible, honest
// progress ("Working... 47s") for the long-running reset/factory-reset
// requests, instead of a static string that looks identical whether the
// request is 2 seconds or 4 minutes in.
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return undefined
    }
    const startedAt = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return elapsed
}

function getResetApi(): ResetApi {
  return typeof window === 'undefined' ? {} : (window as Window & { api?: ResetApi }).api || {}
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error')
}

// The three optional "also clear" toggles that only a PRODUCTS reset has.
// Extracted so the products reset can live in the page-reset grid below
// (where it belongs -- it clears one page's data, exactly like the contact
// sections do) without the toggles being copy-pasted to get it there.
//
// All three default to false/kept, matching the backend's own default when
// the fields are omitted (see cloudflare/src/routes/system.ts's reset-data
// handler). includeImages is a TARGETED delete of the specific R2 files
// those products referenced -- never a blanket wipe of every stored image
// (that is Factory Reset / mode='all').
function ProductsResetOptions({
  toggles,
  onChange,
  T,
}: {
  toggles: Required<ProductsResetToggles>
  onChange: (next: Required<ProductsResetToggles>) => void
  T: (key: string, fallback: string) => string
}) {
  const rows: Array<{ key: keyof ProductsResetToggles; label: string; hint: string }> = [
    {
      key: 'includeMovements',
      label: T('reset_include_movements_label', 'Inventory movements & stock transfers'),
      hint: T('reset_include_movements_hint', 'Kept by default — check to also wipe the movement/audit trail'),
    },
    {
      key: 'includeSales',
      label: T('reset_include_sales_label', 'Sales & returns'),
      hint: T('reset_include_sales_hint', 'Kept by default — check to also delete all sales and returns history'),
    },
    {
      key: 'includeImages',
      label: T('reset_include_images_label', 'Stored product image files'),
      hint: T('reset_include_images_hint', 'Kept by default — check to also permanently delete the image files these products used from storage'),
    },
  ]
  return (
    <div className="card space-y-2 border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {T('reset_products_more_choices', 'Also clear (optional)')}
      </p>
      {rows.map((row) => (
        <label key={row.key} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={toggles[row.key]}
            onChange={(event) => onChange({ ...toggles, [row.key]: event.target.checked })}
          />
          <span>
            <span className="font-medium">{row.label}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">{row.hint}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

function ResetData({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [mode, setMode] = useState<ResetMode>('sales')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const resetInFlightRef = useRef(false)

  const MODES: ResetOption[] = [
    {
      id: 'sales',
      label: T('reset_sales_label', 'Sales Only Reset'),
      desc: T('reset_sales_desc', 'Deletes all sales and returns history and zeros all stock quantities. Products, customers, and suppliers are kept.'),
      deleted: T('reset_sales_deleted', 'All sales, all returns, all inventory movements, all stock quantities (zeroed)'),
      kept: T('reset_sales_kept', 'Products, customers, suppliers, settings, users, branches'),
      word: 'RESET SALES',
      icon: RotateCcw,
    },
    {
      id: 'all',
      label: T('reset_all_label', 'Full Data Reset'),
      desc: T('reset_all_desc', 'Deletes everything: sales, returns, products, customers, suppliers, stock movements. Settings, users, and branches are kept.'),
      deleted: T('reset_all_deleted', 'All sales, returns, products, stock, customers, suppliers, delivery contacts, inventory movements'),
      kept: T('reset_all_kept', 'Users, roles, branches, categories, units, settings'),
      word: 'DELETE ALL DATA',
      icon: Trash2,
    },
  ]

  const selected = MODES.find((entry) => entry.id === mode) || MODES[0]

  const doReset = async () => {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(resetInFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => getResetApi().resetData?.(mode) || Promise.resolve({ success: false, error: 'Reset API is unavailable' }),
        'Reset business data',
        RESET_DATA_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'reset_data',
          label: result.message || T('reset_complete', 'Reset complete'),
          undo_payload: { mode },
        })
        notify(result.message || T('reset_complete', 'Reset complete'), 'success')
        refreshAppData()
      } else {
        notify(`${T('error', 'Error')}: ${result?.error || 'unknown'}`, 'error')
      }
    } catch (error: unknown) {
      notify(`${T('error', 'Error')}: ${getErrorMessage(error)}`, 'error')
    } finally {
      finishSingleAction(resetInFlightRef)
      setWorking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              onClick={() => setMode(entry.id)}
              className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                mode === entry.id
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-200 hover:border-red-300 dark:border-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
                <Icon className="h-4 w-4 shrink-0" />
                {entry.label}
              </div>
              {/* Full description text only shows for the selected card --
                  the rest of this grid was previously "too text heavy"
                  (every option's full desc rendered at once, all the time).
                  The selected card's own full text is repeated just below
                  in ConfirmReset's description line too, but keeping it
                  here as well means picking a different card doesn't cause
                  the whole panel to visibly jump/reflow as that text
                  appears elsewhere. */}
              {mode === entry.id ? (
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.desc}</div>
              ) : null}
            </button>
          )
        })}
      </div>


      <ConfirmReset
        title={selected.label}
        description={selected.desc}
        whatDeleted={selected.deleted}
        whatKept={selected.kept}
        confirmWord={selected.word}
        onConfirm={doReset}
        working={working}
        elapsedSeconds={elapsedSeconds}
        buttonLabel={selected.label}
        icon={selected.icon}
        t={t}
      />
    </div>
  )
}

type SectionMode = 'customers' | 'suppliers' | 'delivery_contacts' | 'audit_log'

// A page reset clears the data behind ONE page and leaves every other page
// alone. Products belongs here: it clears the Products page's own data
// exactly the way the Customers option clears the Customers page's, and
// leaving it stranded in the Data Reset tier -- next to "Sales Only" and
// "Full Data Reset", which are whole-database operations -- is what made
// it hard to find. Requested directly ("move products-only reset into the
// section-reset UI rather than living on its own").
//
// It reaches a DIFFERENT endpoint from the other four, though: products
// has three optional toggles, and reset-section deliberately has none (see
// routes/system.ts's comment on why folding them together server-side
// would put reset-section's simple contract at risk). So each option
// declares which endpoint it uses and this one flow calls the right one --
// unified where it matters to the person using it, separate where it
// matters to the server.
type PageResetKind = 'data' | 'section'
type PageResetOptionId = Extract<ResetMode, 'products'> | SectionMode

type PageResetOption = Omit<ResetOption, 'id'> & { id: PageResetOptionId; kind: PageResetKind }

type SectionResetApi = {
  resetSection?: (section: SectionMode) => Promise<ResetApiResult>
}

// One consolidated screen rather than a separate per-page entry point for
// each -- this resolves Part 262's own open question the same way
// ResetData/FactoryReset above answered it for Sales/All: one panel inside
// the existing "Advanced maintenance and reset tools" section
// (Backup.tsx), not scattered across each section's own page. Backs
// POST /api/system/reset-section and, for products, POST
// /api/system/reset-data. Users deliberately excluded, same reasoning Part
// 262 gave (admin self-exclusion / session-invalidation / reseed questions
// still unresolved for that one specifically).
function SectionReset({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [section, setSection] = useState<PageResetOptionId>('products')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const sectionResetInFlightRef = useRef(false)
  const [productToggles, setProductToggles] = useState<Required<ProductsResetToggles>>({
    includeMovements: false,
    includeSales: false,
    includeImages: false,
  })

  const SECTIONS: PageResetOption[] = [
    {
      id: 'products',
      kind: 'data',
      label: T('reset_products_label', 'Products Only Reset'),
      desc: T('reset_products_desc', 'Deletes all products, their batches, branch stock, and image links. Stored image files are kept by default; choose below only if you also want to permanently delete them. Sales, returns, movements, customers, and suppliers are kept by default. Takes a fresh backup first.'),
      deleted: T('reset_products_deleted', 'All products, product batches, branch/batch stock, product image links'),
      kept: T('reset_products_kept', 'Sales, returns, inventory movements, customers, suppliers, contacts, settings, users, branches'),
      word: 'RESET PRODUCTS',
      icon: PackageX,
    },
    {
      id: 'customers',
      kind: 'section',
      label: T('reset_customers_label', 'Customers'),
      desc: T('reset_customers_desc', 'Deletes all customers. Their past sales and returns keep their own record of the name/phone/address, so old receipts and history still read fine. Takes a fresh backup first.'),
      deleted: T('reset_customers_deleted', 'All customers'),
      kept: T('reset_customers_kept', 'Sales, returns, products, suppliers, delivery contacts, everything else'),
      word: 'RESET CUSTOMERS',
      icon: RotateCcw,
    },
    {
      id: 'suppliers',
      kind: 'section',
      label: T('reset_suppliers_label', 'Suppliers'),
      desc: T('reset_suppliers_desc', 'Deletes all suppliers. Past returns keep their own record of the supplier name, so old history still reads fine. Takes a fresh backup first.'),
      deleted: T('reset_suppliers_deleted', 'All suppliers'),
      kept: T('reset_suppliers_kept', 'Sales, returns, products, customers, delivery contacts, everything else'),
      word: 'RESET SUPPLIERS',
      icon: RotateCcw,
    },
    {
      id: 'delivery_contacts',
      kind: 'section',
      label: T('reset_delivery_contacts_label', 'Delivery Contacts'),
      desc: T('reset_delivery_contacts_desc', 'Deletes all delivery contacts. Past sales keep their own record of the delivery name/phone/address, so old history still reads fine. Takes a fresh backup first.'),
      deleted: T('reset_delivery_contacts_deleted', 'All delivery contacts'),
      kept: T('reset_delivery_contacts_kept', 'Sales, returns, products, customers, suppliers, everything else'),
      word: 'RESET DELIVERY CONTACTS',
      icon: RotateCcw,
    },
    {
      id: 'audit_log',
      kind: 'section',
      label: T('reset_audit_log_label', 'Audit Log'),
      desc: T('reset_audit_log_desc', 'Deletes the audit log history. Nothing else reads or depends on it. Takes a fresh backup first.'),
      deleted: T('reset_audit_log_deleted', 'All audit log entries'),
      kept: T('reset_audit_log_kept', 'Everything else'),
      word: 'RESET AUDIT LOG',
      icon: RotateCcw,
    },
  ]

  const selected = SECTIONS.find((entry) => entry.id === section) || SECTIONS[0]
  const isProducts = selected.id === 'products'

  // The confirm step must describe what is ACTUALLY about to happen, so
  // the products summary is rebuilt from the toggles rather than reusing
  // the static text -- otherwise checking "also delete sales" would still
  // read "sales kept" on the very screen asking you to confirm.
  const deletedParts = [selected.deleted]
  const keptParts: string[] = []
  if (isProducts) {
    if (productToggles.includeMovements) deletedParts.push(T('reset_products_deleted_movements', 'all inventory movements and stock transfers'))
    else keptParts.push(T('reset_movements_word', 'inventory movements'))
    if (productToggles.includeSales) deletedParts.push(T('reset_products_deleted_sales', 'all sales and returns'))
    else keptParts.push(T('reset_sales_word', 'sales and returns'))
    if (productToggles.includeImages) deletedParts.push(T('reset_products_deleted_images', 'the stored image files those products used'))
    else keptParts.push(T('reset_images_word', 'stored product image files'))
    keptParts.push(T('reset_products_kept_base', 'customers, suppliers, contacts, settings, users, branches'))
  }
  const whatDeleted = isProducts ? deletedParts.join('; ') : selected.deleted
  const whatKept = isProducts ? keptParts.join(', ') : selected.kept

  const doReset = async () => {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(sectionResetInFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => (isProducts
          ? getResetApi().resetData?.('products', productToggles)
          : (getResetApi() as SectionResetApi).resetSection?.(selected.id as SectionMode)
        ) || Promise.resolve({ success: false, error: 'Reset API is unavailable' }),
        isProducts ? 'Reset products' : 'Reset section',
        RESET_DATA_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: isProducts ? 'reset_data' : 'reset_section',
          label: result.message || T('reset_complete', 'Reset complete'),
          undo_payload: isProducts ? { mode: 'products', ...productToggles } : undefined,
        })
        notify(result.message || T('reset_complete', 'Reset complete'), 'success')
        refreshAppData()
      } else {
        notify(`${T('error', 'Error')}: ${result?.error || 'unknown'}`, 'error')
      }
    } catch (error: unknown) {
      notify(`${T('error', 'Error')}: ${getErrorMessage(error)}`, 'error')
    } finally {
      finishSingleAction(sectionResetInFlightRef)
      setWorking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setSection(entry.id)}
            className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
              section === entry.id
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                : 'border-gray-200 hover:border-red-300 dark:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
              <entry.icon className="h-4 w-4 shrink-0" />
              {entry.label}
            </div>
            {section === entry.id ? (
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.desc}</div>
            ) : null}
          </button>
        ))}
      </div>

      {isProducts ? (
        <ProductsResetOptions toggles={productToggles} onChange={setProductToggles} T={T} />
      ) : null}

      <ConfirmReset
        title={selected.label}
        description={selected.desc}
        whatDeleted={whatDeleted}
        whatKept={whatKept}
        confirmWord={selected.word}
        onConfirm={doReset}
        working={working}
        elapsedSeconds={elapsedSeconds}
        buttonLabel={selected.label}
        icon={selected.icon}
        t={t}
      />
    </div>
  )
}


function FactoryReset({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const showSlowHint = working && elapsedSeconds * 1000 >= SLOW_ACTION_HINT_AFTER_MS
  const factoryResetInFlightRef = useRef(false)
  const CONFIRM_WORD = 'FACTORY RESET'

  async function doFactoryReset() {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(factoryResetInFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => getResetApi().factoryReset?.() || Promise.resolve({ success: false, error: 'Factory reset API is unavailable' }),
        'Factory reset',
        FACTORY_RESET_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'factory_reset',
          label: T('factory_reset_complete', 'Factory reset complete. Restarting...'),
        })
        notify(T('factory_reset_complete', 'Factory reset complete. Restarting...'), 'success')
        refreshAppData()
      } else {
        notify(`${T('factory_reset_label', 'Factory Reset')} ${T('failed', 'failed')}: ${result?.error || 'unknown error'}`, 'error')
        setStep(0)
        setTyped('')
      }
    } catch (error: unknown) {
      notify(`${T('factory_reset_label', 'Factory Reset')} ${T('failed', 'failed')}: ${getErrorMessage(error)}`, 'error')
      setStep(0)
      setTyped('')
    } finally {
      finishSingleAction(factoryResetInFlightRef)
      setWorking(false)
    }
  }

  return (
    <div className="card border-2 border-red-500 bg-red-50/30 p-5 dark:border-red-700 dark:bg-red-950/20 sm:p-6">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-xl bg-red-100 p-2 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div>
          <h2 className="mb-1 text-base font-semibold text-red-800 dark:text-red-300">{T('factory_reset_label', 'Factory Reset')}</h2>
          <p className="text-sm text-red-700 dark:text-red-400">{T('factory_reset_desc', 'Deletes everything: all data including returns, all uploaded images, all users except the primary admin, all roles, all settings. Returns the app to factory defaults.')}</p>
          <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">{T('cannot_be_undone', 'This cannot be undone.')}</p>
        </div>
      </div>

      {step === 0 ? (
        <button onClick={() => setStep(1)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">
          {T('factory_reset_start', 'Begin Factory Reset')}
        </button>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-400 bg-red-100 p-4 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
            <p className="mb-1 flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" />
              {T('reset_will_delete', 'This will permanently delete:')}
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              <li>{T('factory_item1', 'All sales, products, stock, inventory movements')}</li>
              <li>{T('factory_item2', 'All customers and suppliers')}</li>
              <li>{T('factory_item3', 'All users (except the primary admin)')}</li>
              <li>{T('factory_item4', 'All custom roles and branches')}</li>
              <li>{T('factory_item5', 'All settings and audit logs')}</li>
              <li>{T('factory_item6', 'All uploaded images')}</li>
            </ul>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">{T('yes_continue', 'Yes, I understand - continue')}</button>
            <button onClick={() => setStep(0)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[0]}
            <code className="mx-1 rounded bg-red-200 px-1 py-0.5 font-mono font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">{CONFIRM_WORD}</code>
            {T('reset_type_to_confirm', 'Type {word} to confirm').split('{word}')[1]}
          </p>
          <input autoFocus disabled={working} className="input border-red-400 font-mono text-sm focus:ring-red-500 disabled:opacity-60 dark:border-red-700" placeholder={CONFIRM_WORD} value={typed} onChange={(event) => setTyped(event.target.value)} />
          <div className="flex gap-3">
            <button onClick={doFactoryReset} disabled={typed !== CONFIRM_WORD || working} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-40">
              {working ? `${T('reset_working', 'Resetting...')}${showSlowHint ? ` ${elapsedSeconds}s` : ''}` : T('factory_reset_label', 'Factory Reset')}
            </button>
            <button onClick={() => { setStep(0); setTyped('') }} disabled={working} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300">{T('cancel', 'Cancel')}</button>
          </div>
          {showSlowHint ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {T('reset_slow_hint', "Still working -- this can take a few minutes if there's a lot of stored data. Don't close this page.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Finalize migration -- the guided in-app version of the old-system import
// runbook's last hand-run steps (Downloads/businessos-migration-aug28/
// IMPORT-MANIFEST.md, Steps 4d + 4e), which used to be typed into
// `wrangler d1 execute` by hand. It walks the operator through them in the
// manifest's exact order:
//
//   1. Zero live stock (4d, part 1)  -> POST /finalize-migration zero_stock
//   2. Re-import the two product files (4d, part 2) -- a FILE upload the
//      operator does in Products -> Import; this panel can only instruct and
//      gate on an explicit acknowledgement, it cannot upload their local CSVs
//      for them.
//   3. Park historical lots (4e)     -> POST /finalize-migration park_lots
//
// Step 4f (the lot-ledger reconcile) is migration 0081 and applies itself on
// deploy, so it needs no button here. Both server calls take a fresh scoped
// backup first and are idempotent, so a mis-click or a re-run is safe.
// ---------------------------------------------------------------------------
type FinalizeStep = 'zero_stock' | 'park_lots'
type FinalizeApiResult = ResetApiResult & { affected?: Record<string, number> }
type FinalizeApi = {
  finalizeMigration?: (step: FinalizeStep) => Promise<FinalizeApiResult>
}
type FinalizeStage = 'zero' | 'reimport' | 'park' | 'done'

function getFinalizeApi(): FinalizeApi {
  return typeof window === 'undefined' ? {} : (window as Window & { api?: FinalizeApi }).api || {}
}

function MigrationFinalize({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [stage, setStage] = useState<FinalizeStage>('zero')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const inFlightRef = useRef(false)
  const [reimportAck, setReimportAck] = useState(false)

  const runStep = async (step: FinalizeStep, onSuccess: () => void) => {
    if (!hasPermission('backup_restore')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(inFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => getFinalizeApi().finalizeMigration?.(step) || Promise.resolve({ success: false, error: 'Migration finalize API is unavailable' }),
        step === 'zero_stock' ? 'Zero live stock' : 'Park historical lots',
        RESET_DATA_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'finalize_migration',
          label: result.message || T('done', 'Done'),
          undo_payload: { step },
        })
        notify(result.message || T('done', 'Done'), 'success')
        refreshAppData()
        onSuccess()
      } else {
        notify(`${T('error', 'Error')}: ${result?.error || 'unknown'}`, 'error')
      }
    } catch (error: unknown) {
      notify(`${T('error', 'Error')}: ${getErrorMessage(error)}`, 'error')
    } finally {
      finishSingleAction(inFlightRef)
      setWorking(false)
    }
  }

  // Compact numbered progress rail (ui-density preference: terse, one row).
  const steps: Array<{ id: FinalizeStage; label: string; icon: LucideIcon }> = [
    { id: 'zero', label: T('finalize_step_zero', 'Zero stock'), icon: RotateCcw },
    { id: 'reimport', label: T('finalize_step_reimport', 'Re-import'), icon: Upload },
    { id: 'park', label: T('finalize_step_park', 'Park lots'), icon: Archive },
  ]
  const stageOrder: FinalizeStage[] = ['zero', 'reimport', 'park', 'done']
  const currentIndex = stageOrder.indexOf(stage)

  return (
    <div className="space-y-4">
      <div className="card border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="mb-1 text-base font-semibold text-gray-800 dark:text-gray-200">{T('finalize_title', 'Finalize migration')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {T('finalize_desc', 'The last two old-system import steps, run in order: zero the live stock, re-import the product files, then park the historical lots. Each takes a fresh backup first. Only run this right after the history import — never on a running store.')}
            </p>
          </div>
        </div>

        {/* Progress rail */}
        <div className="mt-4 flex items-center gap-2 text-xs">
          {steps.map((s, index) => {
            const done = stage === 'done' || index < currentIndex
            const active = index === currentIndex
            return (
              <div key={s.id} className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${
                    done
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : active
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                  }`}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
                  <span>{index + 1}. {s.label}</span>
                </span>
                {index < steps.length - 1 ? <span className="text-gray-300 dark:text-gray-600">→</span> : null}
              </div>
            )
          })}
        </div>
      </div>

      {stage === 'zero' ? (
        <ConfirmReset
          title={T('finalize_zero_title', 'Step 1 — Zero live stock')}
          description={T('finalize_zero_desc', 'Sets every branch stock count and product stock quantity to zero, so the next re-import of the product files lands exactly on the template totals instead of stacking on top of the stock-history import. Reversible by the re-import you do next; a fresh backup is taken first.')}
          whatHeader={T('finalize_zero_header', 'This will set to zero:')}
          whatDeleted={T('finalize_zero_what', 'All branch_stock quantities and all products.stock_quantity values')}
          whatKept={T('finalize_zero_kept', 'Products, batches, suppliers, sales, and lot costs — only the live counts are zeroed')}
          confirmWord="ZERO STOCK"
          onConfirm={() => runStep('zero_stock', () => { setReimportAck(false); setStage('reimport') })}
          working={working}
          elapsedSeconds={elapsedSeconds}
          buttonLabel={T('finalize_zero_button', 'Zero live stock')}
          icon={RotateCcw}
          t={t}
        />
      ) : null}

      {stage === 'reimport' ? (
        <div className="card border-2 border-blue-200 p-5 dark:border-blue-900/50 sm:p-6">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <h2 className="mb-1 text-base font-semibold text-gray-800 dark:text-gray-200">{T('finalize_reimport_title', 'Step 2 — Re-import the product files')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {T('finalize_reimport_desc', 'This step is a file upload, so it happens on the Products page — it cannot be run from here. Open Products → Manage → Import → Add / Update, and re-import BOTH product files (the main catalog file, then the extra-products file), in Add / Update mode — never the Replace tab. Matched rows add their stock onto zero, landing exactly on the template numbers.')}
              </p>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" className="mt-0.5" checked={reimportAck} onChange={(event) => setReimportAck(event.target.checked)} />
            <span>{T('finalize_reimport_ack', "I've re-imported both product files (Add / Update). Continue to parking the historical lots.")}</span>
          </label>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setStage('park')}
              disabled={!reimportAck}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {T('finalize_reimport_continue', 'Continue to Step 3')}
            </button>
            <button onClick={() => setStage('zero')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
              {T('back', 'Back')}
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'park' ? (
        <ConfirmReset
          title={T('finalize_park_title', 'Step 3 — Park historical lots')}
          description={T('finalize_park_desc', "Zeros the remaining quantity on the historical 'Unified stock import' lots so the POS lot picker skips them — the old system never tied sales to lots, so their remaining counts aren't allocatable. The opening lots from the product import are left alone, so migration 0081's lot-ledger reconcile still works and re-running this is a no-op. A fresh backup is taken first.")}
          whatHeader={T('finalize_park_header', 'This will set to zero:')}
          whatDeleted={T('finalize_park_what', "The remaining quantity on every 'Unified stock import' historical lot")}
          whatKept={T('finalize_park_kept', 'The lots themselves and their received/cost data (the supplier Purchases view still reads them); the product-import opening lots are untouched')}
          confirmWord="PARK LOTS"
          onConfirm={() => runStep('park_lots', () => setStage('done'))}
          working={working}
          elapsedSeconds={elapsedSeconds}
          buttonLabel={T('finalize_park_button', 'Park historical lots')}
          icon={Archive}
          t={t}
        />
      ) : null}

      {stage === 'done' ? (
        <div className="card border-2 border-emerald-200 p-5 dark:border-emerald-900/50 sm:p-6">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="mb-1 text-base font-semibold text-emerald-700 dark:text-emerald-400">{T('finalize_done_title', 'Migration finalized')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {T('finalize_done_desc', 'Live stock is zeroed and re-imported to the template totals, and the historical lots are parked. The lot-ledger reconcile (Step 4f) runs automatically as migration 0081 on the next deploy — nothing more to do here.')}
              </p>
            </div>
          </div>
          <button onClick={() => { setReimportAck(false); setStage('zero') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
            {T('finalize_start_over', 'Start over')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { ResetData, SectionReset, FactoryReset, MigrationFinalize }
