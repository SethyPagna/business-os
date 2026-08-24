import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import PackageX from 'lucide-react/dist/esm/icons/package-x.js'
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
              {T('reset_will_delete', 'This will permanently delete:')}
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

function ResetData({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [mode, setMode] = useState<ResetMode>('sales')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const resetInFlightRef = useRef(false)
  // Only read/shown for mode='products' -- all three default to false
  // (kept), matching the backend's own default when these are omitted
  // entirely. includeImages is a targeted delete of just the R2 files the
  // removed products referenced, never a blanket wipe of everything stored.
  const [includeMovements, setIncludeMovements] = useState(false)
  const [includeSales, setIncludeSales] = useState(false)
  const [includeImages, setIncludeImages] = useState(false)

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
      id: 'products',
      label: T('reset_products_label', 'Products Only Reset'),
      desc: T('reset_products_desc', 'Deletes all products, their batches, branch stock, and image links. Stored image files are kept by default; choose below only if you also want to permanently delete them. Sales, returns, movements, customers, and suppliers are kept by default. Takes a fresh backup first.'),
      deleted: T('reset_products_deleted', 'All products, product batches, branch/batch stock, product image links'),
      kept: T('reset_products_kept', 'Sales, returns, inventory movements, customers, suppliers, contacts, settings, users, branches'),
      word: 'RESET PRODUCTS',
      icon: PackageX,
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

  // For 'products' mode, the deleted/kept summary shown in ConfirmReset has
  // to reflect whichever of the three optional toggles are currently on --
  // otherwise the confirm step could show stale text that doesn't match
  // what's actually about to be deleted.
  const productsDeletedParts = [T('reset_products_deleted', 'All products, product batches, branch/batch stock, product image links')]
  const productsKeptParts: string[] = []
  if (mode === 'products') {
    if (includeMovements) productsDeletedParts.push(T('reset_products_deleted_movements', 'all inventory movements and stock transfers'))
    else productsKeptParts.push(T('reset_movements_word', 'inventory movements'))
    if (includeSales) productsDeletedParts.push(T('reset_products_deleted_sales', 'all sales and returns'))
    else productsKeptParts.push(T('reset_sales_word', 'sales and returns'))
    if (includeImages) productsDeletedParts.push(T('reset_products_deleted_images', 'the stored image files those products used'))
    else productsKeptParts.push(T('reset_images_word', 'stored product image files'))
    productsKeptParts.push(T('reset_products_kept_base', 'customers, suppliers, contacts, settings, users, branches'))
  }
  const whatDeleted = mode === 'products' ? productsDeletedParts.join('; ') : selected.deleted
  const whatKept = mode === 'products' ? productsKeptParts.join(', ') : selected.kept

  const doReset = async () => {
    if (!hasPermission('backup')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(resetInFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => getResetApi().resetData?.(mode, mode === 'products' ? { includeMovements, includeSales, includeImages } : undefined) || Promise.resolve({ success: false, error: 'Reset API is unavailable' }),
        'Reset business data',
        RESET_DATA_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'reset_data',
          label: result.message || T('reset_complete', 'Reset complete'),
          undo_payload: mode === 'products' ? { mode, includeMovements, includeSales, includeImages } : { mode },
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {mode === 'products' ? (
        <div className="card space-y-2 border border-gray-200 p-4 dark:border-gray-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {T('reset_products_more_choices', 'Also clear (optional)')}
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeMovements}
              onChange={(event) => setIncludeMovements(event.target.checked)}
            />
            <span>
              <span className="font-medium">{T('reset_include_movements_label', 'Inventory movements & stock transfers')}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{T('reset_include_movements_hint', 'Kept by default \u2014 check to also wipe the movement/audit trail')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeSales}
              onChange={(event) => setIncludeSales(event.target.checked)}
            />
            <span>
              <span className="font-medium">{T('reset_include_sales_label', 'Sales & returns')}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{T('reset_include_sales_hint', 'Kept by default \u2014 check to also delete all sales and returns history')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeImages}
              onChange={(event) => setIncludeImages(event.target.checked)}
            />
            <span>
              <span className="font-medium">{T('reset_include_images_label', 'Stored product image files')}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{T('reset_include_images_hint', 'Kept by default \u2014 check to also permanently delete the image files these products used from storage')}</span>
            </span>
          </label>
        </div>
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

type SectionMode = 'customers' | 'suppliers' | 'delivery_contacts' | 'audit_log'
// A "page reset" option is either a resetData() mode (sales/products/all)
// or a resetSection() section (customers/suppliers/delivery_contacts/
// audit_log) -- two different backend endpoints, unified here into one
// selectable grid/confirm flow so the person picks a destructive action
// once, in one place, instead of two separate stacked panels each with
// their own mode-selector and confirm dialog (see PageReset's own comment
// below for why these two used to be split).
type PageResetKind = 'data' | 'section'
type PageResetOptionId = ResetMode | SectionMode

type SectionResetApi = {
  resetSection?: (section: SectionMode) => Promise<ResetApiResult>
}

// One consolidated screen rather than four separate per-page entry points
// -- this resolves Part 262's own open question the same way ResetData/
// FactoryReset above already answered it for Sales/Products/All: one panel
// inside the existing "Advanced maintenance and reset tools" section
// (Backup.tsx), not scattered across each section's own page. Backs
// POST /api/system/reset-section (routes/system.ts) -- Users deliberately
// excluded, same reasoning Part 262 gave (admin self-exclusion/session-
// invalidation/reseed questions still unresolved for that one specifically).
function SectionReset({ actionHistory = null }: ResetPanelProps) {
  const { t, notify, hasPermission } = useApp()
  const T = (key: string, fallback: string) => (typeof t === 'function' ? t(key, fallback) || fallback : fallback)
  const [section, setSection] = useState<SectionMode>('customers')
  const [working, setWorking] = useState(false)
  const elapsedSeconds = useElapsedSeconds(working)
  const sectionResetInFlightRef = useRef(false)

  const SECTIONS: ResetOption[] = [
    {
      id: 'customers' as unknown as ResetMode,
      label: T('reset_customers_label', 'Customers'),
      desc: T('reset_customers_desc', 'Deletes all customers. Their past sales and returns keep their own record of the name/phone/address, so old receipts and history still read fine. Takes a fresh backup first.'),
      deleted: T('reset_customers_deleted', 'All customers'),
      kept: T('reset_customers_kept', 'Sales, returns, products, suppliers, delivery contacts, everything else'),
      word: 'RESET CUSTOMERS',
      icon: RotateCcw,
    },
    {
      id: 'suppliers' as unknown as ResetMode,
      label: T('reset_suppliers_label', 'Suppliers'),
      desc: T('reset_suppliers_desc', 'Deletes all suppliers. Past returns keep their own record of the supplier name, so old history still reads fine. Takes a fresh backup first.'),
      deleted: T('reset_suppliers_deleted', 'All suppliers'),
      kept: T('reset_suppliers_kept', 'Sales, returns, products, customers, delivery contacts, everything else'),
      word: 'RESET SUPPLIERS',
      icon: RotateCcw,
    },
    {
      id: 'delivery_contacts' as unknown as ResetMode,
      label: T('reset_delivery_contacts_label', 'Delivery Contacts'),
      desc: T('reset_delivery_contacts_desc', 'Deletes all delivery contacts. Past sales keep their own record of the delivery name/phone/address, so old history still reads fine. Takes a fresh backup first.'),
      deleted: T('reset_delivery_contacts_deleted', 'All delivery contacts'),
      kept: T('reset_delivery_contacts_kept', 'Sales, returns, products, customers, suppliers, everything else'),
      word: 'RESET DELIVERY CONTACTS',
      icon: RotateCcw,
    },
    {
      id: 'audit_log' as unknown as ResetMode,
      label: T('reset_audit_log_label', 'Audit Log'),
      desc: T('reset_audit_log_desc', 'Deletes the audit log history. Nothing else reads or depends on it. Takes a fresh backup first.'),
      deleted: T('reset_audit_log_deleted', 'All audit log entries'),
      kept: T('reset_audit_log_kept', 'Everything else'),
      word: 'RESET AUDIT LOG',
      icon: RotateCcw,
    },
  ]

  const selected = SECTIONS.find((entry) => entry.id === (section as unknown as ResetMode)) || SECTIONS[0]

  const doReset = async () => {
    if (!hasPermission('backup')) return notify(T('access_denied', 'No permission'), 'error')
    if (!beginSingleAction(sectionResetInFlightRef, { blocked: working })) return
    setWorking(true)
    try {
      const result = await withLoaderTimeout(
        () => (getResetApi() as SectionResetApi).resetSection?.(section) || Promise.resolve({ success: false, error: 'Reset API is unavailable' }),
        'Reset section',
        RESET_DATA_TIMEOUT_MS,
      )
      if (result?.success) {
        actionHistory?.pushAction?.({
          scope: 'backup',
          entity: 'reset_section',
          label: result.message || T('reset_complete', 'Reset complete'),
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setSection(entry.id as unknown as SectionMode)}
            className={`rounded-xl border-2 p-3 text-left text-sm transition-colors ${
              section === (entry.id as unknown as SectionMode)
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                : 'border-gray-200 hover:border-red-300 dark:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
              <entry.icon className="h-4 w-4 shrink-0" />
              {entry.label}
            </div>
            {section === (entry.id as unknown as SectionMode) ? (
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{entry.desc}</div>
            ) : null}
          </button>
        ))}
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
    if (!hasPermission('backup')) return notify(T('access_denied', 'No permission'), 'error')
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

export { ResetData, SectionReset, FactoryReset }
