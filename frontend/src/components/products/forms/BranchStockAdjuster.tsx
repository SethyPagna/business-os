import { todayStr } from '../../../utils/dateHelpers.ts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'
import { getProductBatches, type ProductBatch } from '../../../api/batchesTransport.ts'
import { getInventoryReasons, saveInventoryReasons } from '../../../api/methods.ts'
import { batchDisplayLabel } from '../../../utils/batchLabel.ts'
import { dateToBatchCode } from '../../../utils/batchCode.ts'
// Reused as-is (not re-styled) from Inventory's own "Adjust stock" modal --
// same "Manage reasons" flow, same saved-reason catalog, same component.
// Per the standing rule that this form's stock UI should look and behave
// like Inventory's rather than growing its own parallel version of it.
import InventoryReasonManagerModal from '../../inventory/InventoryReasonManagerModal.tsx'
import ConfirmDialog, { type ConfirmReviewItem } from '../../shared/ConfirmDialog.tsx'
import SupplierPickerField from '../../shared/SupplierPickerField.tsx'
import InfoHint from '../../shared/InfoHint.tsx'
import { isStockInSubmission, stockReceiptGateCode, STOCK_RECEIPT_GATE_FALLBACKS, STOCK_RECEIPT_GATE_KEYS, type StockReceiptGateCode } from '../../../utils/stockReceiptFields.ts'
import DateEntryInput from '../../shared/DateEntryInput.tsx'

const BRANCH_STOCK_ADJUSTMENT_TIMEOUT_MS = 12000

// All received-date defaults use the fixed Cambodia business calendar day.
function todayIsoDate(): string {
  return todayStr()
}

type Translate = (key: string) => string | undefined
type StockAdjustmentType = 'add' | 'remove' | 'set'
type InventoryReasonType = 'adjust' | 'transfer' | 'move' | 'delete'

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
}

type Branch = {
  id: number | string
  name: string
}

type BranchStockEntry = {
  branch_id?: number | string | null
  quantity?: unknown
}

type Product = {
  id: number | string
  name: string
  unit?: string
  cost_price_usd?: number
  cost_price_khr?: number
  branch_stock?: BranchStockEntry[]
  is_group?: number | boolean | null
}

type User = {
  id?: number | string
  name?: string
} | null | undefined

type BranchStockRow = {
  branchId: number | string
  branchName: string
  current: number
  delta: string
  type: StockAdjustmentType
  // '' = nothing picked yet (blocks submit on a flat row's add/remove),
  // 'new' = create a fresh batch (add only), otherwise an existing
  // batch's id. Mirrors InventoryStockModals.tsx's AdjustForm.batch_id --
  // see that file's own comment for why this rides as a plain string/
  // number rather than its own richer type.
  batchId: number | string | ''
  // D4 (11.28): the REAL received date for stock recorded late. Only sent
  // when this row creates a lot (add + "New batch"); an existing lot keeps
  // its own date (first attribution sticks, enforced server-side).
  receivedDate: string
  // D5a: who this add was bought from. supplierId only ever comes from
  // picking a contact suggestion; free text stays a name-only attribution.
  // The row component CLEARS both when an already-attributed lot is picked
  // (first attribution sticks -- see StockAdjustBranchRow), so the submit
  // below can trust the row state to be honest.
  supplierId: number | null
  supplierName: string
}

type AdjustStockPayload = {
  productId: number | string
  productName: string
  type: StockAdjustmentType
  quantity: number
  branchId: number | string
  // N14-D: optional, and absent for a remove. Never the product's stored
  // cost_price_usd -- that answered "what did this receipt cost?" with the
  // catalogue, and `|| 0` recorded free goods nobody declared.
  unitCostUsd?: number
  freeGoods?: boolean
  reason: string
  userId?: number | string
  userName?: string
  batchId?: number | string
  receivedDate?: string
  supplierId?: number
  supplierName?: string
}

type ApiResult = {
  success?: boolean
  error?: string
}

type ProductApi = {
  adjustStock: (payload: AdjustStockPayload) => Promise<ApiResult | undefined>
}

type BranchStockAdjusterProps = {
  product: Product
  branches: Branch[]
  user?: User
  onDone: () => void
  t?: Translate
}

function getProductApi(): ProductApi {
  return (window as unknown as { api: ProductApi }).api
}

function parseStockDelta(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

// --- ONE rule per question, asked by the fields on screen AND by the wire ---
//
// N14-D repair. This form used to ask three different questions about the same
// row: the submit gate asked isStockInSubmission (add, or a `set` above what
// the branch holds -- the rule routes/inventory.ts and
// cloudflare/src/lib/stockReceiptGate.ts apply), the supplier field rendered on
// `row.type === 'add' && row.batchId !== ''`, and the payload sent the supplier
// on `row.type === 'add'`. A `set` that RAISED a branch's stock therefore hit a
// hard dead end: the gate refused it with "Choose the supplier these goods came
// from." while no supplier field existed anywhere on the row to answer with,
// and had one existed its value would still have been dropped from the body.
//
// Same repair, same reason, as InventoryStockModals.tsx:583 -- a field the gate
// demands must never be a field the form declines to render. Keeping these as
// functions the render and the submit both call is what makes that structural
// rather than a coincidence of two matching expressions.

/** This row is about to be submitted at all: a non-negative quantity typed. */
function rowIsPending(row: Pick<BranchStockRow, 'delta'>): boolean {
  return row.delta !== '' && parseStockDelta(row.delta) >= 0
}

/** This row puts stock IN, so it owes a supplier and a unit cost. */
function rowIsStockIn(row: Pick<BranchStockRow, 'type' | 'delta' | 'current'>): boolean {
  return isStockInSubmission(row.type, parseStockDelta(row.delta), row.current)
}

/** The receipt fields belong on this row: pending, and a stock-in. */
function rowShowsReceiptFields(row: Pick<BranchStockRow, 'type' | 'delta' | 'current'>): boolean {
  return rowIsPending(row) && rowIsStockIn(row)
}

/**
 * This row creates or date-matches its OWN lot, so the operator may state the
 * real received date for it -- the same rule the single-target form applies
 * (Inventory.tsx:1210, InventoryStockModals.tsx:550): a "New batch" add, or a
 * `set`, which has no batch picker (there is nothing to pick against a total)
 * and so always creates or date-matches a lot server-side.
 */
function rowCreatesLot(row: Pick<BranchStockRow, 'type' | 'delta' | 'current' | 'batchId'>): boolean {
  if (!rowShowsReceiptFields(row)) return false
  return row.type === 'set' || row.batchId === 'new'
}

export default function BranchStockAdjuster({ product, branches, user, onDone, t }: BranchStockAdjusterProps) {
  const [rows, setRows] = useState<BranchStockRow[]>(
    branches.map((branch) => {
      const branchStock = (product.branch_stock || []).find((item) => item.branch_id === branch.id)
      return {
        branchId: branch.id,
        branchName: branch.name,
        current: Number(branchStock?.quantity ?? 0),
        delta: '',
        type: 'add',
        batchId: '',
        receivedDate: todayIsoDate(),
        supplierId: null,
        supplierName: '',
      }
    }),
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // This form has only ever had one reason for the whole batch of row
  // changes (not per-row), so a single field here (vs.
  // InventoryStockModals.tsx's per-form fields) is consistent with what
  // already existed -- just now sourced from the same saved-reason catalog
  // and picker UI as Inventory's own "Adjust stock" modal, instead of a
  // plain datalist.
  // N14-D: one typed receipt cost for this form's whole batch of row changes,
  // exactly like the single reason below it. Applied to the rows that put stock
  // IN; a remove carries none.
  const [unitCost, setUnitCost] = useState('')
  const [freeGoods, setFreeGoods] = useState(false)
  // N14-D: which row the receipt gate refused and why, so the sentence can be
  // shown AT the control that answers it. `supplier_required` belongs to that
  // row's own supplier picker; the three cost codes belong to the one shared
  // cost field this form has always had. A refusal printed only at the foot of
  // the form is how the set-that-raises dead end stayed invisible.
  const [gateFailure, setGateFailure] = useState<{ branchId: number | string; branchName: string; code: StockReceiptGateCode } | null>(null)
  const [reason, setReason] = useState('')
  // Part 563: the review dialog is open (handleSave validated + opened it;
  // commitBranch runs the per-branch-row writes on confirm).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<ReasonManagerState>({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const saveInFlightRef = useRef(false)
  const isKhmer = /[\u1780-\u17FF]/.test((typeof t === 'function' ? t('cancel') : '') || '')

  const T = (key: string, fallbackEn: string, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  useEffect(() => {
    let cancelled = false
    getInventoryReasons()
      .then((result) => {
        if (cancelled) return
        const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: InventoryReason[] }).items : []
        setInventoryReasons(items)
      })
      .catch(() => { if (!cancelled) setInventoryReasons([]) })
    return () => { cancelled = true }
  }, [])
  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])
  // Mirrors Inventory.tsx's saveReasonCatalog/addSavedReason/
  // renameSavedReason/deleteSavedReason exactly -- same catalog, same
  // pending-review handling, just called from here too instead of only
  // from the Inventory page.
  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await saveInventoryReasons(nextItems) as { pending?: boolean; items?: InventoryReason[] } | undefined
      if (result?.pending) {
        setMsg(T('reason_submitted_for_review', 'Submitted for review -- changes will appear once approved.', 'បានដាក់ស្នើសម្រាប់ការត្រួតពិនិត្យ — ការផ្លាស់ប្តូរនឹងបង្ហាញនៅពេលអនុម័ត។'))
        return inventoryReasons
      }
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons])
  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])
  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(T('rename_reason_prompt', 'Rename saved reason', 'ប្តូរឈ្មោះមូលហេតុដែលបានរក្សាទុក'), entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => (item.id === entry.id ? { ...item, label: nextLabel.trim() } : item))
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(T('delete_saved_reason_confirm', 'Delete this saved reason?', 'លុបមូលហេតុដែលបានរក្សាទុកនេះ?'))) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const runBranchStockMutation = useCallback((loader: () => Promise<ApiResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, BRANCH_STOCK_ADJUSTMENT_TIMEOUT_MS)
  ), [])

  const setRow = (index: number, patch: Partial<Pick<BranchStockRow, 'delta' | 'type' | 'batchId' | 'receivedDate' | 'supplierId' | 'supplierName'>>) => {
    // Any edit answers (or invalidates) the last refusal, so it stops being
    // shown against a control the operator has since changed.
    setGateFailure(null)
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )))
  }

  // The rows about to be submitted (a delta typed, non-negative). One place
  // owns this so validate, the review summary, and the write all agree.
  const pendingChanges = () => rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => rowIsPending(row))

  // N14-D: the receipt fields are on screen only when at least one pending row
  // actually puts stock in. The cost field carries a red `*` and `required`, so
  // showing it for a form whose every change is a removal promised a rule the
  // gate does not apply -- and hiding it is the same call
  // InventoryStockModals.tsx makes with its own `isStockIn`.
  const receiptRowCount = rows.filter((row) => rowShowsReceiptFields(row)).length

  // Part 563: validate, then open the review dialog. commitBranch runs the
  // actual per-row writes once the operator confirms.
  const handleSave = () => {
    if (saving) return
    const changes = pendingChanges()
    if (!changes.length) return
    // Mirrors Inventory.tsx's onAdjust / InventoryStockModals.tsx's transfer
    // form -- a stock change with no documented cause is blocked client-side
    // here too, backing up routes/inventory.ts's /adjust requiring `reason`.
    if (!reason.trim()) {
      setMsg(T('adjust_reason_required', 'A reason is required for this stock adjustment.', 'ត្រូវការមូលហេតុសម្រាប់ការកែស្តុកនេះ'))
      return
    }
    // Same rule as InventoryStockModals.tsx/Inventory.tsx's onAdjust --
    // "this form's own rule, not the wire contract's" (routes/inventory.ts
    // still accepts a missing batchId from other callers like undo/redo).
    // Checked up front for every row about to be submitted, before any
    // write happens, so a later row's missing batch can't leave earlier
    // rows applied and a later one silently untracked. Applies to EVERY
    // product incl. is_group containers (D4b) -- container adds create
    // container batches server-side, so the pick is just as mandatory.
    for (const { row } of changes) {
      if (row.type === 'set') continue
      if (row.batchId === '') {
        setMsg(T('select_batch_required', 'Select a batch first', 'សូមជ្រើសរើសបាច់ជាមុនសិន'))
        return
      }
      if (row.type === 'remove' && row.batchId === 'new') {
        setMsg(T('select_batch_required', 'Select a batch first', 'សូមជ្រើសរើសបាច់ជាមុនសិន'))
        return
      }
    }
    setMsg(null)
    setConfirmOpen(true)
  }

  const buildBranchReviewItems = (): ConfirmReviewItem[] => {
    const items: ConfirmReviewItem[] = pendingChanges().map(({ row }) => {
      const typeLabel = row.type === 'remove' ? T('remove', 'Remove', 'ដក') : row.type === 'set' ? T('set', 'Set', 'កំណត់') : T('add', 'Add', 'បន្ថែម')
      return {
        label: row.branchName,
        value: `${typeLabel} ${parseStockDelta(row.delta)}${product.unit ? ` ${product.unit}` : ''}`,
      }
    })
    const trimmedReason = reason.trim()
    if (trimmedReason) items.push({ label: T('reason', 'Reason', 'មូលហេតុ'), value: trimmedReason })
    return items
  }

  const commitBranch = async () => {
    setConfirmOpen(false)
    const changes = pendingChanges()
    if (!changes.length) return
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return

    // N14-D: the same rule routes/inventory.ts enforces, checked before the
    // first row is submitted. Only rows creating a NEW lot are gated on the
    // supplier here: a row topping up an existing lot inherits that lot's
    // supplier (first attribution sticks), and only the server can see whether
    // the picked lot is attributed -- so it makes that call, authoritatively.
    for (const { row } of changes) {
      if (!rowIsStockIn(row)) continue
      const createsLot = row.batchId === '' || row.batchId === 'new'
      const gate = stockReceiptGateCode({
        isStockIn: true,
        supplierName: row.supplierName,
        lotAttributionDeferred: !createsLot,
        unitCostUsd: unitCost,
        freeGoods,
      })
      if (gate) {
        finishSingleAction(saveInFlightRef)
        // Shown at the control that answers it, not only down here: the row's
        // own supplier picker for `supplier_required`, the shared cost field
        // for the three cost codes.
        setMsg(null)
        setGateFailure({ branchId: row.branchId, branchName: row.branchName, code: gate })
        return
      }
    }

    setSaving(true)
    setMsg(null)
    try {
      for (const { row } of changes) {
        const result = await runBranchStockMutation(() => getProductApi().adjustStock({
          productId: product.id,
          productName: product.name,
          type: row.type,
          quantity: parseStockDelta(row.delta),
          branchId: row.branchId,
          unitCostUsd: rowIsStockIn(row) ? Number(unitCost) : undefined,
          freeGoods: freeGoods ? true : undefined,
          reason: `${reason.trim()} (${row.branchName})`,
          userId: user?.id,
          userName: user?.name,
          batchId: row.type !== 'set' && row.batchId !== '' ? row.batchId : undefined,
          // Sent only when the date input was actually on screen -- a lingering
          // value must never silently re-date some other kind of change. Same
          // predicate the field renders on (rowCreatesLot), which since N14-D
          // includes a `set` that raises stock: it has no picker, so the add it
          // becomes always creates or date-matches a lot of its own.
          receivedDate: rowCreatesLot(row) && row.receivedDate ? row.receivedDate : undefined,
          // D5a / N14-D: every stock-in row, which is an add AND a `set` above
          // what the branch holds -- exactly the rows whose supplier picker is
          // on screen, and exactly the rows the gate above demands one from.
          // The row component already cleared these when an attributed lot was
          // picked, so what's here is exactly what the person saw on screen.
          supplierId: rowIsStockIn(row) && row.supplierId != null ? row.supplierId : undefined,
          supplierName: rowIsStockIn(row) && row.supplierName.trim() ? row.supplierName.trim() : undefined,
        }), 'Adjust branch product stock')
        if (result?.success === false) throw new Error(result?.error || 'Failed to adjust branch stock')
      }
      setMsg(T('stock_updated', 'Stock updated', 'បានធ្វើបច្ចុប្បន្នភាពស្តុក'))
      setGateFailure(null)
      setRows((current) => current.map((row) => ({ ...row, delta: '', batchId: '', receivedDate: todayIsoDate(), supplierId: null, supplierName: '' })))
      onDone()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : T('unknown_error', 'Unknown error', 'មានបញ្ហាមិនស្គាល់'))
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {T('stock_by_branch', 'Stock by Branch', 'ស្តុកតាមសាខា')}
      </label>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <StockAdjustBranchRow
            key={row.branchId}
            row={row}
            productId={product.id}
            unit={product.unit}
            onChange={(patch) => setRow(index, patch)}
            supplierGateError={gateFailure && gateFailure.code === 'supplier_required' && gateFailure.branchId === row.branchId
              ? T(STOCK_RECEIPT_GATE_KEYS.supplier_required, STOCK_RECEIPT_GATE_FALLBACKS.supplier_required, STOCK_RECEIPT_GATE_FALLBACKS.supplier_required)
              : null}
            T={T}
          />
        ))}
      </div>
      {rows.some((row) => rowIsPending(row)) ? (
        <div className="mt-2">
          {/* Same chip-picker + "Manage reasons" pattern as
              InventoryStockModals.tsx's Adjust modal, reading from the
              same saved-reason catalog -- was previously a plain datalist
              here, its own separate (smaller) way of doing the same
              thing. */}
          {/* N14-D: one receipt cost for every row that puts stock in, beside
              the one reason this form has always had. Shown only when a pending
              row IS a stock-in: the field is `required` and carries a red `*`,
              and a form whose every change is a removal owes no cost at all --
              the gate loop skips those rows. Same call InventoryStockModals.tsx
              makes with its own `isStockIn`. */}
          {receiptRowCount > 0 ? (
            <div className="mb-2">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="branch-stock-adjust-unit-cost">
                {T('unit_cost_usd', 'Unit cost $', 'តម្លៃដើមក្នុងមួយឯកតា $')} <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <input
                id="branch-stock-adjust-unit-cost"
                className="input w-full text-sm"
                type="number"
                min="0"
                step="any"
                required
                disabled={freeGoods}
                value={freeGoods ? '0' : unitCost}
                onChange={(event) => { setGateFailure(null); setUnitCost(event.target.value) }}
              />
              <span className="mt-1 flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-400">
                <input type="checkbox" className="h-3.5 w-3.5" checked={freeGoods} onChange={(event) => { setGateFailure(null); setFreeGoods(event.target.checked); if (event.target.checked) setUnitCost('0') }} />
                {T('stock_receipt_free_goods', 'Free goods', 'ទំនិញឥតគិតថ្លៃ')}
                <InfoHint label={T('stock_receipt_free_goods', 'Free goods', 'ទំនិញឥតគិតថ្លៃ')} text={T('stock_receipt_free_goods_hint', 'Tick only when the supplier gave these goods at no cost. The declaration is written onto the receipt.', '')} />
              </span>
              {/* The cost half of the gate's refusal, said at the field that
                  answers it and naming the branch row it came from. */}
              {gateFailure && gateFailure.code !== 'supplier_required' ? (
                <p role="alert" className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                  {gateFailure.branchName}: {T(STOCK_RECEIPT_GATE_KEYS[gateFailure.code], STOCK_RECEIPT_GATE_FALLBACKS[gateFailure.code], STOCK_RECEIPT_GATE_FALLBACKS[gateFailure.code])}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block" htmlFor="branch-stock-adjust-reason">
              {T('reason', 'Reason', 'មូលហេតុ')}
            </label>
            <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'adjust' })}>
              {T('manage_reasons', 'Manage reasons', 'គ្រប់គ្រងមូលហេតុ')}
            </button>
          </div>
          {reasonsByType.adjust.length ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {reasonsByType.adjust.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                  onClick={() => setReason(entry.label)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
          <input
            id="branch-stock-adjust-reason"
            className="input text-sm"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={T('reason_placeholder', 'Choose a saved reason or type your own', 'ជ្រើសរើសមូលហេតុដែលបានរក្សាទុក ឬវាយបញ្ចូលថ្មី')}
          />
        </div>
      ) : null}
      {msg ? <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{msg}</p> : null}
      {rows.some((row) => rowIsPending(row)) ? (
        <button
          className="btn-primary mt-2 w-full text-sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? T('loading', 'Loading...', 'កំពុងរក្សាទុក...') : T('apply_stock_changes', 'Apply Stock Changes', 'អនុវត្តការផ្លាស់ប្តូរស្តុក')}
        </button>
      ) : null}
      <InventoryReasonManagerModal
        addSavedReason={addSavedReason}
        deleteSavedReason={deleteSavedReason}
        reasonDraft={reasonDraft}
        reasonManager={reasonManager}
        reasonsByType={reasonsByType}
        renameSavedReason={renameSavedReason}
        savingReasons={savingReasons}
        setReasonDraft={setReasonDraft}
        setReasonManager={setReasonManager}
        t={t || (() => undefined)}
        tr={(key, fallbackEn, fallbackKm) => T(key, fallbackEn ?? key, fallbackKm)}
      />
      {confirmOpen ? (
        <ConfirmDialog
          t={t || (() => undefined)}
          title={T('apply_stock_changes', 'Apply Stock Changes', 'អនុវត្តការផ្លាស់ប្តូរស្តុក')}
          message={String(product.name || '')}
          items={buildBranchReviewItems()}
          confirmLabel={T('apply_stock_changes', 'Apply Stock Changes', 'អនុវត្តការផ្លាស់ប្តូរស្តុក')}
          cancelLabel={T('cancel', 'Cancel', 'បោះបង់')}
          working={saving}
          workingLabel={T('loading', 'Loading...', 'កំពុងរក្សាទុក...')}
          onConfirm={commitBranch}
          onClose={() => { if (!saving) setConfirmOpen(false) }}
        />
      ) : null}
    </div>
  )
}

type StockAdjustBranchRowProps = {
  row: BranchStockRow
  productId: number | string
  unit?: string
  onChange: (patch: Partial<Pick<BranchStockRow, 'delta' | 'type' | 'batchId' | 'receivedDate' | 'supplierId' | 'supplierName'>>) => void
  /** The gate's `supplier_required` sentence, when it was THIS row's refusal. */
  supplierGateError?: string | null
  T: (key: string, fallbackEn: string, fallbackKm?: string) => string
}

// Split out per-row so each branch's batch-options fetch is an independent
// effect (can't call hooks in a loop from the parent) -- mirrors
// InventoryStockModals.tsx's single-target showBatchPicker/getProductBatches
// pairing, just one instance per row instead of one for the whole modal.
// D4b: the picker shows for EVERY product incl. is_group containers --
// container adds create container batches server-side (unconditional
// auto-routing in routes/inventory.ts), so hiding the picker only hid
// lots that already existed. Name-grouped rows were always flat here.
function StockAdjustBranchRow({ row, productId, unit, onChange, supplierGateError, T }: StockAdjustBranchRowProps) {
  const showBatchPicker = (row.type === 'add' || row.type === 'remove') && row.delta !== ''
  // N14-D: the receipt fields ask the SAME question the submit gate asks
  // (rowIsStockIn), so a `set` that raises this branch's stock -- which
  // routes/inventory.ts writes as an add -- can state the supplier the gate
  // demands. It used to be `row.type === 'add' && row.batchId !== ''`, which
  // rendered nothing for that case and left it unsubmittable.
  const showReceiptFields = rowShowsReceiptFields(row)
  const showReceivedDate = rowCreatesLot(row)
  const [batchOptions, setBatchOptions] = useState<ProductBatch[]>([])
  const [batchLoading, setBatchLoading] = useState(false)

  useEffect(() => {
    if (!showBatchPicker) return
    let cancelled = false
    setBatchLoading(true)
    // 'remove' only offers batches with real stock at this branch, same
    // as Inventory's own picker -- picking an empty lot would just bounce
    // off removeStockFromBatch's InsufficientBatchStockError server-side.
    getProductBatches(productId, row.branchId, row.type === 'remove')
      .then((res) => { if (!cancelled) setBatchOptions(res?.batches || []) })
      // Needed for the same reason as InventoryStockModals.tsx's picker:
      // getProductBatches now propagates failures instead of resolving them
      // as an empty list, so an unhandled rejection would escape here.
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('[BranchStockAdjuster] batch options load failed:', error)
        setBatchOptions([])
      })
      .finally(() => { if (!cancelled) setBatchLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- productId is stable per row, branchId is fixed per row
  }, [showBatchPicker, row.type])

  // Options changed (branch/type switch) -- whatever was picked may not
  // even be in the new list, so clear it rather than let a stale id ride
  // along to submit. The default-to-'new' effect below re-fills it for
  // 'add' once the new list is in.
  useEffect(() => {
    if (showBatchPicker) onChange({ batchId: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBatchPicker, row.type])

  // Default to "new batch" the first time the picker has something to
  // show for an add -- same decided default InventoryStockModals.tsx
  // uses. Remove has no such default (no batch-less removals).
  useEffect(() => {
    if (showBatchPicker && row.type === 'add' && row.batchId === '' && !batchLoading) {
      onChange({ batchId: 'new' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBatchPicker, row.type, row.batchId, batchLoading])

  // Same 1/5/10/20 quick-pick chip row InventoryStockModals.tsx offers
  // under its quantity field, sized down to fit this row's compact layout.
  const quantityChoices = [1, 5, 10, 20]

  // D5a: the same visibility-mirror rule as the received date above. An
  // existing lot that already carries a supplier keeps it (first
  // attribution sticks server-side), so the field locks to that name; an
  // unattributed existing lot still offers the picker (a choice FILLS the
  // blank, which the server honors via COALESCE).
  const selectedLot = row.type === 'add' && row.batchId !== '' && row.batchId !== 'new'
    ? batchOptions.find((batch) => String(batch.id) === String(row.batchId)) || null
    : null
  const lotAttributedName = selectedLot?.supplier_name?.trim() || null
  // Keep the row state honest: whatever rides to submit is what the person
  // saw. A locked lot clears any previously typed choice.
  useEffect(() => {
    if (lotAttributedName && (row.supplierId != null || row.supplierName !== '')) {
      onChange({ supplierId: null, supplierName: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotAttributedName])

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 truncate text-sm text-gray-700 dark:text-gray-300">{row.branchName}</span>
        <span className={`w-16 text-right text-sm font-bold ${row.current > 0 ? 'text-green-600' : 'text-gray-400'}`}>
          {row.current} {unit}
        </span>
      </div>
      {/* Add/Remove/Set as a segmented button group -- same shape as
          InventoryStockModals.tsx's Adjust-stock modal, in place of the
          plain dropdown this row used to have for the same three choices. */}
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {([['add', `+ ${T('add', 'Add')}`], ['remove', `- ${T('remove', 'Remove')}`], ['set', `= ${T('set', 'Set')}`]] as [StockAdjustmentType, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange({ type: value, batchId: '' })}
            className={`rounded-lg border-2 py-1 text-[11px] font-medium ${row.type === value ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-1.5">
        <input
          className="input w-full py-1 text-xs"
          type="number"
          min="0"
          placeholder={row.type === 'set'
            ? `${T('total', 'Total', 'សរុប')} ${T('stock', 'stock', 'ស្តុក')}`
            : T('qty_short', 'Qty', 'ចំនួន')}
          value={row.delta}
          onChange={(event) => onChange({ delta: event.target.value })}
        />
        {row.type === 'set' && row.delta !== '' && Number.isFinite(parseStockDelta(row.delta)) ? (
          <div className="mt-1 flex items-center gap-1 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
            <span>{T('current_stock', 'Current stock', 'ស្តុកបច្ចុប្បន្ន')}: {row.current} → {T('total', 'Total', 'សរុប')}: {parseStockDelta(row.delta)} (Δ {parseStockDelta(row.delta) - row.current >= 0 ? '+' : ''}{parseStockDelta(row.delta) - row.current})</span>
            {/* The Δ line is the one place the operator can see WHICH WAY this
                set goes, so it is where the reason the receipt fields appeared
                belongs -- as a hint, not a paragraph. */}
            {showReceiptFields ? (
              <InfoHint
                label={T('set', 'Set', 'កំណត់')}
                text={T('stock_set_up_hint', 'This set raises the quantity, so it puts stock in: name the supplier it came from and the unit cost you paid, exactly as an add does.', 'ការកំណត់នេះបង្កើនបរិមាណ ដូច្នេះវាបញ្ចូលស្តុក៖ ត្រូវបញ្ជាក់អ្នកផ្គត់ផ្គង់ និងថ្លៃដើមក្នុងមួយឯកតា ដូចការបន្ថែមដែរ។')}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {quantityChoices.map((n) => (
            <button
              key={n}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${Number(row.delta) === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
              onClick={() => onChange({ delta: String(n) })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {showBatchPicker ? (
        <div className="mt-1.5 pl-1">
          <label className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
            {row.type === 'add' ? T('batch', 'Batch') : T('batch_to_remove_from', 'Batch to remove from')} *
          </label>
          {batchLoading ? (
            <div className="text-[11px] text-gray-400">{T('loading', 'Loading...', 'កំពុងផ្ទុក...')}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {row.type === 'add' ? (
                <button
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium border ${row.batchId === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                  onClick={() => onChange({ batchId: 'new' })}
                >
                  {T('new_batch', '+ New batch')}
                </button>
              ) : null}
              {batchOptions.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium border ${String(row.batchId) === String(batch.id) ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}
                  onClick={() => onChange({ batchId: batch.id })}
                >
                  {batchDisplayLabel(batch, T('batch', 'Batch'))} ({batch.quantity})
                </button>
              ))}
              {!batchOptions.length && row.type === 'remove' ? (
                <div className="text-[11px] text-gray-400">{T('no_batches_with_stock', 'No batches with stock in this branch')}</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {/* D4 (11.28): recording stock late may carry the REAL received date --
          same field + default ReceiveBatchModal has. Shown when this row makes
          a lot of its own: a "New batch" add, or a `set` that raises stock
          (which has no picker, so the add it becomes always creates or
          date-matches one). An existing lot keeps its own date. The code
          preview matters because the date DERIVES the lot code, and a matching
          code tops up that lot instead of creating a twin -- the same rule the
          Receive Batch modal documents.
          Outside the batch-picker block since N14-D: a `set` has no picker, and
          nesting the field inside it was half of why a raising set could state
          nothing about itself. */}
      {showReceivedDate ? (
        <div className="mt-1.5 pl-1">
          <label className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">
            {T('received_date', 'Received date', 'ថ្ងៃទទួលស្តុក')}
          </label>
          {/* Typed, not a native picker (Sep 3): this is the add-stock
              row's own received date, and it derives the lot code. */}
          <DateEntryInput
            className="w-full py-1"
            // This row only receives the fallback-aware T; hand the field
            // a bare lookup so its own messages still use the pack.
            t={(key: string) => T(key, key)}
            ariaLabel={T('received_date', 'Received date', 'ថ្ងៃទទួលស្តុក')}
            value={row.receivedDate}
            onChange={(iso) => onChange({ receivedDate: iso })}
          />
          <div className="mt-1 text-[10px] text-gray-400">
            {T('batch_code_preview', 'Batch code', 'កូដបាច់')}: {dateToBatchCode(row.receivedDate) || '--'}
          </div>
        </div>
      ) : null}
      {/* D5a: supplier attribution for the lot this receipt creates or fills --
          same picker, same rules as ReceiveBatchModal and Inventory's Adjust
          modal.
          N14-D repair: rendered on rowShowsReceiptFields, which is EXACTLY the
          predicate the gate loop and the payload above apply. It used to be
          `row.type === 'add' && row.batchId !== ''` and lived inside the
          add/remove batch-picker block, so a `set` that RAISED the branch's
          stock -- a receipt the Worker gates like any other -- was refused for
          a supplier by a row that rendered no supplier field. A field the gate
          demands must never be a field the form declines to render. */}
      {showReceiptFields ? (
        <div className="mt-1.5 pl-1">
          <SupplierPickerField
            idPrefix={`branch-stock-${row.branchId}`}
            value={{ supplierId: row.supplierId, supplierName: row.supplierName }}
            onChange={(next) => onChange({ supplierId: next.supplierId, supplierName: next.supplierName })}
            tr={(key, fallbackEn, fallbackKm) => T(key, fallbackEn ?? key, fallbackKm)}
            lockedName={lotAttributedName}
            hint={selectedLot && !lotAttributedName
              ? T('supplier_will_fill_lot', 'This lot has no supplier yet — your choice will be recorded on it.', 'ឡូតនេះមិនទាន់មានអ្នកផ្គត់ផ្គង់ — ជម្រើសរបស់អ្នកនឹងត្រូវកត់ត្រាលើវា។')
              : null}
          />
          {/* The gate's own sentence, said at the field that answers it. */}
          {supplierGateError ? (
            <p role="alert" className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{supplierGateError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
