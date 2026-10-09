import Check from 'lucide-react/dist/esm/icons/check.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  beginTrackedRequest,
  getLoaderErrorMessage,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { identityForIntent, withWriteTimeout, type IntentIdentityRef } from '../../utils/writeIntent.ts'
import { businessDateTimeId } from '../../utils/timestampId.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import Modal from '../shared/Modal.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import SearchInput from '../shared/SearchInput.tsx'
import { Skeleton } from '../shared/kit'
import ContactPicker from '../contacts/ContactPicker.tsx'
import { useReturnReasonPresets } from './helpers/useReturnReasonPresets.ts'
import { filterAndRankSupplierReturnProducts } from './supplierReturnSearch.ts'
import { formatBatchReceivedDate } from '../../utils/batchLabel.ts'
import { assertActorReadScope, captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import type { SupplierProductSources, SupplierTaggedSource } from '../../api/returnsTransport.ts'

const SUPPLIER_RETURN_SETUP_TIMEOUT_MS = 12000
const SUPPLIER_RETURN_SETUP_WATCHDOG_MS = SUPPLIER_RETURN_SETUP_TIMEOUT_MS + 1500
const SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS = 12000
const SUPPLIER_RETURN_CREATE_TIMEOUT_MS = 15000

type NoticeKind = 'success' | 'error' | 'info' | 'warning' | string
type MoneyFormatter = (value: number | string) => string
type SettlementMethod = 'refund' | 'credit' | 'replacement' | 'writeoff'

const SUPPLIER_RETURN_SETTLEMENT_VALUES: SettlementMethod[] = ['refund', 'credit', 'replacement', 'writeoff']

interface AppUser {
  id?: number | string
  name?: string | null
  username?: string | null
}

interface BranchRow {
  id: number | string
  name?: string
  is_active?: boolean
  is_default?: boolean
}

interface SupplierRow {
  id: number | string
  name?: string
  phone?: string | null
}

interface InventoryProductRow {
  id: number | string
  name?: string
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  display_quantity?: number | string
  purchase_price_usd?: number | string
  cost_price_usd?: number | string
  purchase_price_khr?: number | string
  cost_price_khr?: number | string
}

interface SupplierReturnItem {
  product_id: number | string
  product_name: string | null
  quantity: number
  cost_price_usd: number
  cost_price_khr: number
  stock_condition: string
  damaged_lot_id?: number
}
type SupplierSelection = { raw: string; item: SupplierReturnItem; available: number; source: SupplierTaggedSource | null; review: string }
type PendingSupplierReturn = { body: SupplierReturnPayload; scope: ActorReadScope; uncertain: boolean; result?: unknown; notified?: boolean }
function supplierSourceReview(product: SupplierProductSources, visible: boolean, editable: boolean): string {
  return JSON.stringify({ visible, editable, product })
}

interface SupplierReturnPayload extends Record<string, unknown> {
  cashier_id: number | string | null
  cashier_name: string | null
  branch_id: number
  supplier_id: number
  supplier_name: string | null
  reason: string
  notes: string | null
  settlement: SettlementMethod
  supplier_compensation_usd: number
  supplier_compensation_khr: number
  items: SupplierReturnItem[]
}

interface NewSupplierReturnModalProps {
  onClose: () => void
  onSuccess?: (result: unknown) => void | Promise<void>
  notify: (message: string, kind?: NoticeKind) => void
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
}

const useApp = useAppHook as () => {
  user?: AppUser | null
  t?: (key: string) => string
}

type BranchTransportModule = typeof import('../../api/branchTransport.ts')
type ContactReadTransportModule = typeof import('../../api/contactReadTransport.ts')
type InventoryTransportModule = typeof import('../../api/inventoryTransport.ts')
type ReturnsTransportModule = typeof import('../../api/returnsTransport.ts')

let branchTransportPromise: Promise<BranchTransportModule> | null = null
let contactReadTransportPromise: Promise<ContactReadTransportModule> | null = null
let inventoryTransportPromise: Promise<InventoryTransportModule> | null = null
let returnsTransportPromise: Promise<ReturnsTransportModule> | null = null

function loadBranchTransport(): Promise<BranchTransportModule> {
  if (!branchTransportPromise) branchTransportPromise = import('../../api/branchTransport.ts')
  return branchTransportPromise
}

function loadContactReadTransport(): Promise<ContactReadTransportModule> {
  if (!contactReadTransportPromise) contactReadTransportPromise = import('../../api/contactReadTransport.ts')
  return contactReadTransportPromise
}

function loadInventoryTransport(): Promise<InventoryTransportModule> {
  if (!inventoryTransportPromise) inventoryTransportPromise = import('../../api/inventoryTransport.ts')
  return inventoryTransportPromise
}

function loadReturnsTransport(): Promise<ReturnsTransportModule> {
  if (!returnsTransportPromise) returnsTransportPromise = import('../../api/returnsTransport.ts')
  return returnsTransportPromise
}

async function loadSupplierReturnSetup(): Promise<[BranchRow[], SupplierRow[]]> {
  const [branchModule, contactReadModule] = await Promise.all([
    loadBranchTransport(),
    loadContactReadTransport(),
  ])
  const [branchRows, supplierRows] = await Promise.all([
    branchModule.getBranches(),
    // fields=names: picking WHO the return goes to only needs the name
    // (and id), and this is the suppliers read every role may call --
    // the full contact list needs contacts_suppliers (Part 383 R2).
    contactReadModule.getSuppliers({ fields: 'names' }),
  ])
  return [
    (branchRows || []) as BranchRow[],
    (supplierRows || []) as SupplierRow[],
  ]
}

async function loadSupplierReturnInventory(branchId: string): Promise<InventoryProductRow[]> {
  const { getInventorySummary } = await loadInventoryTransport()
  const rows = await getInventorySummary({ branchId: Number(branchId) })
  return (rows || []) as InventoryProductRow[]
}

async function createSupplierReturnRequest(payload: SupplierReturnPayload): Promise<unknown> {
  const { createSupplierReturn } = await loadReturnsTransport()
  return createSupplierReturn(payload)
}

export default function NewSupplierReturnModal({ onClose, onSuccess, notify, fmtUSD, fmtKHR }: NewSupplierReturnModalProps) {
  const { user, t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const returnReasonPresets = useReturnReasonPresets(t)

  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [products, setProducts] = useState<InventoryProductRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [reason, setReason] = useState('')
  const [settlement, setSettlement] = useState<SettlementMethod>('refund')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, SupplierSelection>>({})
  const [sources, setSources] = useState<Record<string, SupplierProductSources>>({})
  const [loadingSources, setLoadingSources] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [sourcePage, setSourcePage] = useState(0)
  const [sourceRevision, setSourceRevision] = useState(0)
  const [financialEditable, setFinancialEditable] = useState(false)
  const [financialVisible, setFinancialVisible] = useState(false)
  const [pending, setPending] = useState<PendingSupplierReturn | null>(null)
  const [compensationUsd, setCompensationUsd] = useState('')
  const [compensationKhr, setCompensationKhr] = useState('')
  const bootstrapRequestRef = useRef(0)
  const inventoryRequestRef = useRef(0)
  const sourceRequestRef = useRef(0)
  const sourceScopeRef = useRef<ActorReadScope | null>(null)
  const productsBranchRef = useRef('')
  const aliveRef = useRef(true)
  const submitInFlightRef = useRef(false)
  const supplierReturnIdentityRef = useRef<IntentIdentityRef<{ client_request_id: string; return_number: string }>['current']>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      invalidateTrackedRequest(bootstrapRequestRef)
      invalidateTrackedRequest(inventoryRequestRef)
      invalidateTrackedRequest(sourceRequestRef)
    }
  }, [])

  useEffect(() => {
    const requestId = beginTrackedRequest(bootstrapRequestRef)
    let setupWatchdogFired = false
    setLoading(true)
    const setupWatchdog = window.setTimeout(() => {
      if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
      setupWatchdogFired = true
      notify(
        tr('supplier_return_setup_slow', 'Supplier return setup is taking too long. You can retry or close and reopen the form.'),
        'warning',
      )
      setLoading(false)
    }, SUPPLIER_RETURN_SETUP_WATCHDOG_MS)
    const clearSetupWatchdog = () => {
      window.clearTimeout(setupWatchdog)
    }
    async function loadSetup() {
      try {
        const [branchRows, supplierRows] = await withLoaderTimeout(
          () => loadSupplierReturnSetup(),
          'Supplier return setup',
          SUPPLIER_RETURN_SETUP_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        const activeBranches = ((branchRows || []) as BranchRow[]).filter((branch) => branch.is_active)
        setBranches(activeBranches)
        setSuppliers((supplierRows || []) as SupplierRow[])
        setBranchId((current) => {
          if (current && activeBranches.some((branch) => String(branch.id) === String(current))) return current
          const defaultBranchId = activeBranches.find((branch) => branch.is_default)?.id || activeBranches[0]?.id || ''
          return defaultBranchId ? String(defaultBranchId) : ''
        })
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        notify(
          getLoaderErrorMessage(
            error,
            setupWatchdogFired
              ? tr('supplier_return_setup_slow', 'Supplier return setup is taking too long. You can retry or close and reopen the form.')
              : tr('failed_to_load_data', 'Failed to load data'),
          ),
          setupWatchdogFired ? 'warning' : 'error',
        )
      } finally {
        clearSetupWatchdog()
        if (!aliveRef.current || !isTrackedRequestCurrent(bootstrapRequestRef, requestId)) return
        setLoading(false)
      }
    }
    loadSetup()
    return () => {
      clearSetupWatchdog()
      invalidateTrackedRequest(bootstrapRequestRef)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!branchId) {
      invalidateTrackedRequest(inventoryRequestRef)
      productsBranchRef.current = ''
      setLoadingProducts(false)
      setProducts([])
      setSources({})
      return undefined
    }
    const requestId = beginTrackedRequest(inventoryRequestRef)
    if (productsBranchRef.current !== String(branchId)) {
      setProducts([])
      setQuantities({})
      setSources({})
      setSourcePage(0)
      sourceScopeRef.current = null
    }
    setLoadingProducts(true)
    async function loadInventory() {
      try {
        const rows = await withLoaderTimeout(
          () => loadSupplierReturnInventory(branchId),
          'Supplier return inventory',
          SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        const next = ((rows || []) as InventoryProductRow[]).filter((product) => Number(product.display_quantity || 0) > 0)
        productsBranchRef.current = String(branchId)
        setProducts(next)
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        notify(getLoaderErrorMessage(error, tr('failed_to_load_data', 'Failed to load data')), 'error')
      } finally {
        if (!aliveRef.current || !isTrackedRequestCurrent(inventoryRequestRef, requestId)) return
        setLoadingProducts(false)
      }
    }
    loadInventory()
    return () => {
      invalidateTrackedRequest(inventoryRequestRef)
    }
  }, [branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // This picker reads the whole branch inventory in one unpaged, unsearched
  // call (loadSupplierReturnInventory -> GET /api/inventory/summary, which
  // takes no search parameter and answers ORDER BY lower(p.name) ASC), so
  // nothing upstream ever ranked these rows: the operator got the catalogue
  // in alphabetical order with the non-matches removed, which is the
  // reported "not really matched, top to bottom" on the Returns side.
  //
  // Two things were also out of SCOPE rather than merely mis-ordered:
  // barcode was missing from the haystack entirely, so a scan into this box
  // matched nothing at all, and the plain substring test could not see
  // through this catalogue's GTIN-14/EAN-13 leading-zero twins. The
  // barcode-key probe below is the same fold the server applies
  // validated barcode-key relation, and the sort is the shared client mirror of the
  // server ordering contract (utils/searchMatch.ts). A scan still only
  // narrows the list -- the operator picks the row.
  const filteredProducts = useMemo(() => {
    return filterAndRankSupplierReturnProducts(products, search)
  }, [products, search])
  const pageProducts = filteredProducts.slice(sourcePage * 25, (sourcePage + 1) * 25)
  const pageProductIds = pageProducts.map(product => Number(product.id)).join(',')
  useEffect(() => { setSourcePage(0) }, [search])
  useEffect(() => {
    const requestId = beginTrackedRequest(sourceRequestRef)
    const ids = pageProductIds ? pageProductIds.split(',').map(Number) : []
    if (!branchId || !ids.length || pending) { setLoadingSources(false); return }
    const scope = captureActorReadScope('returns')
    setLoadingSources(true)
    setSourceError('')
    async function loadSources() {
      try {
        const module = await loadReturnsTransport()
        const result = await withLoaderTimeout(() => module.getSupplierReturnSourceOptions(Number(branchId), ids), 'Supplier return sources', SUPPLIER_RETURN_INVENTORY_TIMEOUT_MS)
        if (!aliveRef.current || !isTrackedRequestCurrent(sourceRequestRef, requestId)) return
        assertActorReadScope(scope)
        sourceScopeRef.current = scope
        setSources(previous => ({ ...previous, ...Object.fromEntries(result.items.map(item => [String(item.product_id), item])) }))
        setFinancialEditable(result.financial_editable)
        setFinancialVisible(result.financial_visibility)
      } catch (error) {
        if (!aliveRef.current || !isTrackedRequestCurrent(sourceRequestRef, requestId)) return
        if ((error as { status?: number }).status === 403) { setFinancialVisible(false); setFinancialEditable(false) }
        setSourceError(getLoaderErrorMessage(error, tr('supplier_sources_unavailable', 'Stock sources could not be verified. Refresh before selecting quantities.')))
      } finally {
        if (aliveRef.current && isTrackedRequestCurrent(sourceRequestRef, requestId)) setLoadingSources(false)
      }
    }
    void loadSources()
    return () => { invalidateTrackedRequest(sourceRequestRef) }
  }, [branchId, pageProductIds, sourceRevision, Boolean(pending)]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedItems = useMemo<SupplierReturnItem[]>(() => {
    return Object.values(quantities).filter(selection => selection.raw !== '' && Number(selection.raw) > 0).map(selection => ({ ...selection.item, quantity: Number(selection.raw) }))
  }, [quantities])
  const invalidSelection = Object.values(quantities).some(selection => selection.raw !== '' && (!Number.isFinite(Number(selection.raw)) || Number(selection.raw) < 0 || Number(selection.raw) > selection.available))
  const staleSelection = Object.values(quantities).some(selection => {
    if (!(Number(selection.raw) > 0)) return false
    const current = sources[String(selection.item.product_id)]
    if (!current) return true
    if (selection.review !== supplierSourceReview(current, financialVisible, financialEditable)) return true
    if (!selection.source) return Number(selection.raw) > current.ordinary_available
    const tag = current.tagged_sources.find(tag => tag.damaged_lot_id === selection.source!.damaged_lot_id)
    return !tag || tag.stock_condition !== selection.source.stock_condition || tag.batch_id !== selection.source.batch_id || Number(selection.raw) > tag.available
  })

  const totals = useMemo(() => {
    const totalUsd = selectedItems.reduce((sum, item) => sum + (item.quantity * item.cost_price_usd), 0)
    const totalKhr = selectedItems.reduce((sum, item) => sum + (item.quantity * item.cost_price_khr), 0)
    return { totalUsd, totalKhr }
  }, [selectedItems])

  const supplier = suppliers.find((row) => String(row.id) === String(supplierId))
  const defaultCompensationEnabled = settlement === 'refund' || settlement === 'credit'
  const effectiveCompensationUsd = compensationUsd === '' ? (defaultCompensationEnabled ? totals.totalUsd : 0) : Number(compensationUsd || 0)
  const effectiveCompensationKhr = compensationKhr === '' ? (defaultCompensationEnabled ? totals.totalKhr : 0) : Number(compensationKhr || 0)
  const lossUsd = Math.max(0, totals.totalUsd - effectiveCompensationUsd)
  const lossKhr = Math.max(0, totals.totalKhr - effectiveCompensationKhr)
  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: tr('select_branch', 'Select branch') },
    ...branches.map((item) => ({ value: item.id, label: item.name || String(item.id) })),
  ], [branches, t])
  const settlementOptions = useMemo<AppSelectOption[]>(() => SUPPLIER_RETURN_SETTLEMENT_VALUES.map((value) => ({
    value,
    label: {
      refund: tr('settlement_refund', 'Refund'),
      credit: tr('settlement_credit', 'Store credit'),
      replacement: tr('settlement_replacement', 'Replacement'),
      writeoff: tr('settlement_writeoff', 'No compensation'),
    }[value],
  })), [t])

  const updateQty = (key: string, product: SupplierProductSources, source: SupplierTaggedSource | null, raw: string) => {
    setQuantities(previous => ({ ...previous, [key]: { raw, available: source?.available ?? product.ordinary_available, source,
      review: supplierSourceReview(product, financialVisible, financialEditable),
      item: { product_id: product.product_id, product_name: product.product_name, quantity: Number(raw),
        cost_price_usd: product.return_cost_usd ?? 0, cost_price_khr: product.return_cost_khr ?? 0,
        stock_condition: source?.stock_condition ?? 'ordinary', ...(source ? { damaged_lot_id: source.damaged_lot_id } : {}) } } }))
  }

  const submit = async () => {
    if (!pending) {
      if (!branchId) return notify(tr('branch_required', 'Branch is required'), 'error')
      if (!supplierId) return notify(tr('supplier_required', 'Supplier is required'), 'error')
      if (!reason.trim()) return notify(tr('return_reason_required', 'Reason is required'), 'error')
      if (!selectedItems.length) return notify(tr('select_items_to_return', 'Select at least one item to return.'), 'error')
      if (invalidSelection || staleSelection || selectedItems.length > 50) return notify(tr('supplier_quantity_invalid', 'Enter a positive quantity within the selected source availability.'), 'error')
      if (!financialVisible || !financialEditable || sourceError || !sourceScopeRef.current) return notify(tr('supplier_sources_unavailable', 'Stock sources could not be verified. Refresh before selecting quantities.'), 'error')
    }

    if (!beginSingleAction(submitInFlightRef)) return
    setSubmitting(true)
    let attempt = pending
    try {
      if (attempt) assertActorReadScope(attempt.scope, false)
      else {
      assertActorReadScope(sourceScopeRef.current!)
      const supplierReturnIntent = {
        cashier_id: user?.id || null,
        cashier_name: user?.name || user?.username || null,
        branch_id: Number(branchId),
        supplier_id: Number(supplierId),
        supplier_name: supplier?.name || null,
        reason: reason.trim(),
        notes: notes.trim() || null,
        settlement,
        supplier_compensation_usd: effectiveCompensationUsd,
        supplier_compensation_khr: effectiveCompensationKhr,
        items: selectedItems,
      }
      const supplierReturnIdentity = identityForIntent(supplierReturnIdentityRef, supplierReturnIntent, () => ({
        client_request_id: createClientRequestId('supplier_return'),
        return_number: `SRET-${businessDateTimeId()}`,
      }))
      const module = await loadReturnsTransport()
      assertActorReadScope(sourceScopeRef.current!)
      const body = module.prepareSupplierReturnRequest({ ...supplierReturnIntent, ...supplierReturnIdentity })
      attempt = { body, scope: captureActorReadScope('returns'), uncertain: false }
      setPending(attempt)
      }
      const result = attempt.result ?? await withWriteTimeout(
        () => createSupplierReturnRequest({ ...attempt!.body }),
        'Create supplier return',
        SUPPLIER_RETURN_CREATE_TIMEOUT_MS,
        (key: string) => tr(key, ''),
      )
      if (!result || typeof result !== 'object' || !Number.isSafeInteger((result as { id?: unknown }).id) || Number((result as { id?: unknown }).id) <= 0
        || (result as { returnNumber?: unknown }).returnNumber !== attempt.body.return_number) throw Object.assign(new Error(tr('supplier_pending_unknown', 'The result is unconfirmed. Retry the original request or check Returns and Stock Changes before closing.')), { code: 'write_outcome_unknown' })
      attempt.result = result
      setPending({ ...attempt })
      assertActorReadScope(attempt.scope, false)
      if (!attempt.notified) {
      notify(tr('supplier_return_success', 'Supplier return processed successfully'), 'success')
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'returns' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'products' } }))
      attempt.notified = true
      }
      await Promise.resolve(onSuccess?.(result))
      // Committed and handed over: the next return, even an identical one, is
      // a new request. (Kept until here so a retry after onSuccess threw
      // replays rather than creating a second return.)
      supplierReturnIdentityRef.current = null
      setPending(null)
      onClose?.()
    } catch (error) {
      const failure = error as { code?: string; outcome?: string; status?: number }
      if (failure.status === 403) { setFinancialVisible(false); setFinancialEditable(false) }
      if (attempt && !attempt.result) {
        const safelyRejected = failure.outcome === 'not_dispatched' || (failure.status === 409 && failure.code === 'write_conflict')
        if (!attempt.uncertain && safelyRejected) setPending(null)
        else { attempt.uncertain = true; setPending({ ...attempt }) }
      }
      notify(getLoaderErrorMessage(error, tr('error', 'Error')), 'error')
    } finally {
      finishSingleAction(submitInFlightRef)
      setSubmitting(false)
    }
  }

  // S4-21: the losable work is the picked supplier plus every quantity typed
  // against a product row. Branch alone is pre-filled noise, so it does not
  // count on its own.
  const supplierReturnDirty = Boolean(supplierId)
    || reason.trim().length > 0
    || notes.trim().length > 0
    || compensationUsd.trim().length > 0
    || compensationKhr.trim().length > 0
    || Object.values(quantities).some((value) => Number(value.raw) > 0)
    || Boolean(pending)
  const summaryRowClass = 'flex justify-between gap-3'
  const summaryLabelClass = 'text-gray-600 dark:text-gray-300'
  const summaryValueClass = 'font-semibold text-gray-800 dark:text-gray-200'
  const authorityCurrent = pending ? isActorReadScopeCurrent(pending.scope, false) : !sourceScopeRef.current || isActorReadScopeCurrent(sourceScopeRef.current, false)
  const sourceLabel = (source: SupplierTaggedSource): string => source.batch_id === null ? tr('stock_without_received_date', 'Without a received date')
    : `${tr('received_date', 'Received date')}: ${formatBatchReceivedDate(source.received_at) ?? tr('unknown', 'Unknown')}${source.batch_number === null ? '' : ` · #${source.batch_number}`}${source.lot_code ? ` · ${source.lot_code}` : ''}`

  return (
    <Modal
      title={tr('return_to_supplier', 'Return to Supplier')}
      onClose={() => onClose?.()}
      size="lg"
      keyboard
      closeDisabled={submitting}
      unsavedChanges={{ dirty: supplierReturnDirty }}
      headerExtra={<InfoHint label={tr('return_to_supplier', 'Return to Supplier')} text={tr('supplier_return_hint', 'Send stock back to supplier and record compensation/loss.')} />}
    >
      {/* The form is on screen from the first paint; only its option lists wait
          for the setup read, and the fields are inert until it lands. */}
      {pending && <p role="status" className="mb-3 rounded-lg border border-amber-300 p-2 text-sm">{!authorityCurrent ? tr('supplier_pending_account', 'This request belongs to the previous account. Close this form and check Returns and Stock Changes.')
        : pending.result ? tr('supplier_pending_refresh', 'The return is recorded. Retry refreshing the list; no new return will be sent.')
          : tr('supplier_pending_unknown', 'The result is unconfirmed. Retry the original request or check Returns and Stock Changes before closing.')}</p>}
      {authorityCurrent && <fieldset disabled={loading || submitting || Boolean(pending)} className="min-w-0 space-y-3 border-0 p-0">
        <div className="grid grid-cols-2 gap-2">
            <AppSelect
              id="supplier-return-branch"
              className="min-w-0"
              buttonClassName="h-10 w-full text-sm"
              value={branchId}
              options={branchOptions}
              onChange={setBranchId}
              ariaLabel={tr('branch', 'Branch')}
              prefix={tr('branch', 'Branch')}
            />
          <ContactPicker
            id="supplier-return-supplier"
            className="min-w-0"
            contacts={suppliers}
            value={supplierId}
            onChange={setSupplierId}
            placeholder={tr('supplier', 'Supplier')}
            ariaLabel={tr('supplier', 'Supplier')}
          />
          <AppSelect
            id="supplier-return-settlement"
            className="min-w-0"
            buttonClassName="h-10 w-full text-sm"
            value={settlement}
            options={settlementOptions}
            onChange={(nextValue) => {
              if (SUPPLIER_RETURN_SETTLEMENT_VALUES.includes(nextValue as SettlementMethod)) {
                setSettlement(nextValue as SettlementMethod)
              }
            }}
            ariaLabel={tr('settlement_method', 'Settlement')}
            prefix={tr('settlement_method', 'Settlement')}
          />
          <div className="flex min-w-0 items-center gap-1">
            <input id="supplier-return-reason" list="supplier-return-reason-presets" className="input min-w-0 flex-1 text-sm" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={tr('reason', 'Reason')} aria-label={tr('reason', 'Reason')} />
            <InfoHint label={tr('reason', 'Reason')} text={tr('return_reason_placeholder', 'Choose a saved reason or type your own')} />
            <datalist id="supplier-return-reason-presets">
              {returnReasonPresets.supplier.map((savedReason) => <option key={savedReason.toLocaleLowerCase()} value={savedReason} />)}
            </datalist>
          </div>
        </div>

        <textarea id="supplier-return-notes" className="input min-h-[56px] w-full resize-none text-sm" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={`${tr('notes', 'Notes')} (${tr('optional', 'optional')})`} aria-label={tr('notes', 'Notes')} />

        <div className="rounded-xl border border-gray-200 p-2 dark:border-gray-700">
          <div className="mb-2 flex items-center gap-1.5">
            <SearchInput
              id="supplier-return-search"
              value={search}
              onChange={setSearch}
              placeholder={tr('search_products', 'Search products…')}
            />
            <ScanSearchButton onDetected={setSearch} t={(key) => tr(key, key)} />
            <InfoHint label={tr('products', 'Products')} text={tr('supplier_return_stock_hint', 'Only products with stock in the selected branch are shown. Returned quantity cannot exceed available stock.')} />
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700">
            {loading || loadingProducts || loadingSources ? (
              <div className="p-2"><Skeleton variant="table" rows={4} /></div>
            ) : filteredProducts.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs leading-relaxed text-gray-400">{tr('no_data', 'No data')}</div>
            ) : (
              <ul>
                {pageProducts.map((product) => {
                  const source = sources[String(product.id)]
                  return (
                    <li key={product.id} data-supplier-return-row="" className="space-y-2 border-t border-gray-100 px-3 py-2 first:border-t-0 dark:border-gray-700">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium text-gray-800 dark:text-gray-200">{product.name}</div>
                        <div className="break-words text-xs leading-relaxed text-gray-400">{product.sku || '-'} / {product.category || '-'}</div>
                        <div className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                          {financialVisible && source && source.return_cost_usd !== undefined && <span>{tr('supplier_return_valuation', 'Return valuation')}: {fmtUSD(source.return_cost_usd ?? 0)} · {fmtKHR(source.return_cost_khr ?? 0)}</span>}
                        </div>
                      </div>
                      {!source ? <p className="text-xs text-amber-700">{tr('supplier_sources_unavailable', 'Stock sources could not be verified. Refresh before selecting quantities.')}</p> : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 text-xs">
                              <strong>{tr('stock_ordinary', 'Ordinary')}</strong> · {tr('available', 'Available')}: {source.ordinary_available}
                              <div className="text-gray-500">{tr('supplier_ordinary_fifo', 'Received dates are used in order; stock without a received date is used last.')}</div>
                            </div>
                            <input className="input w-20 shrink-0 text-center text-sm" type="number" min="0" step="any" max={source.ordinary_available}
                              disabled={!financialVisible || !financialEditable || source.ordinary_available === 0 || Boolean(sourceError)}
                              value={quantities[`${product.id}:ordinary`]?.raw ?? ''} placeholder="0"
                              aria-label={`${tr('quantity', 'Quantity')}: ${product.name} · ${tr('stock_ordinary', 'Ordinary')}`}
                              onChange={event => updateQty(`${product.id}:ordinary`, source, null, event.target.value)} />
                          </div>
                          {source.ordinary_receipts.map(receipt => <div key={receipt.batch_id} className="break-words text-xs text-gray-500">
                            {tr('received_date', 'Received date')}: {formatBatchReceivedDate(receipt.received_at) ?? tr('unknown', 'Unknown')}{receipt.batch_number === null ? '' : ` · #${receipt.batch_number}`}{receipt.lot_code ? ` · ${receipt.lot_code}` : ''}
                            {' · '}{receipt.available}{financialVisible && receipt.source_cost_usd !== undefined && <> · {tr('supplier_source_cost', 'Original source cost (USD)')}: {receipt.source_cost_usd === null ? tr('unknown', 'Unknown') : fmtUSD(receipt.source_cost_usd)}</>}
                          </div>)}
                          {source.ordinary_unlotted > 0 && <div className="text-xs text-gray-500">{tr('stock_without_received_date', 'Without a received date')}: {source.ordinary_unlotted}</div>}
                          {source.tagged_sources.map(tag => <div key={tag.damaged_lot_id} className="flex items-center gap-2 rounded-lg border border-amber-200 p-2 dark:border-amber-800">
                            <div className="min-w-0 flex-1 text-xs">
                              <strong className="text-amber-700 dark:text-amber-300">{tag.stock_condition}</strong> · {tr('available', 'Available')}: {tag.available}
                              <div className="break-words text-gray-500">{sourceLabel(tag)}</div>
                              {financialVisible && tag.source_cost_usd !== undefined && <div className="text-gray-500">{tr('supplier_source_cost', 'Original source cost (USD)')}: {tag.source_cost_usd === null ? tr('unknown', 'Unknown') : fmtUSD(tag.source_cost_usd)}</div>}
                            </div>
                            <input className="input w-20 shrink-0 text-center text-sm" type="number" min="0" step="any" max={tag.available}
                              disabled={!financialVisible || !financialEditable || Boolean(sourceError)} value={quantities[`${product.id}:tag:${tag.damaged_lot_id}:${tag.stock_condition}`]?.raw ?? ''} placeholder="0"
                              aria-label={`${tr('quantity', 'Quantity')}: ${product.name} · ${tag.stock_condition} · #${tag.damaged_lot_id}`}
                              onChange={event => updateQty(`${product.id}:tag:${tag.damaged_lot_id}:${tag.stock_condition}`, source, tag, event.target.value)} />
                          </div>)}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {sourceError && <p role="alert" className="mt-2 text-xs text-rose-600">{sourceError}</p>}
          {staleSelection && <p role="alert" className="mt-2 text-xs text-amber-700">{tr('supplier_selection_changed', 'Stock sources or valuation changed. Remove and select the affected items again before saving.')}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setSourceRevision(value => value + 1)} disabled={loadingSources}><RotateCw className="h-4 w-4" aria-hidden="true" />{tr('refresh', 'Refresh')}</button>
            {filteredProducts.length > 25 && <>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={sourcePage === 0} onClick={() => setSourcePage(value => value - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" />{tr('previous', 'Previous')}</button>
              <span className="text-xs">{sourcePage + 1} / {Math.ceil(filteredProducts.length / 25)}</span>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" disabled={(sourcePage + 1) * 25 >= filteredProducts.length} onClick={() => setSourcePage(value => value + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" />{tr('next', 'Next')}</button>
            </>}
          </div>
          {selectedItems.length > 0 && <ul aria-label={tr('supplier_return_items', 'Selected items')} className="mt-2 space-y-1 text-xs">
            {Object.entries(quantities).filter(([, selection]) => Number(selection.raw) > 0).map(([key, selection]) => <li key={key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words">{selection.item.product_name} · {selection.item.stock_condition === 'ordinary' ? tr('stock_ordinary', 'Ordinary') : selection.item.stock_condition} · {selection.raw}</span>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => setQuantities(previous => { const next = { ...previous }; delete next[key]; return next })}><Trash2 className="h-4 w-4" aria-hidden="true" />{tr('remove', 'Remove')}</button>
            </li>)}
          </ul>}
        </div>

        {financialVisible && <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400" aria-hidden="true">$</span>
            <input
              id="supplier-return-compensation-usd"
              className="input w-full pl-7 text-sm"
              type="number"
              min="0"
              step="0.01"
              value={compensationUsd}
              onChange={(event) => setCompensationUsd(event.target.value)}
              placeholder={String(defaultCompensationEnabled ? totals.totalUsd.toFixed(2) : '0')}
              aria-label={tr('supplier_compensation_usd', 'Supplier compensation (USD)')}
              title={tr('supplier_compensation_usd', 'Supplier compensation (USD)')}
            />
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400" aria-hidden="true">៛</span>
            <input
              id="supplier-return-compensation-khr"
              className="input w-full pl-7 text-sm"
              type="number"
              min="0"
              step="1"
              value={compensationKhr}
              onChange={(event) => setCompensationKhr(event.target.value)}
              placeholder={String(defaultCompensationEnabled ? Math.round(totals.totalKhr) : 0)}
              aria-label={tr('supplier_compensation_khr', 'Supplier compensation (KHR)')}
              title={tr('supplier_compensation_khr', 'Supplier compensation (KHR)')}
            />
          </div>
        </div>}

        {financialVisible && <div className="space-y-1 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-700/40">
          <div className={summaryRowClass}>
            <span className={summaryLabelClass}>{tr('supplier_return_items', 'Selected items')}</span>
            <span className={summaryValueClass}>{selectedItems.length}</span>
          </div>
          <div className={summaryRowClass}>
            <span className={summaryLabelClass}>{tr('total_cost', 'Total cost')}</span>
            <span className={summaryValueClass}>{fmtUSD(totals.totalUsd)}</span>
          </div>
          <div className={summaryRowClass}>
            <span className={summaryLabelClass}>{tr('supplier_compensation', 'Compensation')}</span>
            <span className={summaryValueClass}>{fmtUSD(effectiveCompensationUsd)}</span>
          </div>
          <div className={summaryRowClass}>
            <span className={`flex items-center gap-1 ${summaryLabelClass}`}>
              {tr('business_loss', 'Business loss')}
              <InfoHint label={tr('business_loss', 'Business loss')} text={tr('supplier_return_summary_hint', 'Loss = total cost - supplier compensation. This affects inventory valuation and return accounting.')} align="left" />
            </span>
            <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtUSD(lossUsd)}</span>
          </div>
          <p className="text-xs leading-relaxed text-gray-400">
            {fmtKHR(totals.totalKhr)} / {fmtKHR(effectiveCompensationKhr)} / {fmtKHR(lossKhr)}
          </p>
        </div>}
      </fieldset>}

      <div className="sticky bottom-0 -mx-3 -mb-3 mt-3 flex border-t border-gray-200 bg-white px-3 pb-3 pt-3 dark:border-gray-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
        <button type="button" className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 disabled:opacity-50" onClick={submit} disabled={!authorityCurrent || submitting || (!pending && (loading || loadingProducts || loadingSources || !financialVisible || !financialEditable || Boolean(sourceError)))}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {pending ? tr('retry', 'Retry') : tr('save', 'Save')}
        </button>
      </div>
    </Modal>
  )
}
