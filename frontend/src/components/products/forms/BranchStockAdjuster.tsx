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
  unitCostUsd: number
  unitCostKhr: number
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
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )))
  }

  // The rows about to be submitted (a delta typed, non-negative). One place
  // owns this so validate, the review summary, and the write all agree.
  const pendingChanges = () => rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.delta !== '' && parseStockDelta(row.delta) >= 0)

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
          unitCostUsd: product.cost_price_usd || 0,
          unitCostKhr: product.cost_price_khr || 0,
          reason: `${reason.trim()} (${row.branchName})`,
          userId: user?.id,
          userName: user?.name,
          batchId: row.type !== 'set' && row.batchId !== '' ? row.batchId : undefined,
          // Sent only when the date input was actually on screen (add +
          // "New batch") -- a lingering value must never silently re-date
          // some other kind of change.
          receivedDate: row.type === 'add' && row.batchId === 'new' && row.receivedDate ? row.receivedDate : undefined,
          // D5a: adds only. The row component already cleared these when an
          // attributed lot was picked, so what's here is exactly what the
          // person saw on screen.
          supplierId: row.type === 'add' && row.supplierId != null ? row.supplierId : undefined,
          supplierName: row.type === 'add' && row.supplierName.trim() ? row.supplierName.trim() : undefined,
        }), 'Adjust branch product stock')
        if (result?.success === false) throw new Error(result?.error || 'Failed to adjust branch stock')
      }
      setMsg(T('stock_updated', 'Stock updated', 'បានធ្វើបច្ចុប្បន្នភាពស្តុក'))
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
            T={T}
          />
        ))}
      </div>
      {rows.some((row) => row.delta !== '' && parseStockDelta(row.delta) >= 0) ? (
        <div className="mt-2">
          {/* Same chip-picker + "Manage reasons" pattern as
              InventoryStockModals.tsx's Adjust modal, reading from the
              same saved-reason catalog -- was previously a plain datalist
              here, its own separate (smaller) way of doing the same
              thing. */}
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
      {rows.some((row) => row.delta !== '' && parseStockDelta(row.delta) >= 0) ? (
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
function StockAdjustBranchRow({ row, productId, unit, onChange, T }: StockAdjustBranchRowProps) {
  const showBatchPicker = (row.type === 'add' || row.type === 'remove') && row.delta !== ''
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
          <div className="mt-1 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
            {T('current_stock', 'Current stock', 'ស្តុកបច្ចុប្បន្ន')}: {row.current} → {T('total', 'Total', 'សរុប')}: {parseStockDelta(row.delta)} (Δ {parseStockDelta(row.delta) - row.current >= 0 ? '+' : ''}{parseStockDelta(row.delta) - row.current})
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
          {/* D4 (11.28): recording stock late may carry the REAL received
              date -- same field + default ReceiveBatchModal has. Shown only
              for "New batch": an existing lot keeps its own date. The code
              preview matters because the date DERIVES the lot code, and a
              matching code tops up that lot instead of creating a twin --
              the same rule the Receive Batch modal documents. */}
          {row.type === 'add' && row.batchId === 'new' ? (
            <div className="mt-1.5">
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
          {/* D5a: supplier attribution for the lot this add creates or
              fills -- same picker, same rules as ReceiveBatchModal and
              Inventory's Adjust modal. Adds only: a removal has no
              supplier semantics. */}
          {row.type === 'add' && row.batchId !== '' ? (
            <div className="mt-1.5">
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
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
