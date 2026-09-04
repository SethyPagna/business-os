// S4-12: the header step in front of product creation.
//
// The ask, in the shop owner's words: "add a layer to Add Product: so
// beginning it will have Brand, Supplier, Branch then add new items page
// which is the current add products. so users just have to enter brand,
// supplier, and branch once when add products... same as the session for add
// stock, and will show this in the session".
//
// So this is deliberately the SAME shape as fast stock-in
// (inventory/FastStockInModal.tsx), not a second pattern:
//
//   step 1  header  -- brand + supplier + branch, entered ONCE
//   step 2  items   -- the existing ProductForm, seeded from that header,
//                      reopening ready for the next item after each save
//   session         -- one record carrying the header and every item
//
// Two standing rules this flow had to respect:
//
//  * No minimized / progressive floats. Step 1 is a REAL screen with all
//    three fields rendered from first paint -- never a stub that grows a
//    field once the previous one is answered.
//  * The session must SHOW it. Each item's opening stock is posted through
//    the same receiveBatchStock kernel every add-stock surface uses, tagged
//    with this session's id, so the whole run also lands as ONE row in
//    Stock-in Sessions carrying this session's supplier, branch, line count
//    and total cost -- exactly the session record the owner already reads.
//    The in-modal session panel below shows the same columns live.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus.js'
import Modal from '../shared/Modal.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import SupplierPickerField, { type SupplierChoice } from '../shared/SupplierPickerField.tsx'
import { receiveBatchStock } from '../../api/batchesTransport.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { readWorkDraft, scheduleWorkDraftWrite, clearWorkDraft, writeWorkDraft, scopedWorkDraftKey } from '../../utils/workDrafts.ts'
import {
  canStartCreateProductsSession,
  createProductsSessionDefaults,
  createProductsSessionRow,
  emptyCreateProductsHeader,
  isCreateProductsHeaderDirty,
  openingStockRequest,
  summarizeCreateProductsSession,
  type CreateProductsHeader,
  type CreateProductsSessionDraft,
  type CreateProductsSessionRow,
} from '../../utils/createProductsSession.ts'
// The item step IS ProductForm, so its option/user shapes are the contract
// here too -- imported (type-only, erased at build, so the lazy chunk split
// above stands) rather than re-declared, which is exactly how two same-named
// but unassignable `BranchOption`s appeared the first time.
import type {
  BranchOption,
  CategoryOption,
  GroupCandidate,
  ProductUser,
  UnitOption,
} from './forms/ProductForm'

// The item step IS the current add-product form -- the owner asked for that
// page unchanged, only pre-filled. No parallel product form exists.
const ProductForm = lazyRetry(() => import('./forms/ProductForm'), 'create-products-session-form')

type Translate = (key: string) => string

type CreateProductsSessionModalProps = {
  categories: CategoryOption[]
  units: UnitOption[]
  branches: BranchOption[]
  brandOptions?: string[]
  groupCandidates?: GroupCandidate[]
  defaultBranchId?: string
  /**
   * Writes ONE product and resolves its id. Owned by the products page so
   * this flow reuses the page's existing image-upload + create path rather
   * than minting a second product-writing route.
   */
  onCreateProduct: (payload: Record<string, unknown>) => Promise<number | string>
  onClose: () => void
  /** Refresh the catalog behind the modal once anything was created. */
  onDone: () => void
  notify: (message: string, kind?: string) => void
  t: Translate
  usdSymbol: string
  khrSymbol: string
  exchangeRate: number
  user?: ProductUser | null
}

export default function CreateProductsSessionModal({
  categories,
  units,
  branches,
  brandOptions = [],
  groupCandidates = [],
  defaultBranchId = '',
  onCreateProduct,
  onClose,
  onDone,
  notify,
  t,
  usdSymbol,
  khrSymbol,
  exchangeRate,
  user,
}: CreateProductsSessionModalProps) {
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const draftKey = scopedWorkDraftKey('create_products_session')
  const draftRef = useRef<CreateProductsSessionDraft | null>(
    readWorkDraft<CreateProductsSessionDraft>(draftKey)?.data ?? null,
  )
  const draft = draftRef.current

  const [header, setHeader] = useState<CreateProductsHeader>(
    draft?.header || emptyCreateProductsHeader(defaultBranchId),
  )
  const [rows, setRows] = useState<CreateProductsSessionRow[]>(draft?.rows || [])
  const [step, setStep] = useState<'header' | 'items'>(draft?.step === 'items' ? 'items' : 'header')
  const [itemFormOpen, setItemFormOpen] = useState(false)
  // Bumped after every save so the next item's form REMOUNTS: ProductForm
  // keys its restore/reset effects on product?.id, which stays undefined for
  // every create, so without a fresh key item two would inherit item one's
  // in-memory state.
  const [itemFormSeq, setItemFormSeq] = useState(0)
  const [saving, setSaving] = useState(false)
  const sessionIdRef = useRef(draft?.sessionId || Date.now())
  // One lot date for the whole delivery, captured when the session starts.
  // Not a fourth field -- the owner asked for three -- but shown read-only in
  // the session strip so it is never a hidden default.
  const receivedDateRef = useRef(draft?.receivedDate || todayStr())

  const branchSelectOptions = useMemo(
    () => branches.map((branch) => ({ value: String(branch.id ?? ''), label: String(branch.name || branch.id || '') })),
    [branches],
  )
  const branchNameFor = (branchId: string): string =>
    branchSelectOptions.find((option) => option.value === String(branchId))?.label || ''

  // Stable identity: ProductForm's initialForm memo keys on this prop, so a
  // fresh object every render would recompute it on every keystroke.
  const itemDefaults = useMemo(() => createProductsSessionDefaults(header), [header])

  const summary = useMemo(() => summarizeCreateProductsSession(rows, header, {
    multipleBrands: tr('multiple_brands', 'Multiple brands'),
    multipleSuppliers: tr('mixed_suppliers', 'Multiple suppliers'),
    multipleBranches: tr('multiple_branches', 'Multiple branches'),
    none: tr('none', 'None'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, header, t])

  // Autosave, same cadence and reasoning as the stock-in session draft: the
  // header and the created rows survive a reload, so reopening Add Product
  // resumes this delivery instead of restarting it.
  useEffect(() => {
    return scheduleWorkDraftWrite<CreateProductsSessionDraft>(draftKey, {
      sessionId: sessionIdRef.current, header, rows, step, receivedDate: receivedDateRef.current,
    })
  }, [draftKey, header, rows, step])

  // Branches can still be loading when Add is pressed. Adopt the page
  // default the moment it arrives rather than leaving the operator staring
  // at a disabled "Add items" button with no way to know why.
  useEffect(() => {
    if (!defaultBranchId) return
    setHeader((prev) => (prev.branchId ? prev : { ...prev, branchId: defaultBranchId }))
  }, [defaultBranchId])

  const headerDirty = isCreateProductsHeaderDirty(header, defaultBranchId)
  const canStart = canStartCreateProductsSession(header)

  const startItems = () => {
    if (!canStart) {
      notify(tr('create_products_branch_required', 'Choose the branch this delivery goes to.'), 'error')
      return
    }
    setStep('items')
  }

  const openItemForm = () => {
    // Persist synchronously before the item form replaces this UI, so a
    // reload while the form is open still resumes the session.
    writeWorkDraft<CreateProductsSessionDraft>(draftKey, {
      sessionId: sessionIdRef.current, header, rows, step: 'items', receivedDate: receivedDateRef.current,
    })
    setItemFormOpen(true)
  }

  // One item: create the product, then post its opening stock through the
  // shared kernel under this session's id. The product write and the stock
  // write are separate on purpose -- a stock failure must never make the
  // operator retype a product that already exists.
  const saveItem = async (payload: Record<string, unknown>) => {
    // Never swallow a concurrent submit: returning quietly would let the
    // item form treat an unwritten product as saved.
    if (saving) throw new Error(tr('saving_label', 'Saving…'))
    setSaving(true)
    try {
      const productId = await onCreateProduct({
        ...payload,
        // Opening stock is posted below through receiveBatchStock so it lands
        // in a real lot with this session's supplier and reference. Creating
        // with the quantity too would count the same units twice.
        stock_quantity: 0,
      })
      const row = createProductsSessionRow(payload, header, {
        productId,
        branchName: branchNameFor(String(payload.branch_id ?? header.branchId ?? '')),
      })
      const request = openingStockRequest(row, header, sessionIdRef.current, receivedDateRef.current)
      if (request) {
        try {
          const result = await receiveBatchStock(request) as { lotCode?: string | null }
          row.lotCode = String(result?.lotCode || '')
          row.detail = row.lotCode ? `${tr('lot', 'lot')} ${row.lotCode}` : tr('opening_stock', 'Opening Stock')
        } catch (error) {
          row.status = 'stock_failed'
          row.detail = error instanceof Error ? error.message : tr('failed', 'Failed')
        }
      } else {
        row.detail = tr('product_created', 'Product created')
      }
      setRows((prev) => [row, ...prev])
      setItemFormOpen(false)
      setItemFormSeq((seq) => seq + 1)
      onDone()
      notify(row.status === 'stock_failed'
        ? tr('create_products_stock_failed', 'Product created, but its opening stock could not be posted.')
        : tr('create_products_item_added', 'Added to this session. Enter the next product.'),
        row.status === 'stock_failed' ? 'error' : 'success')
    } catch (error) {
      // Rethrown so ProductForm's own save handler reports it and keeps the
      // typed item on screen to be corrected (a duplicate barcode, say).
      throw error instanceof Error ? error : new Error(tr('failed', 'Failed'))
    } finally {
      setSaving(false)
    }
  }

  const retryOpeningStock = async (row: CreateProductsSessionRow) => {
    if (saving) return
    const request = openingStockRequest(row, header, sessionIdRef.current, receivedDateRef.current)
    if (!request) return
    setSaving(true)
    try {
      const result = await receiveBatchStock(request) as { lotCode?: string | null }
      const lotCode = String(result?.lotCode || '')
      setRows((prev) => prev.map((entry) => entry.key === row.key
        ? { ...entry, status: 'created', lotCode, detail: lotCode ? `${tr('lot', 'lot')} ${lotCode}` : tr('opening_stock', 'Opening Stock') }
        : entry))
      onDone()
    } catch (error) {
      const message = error instanceof Error ? error.message : tr('failed', 'Failed')
      setRows((prev) => prev.map((entry) => entry.key === row.key ? { ...entry, detail: message } : entry))
      notify(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const finish = () => {
    clearWorkDraft(draftKey)
    if (rows.length) onDone()
    onClose()
  }

  // S4-21: this modal used to carry its OWN copy of the discard prompt (a
  // local confirmDiscard flag plus a ConfirmDialog). That copy is gone --
  // the modal now declares `unsavedChanges` and the shared guard in
  // Modal.tsx raises the one app-wide prompt, which is the whole point of
  // the item ("every modal and float in the app, not a one-off").
  // Created items are already written, so they are never what is at risk
  // here -- only the header the operator typed but has not used yet.
  const closeIsGuarded = headerDirty && rows.length === 0
  const requestClose = () => {
    if (saving) return
    finish()
  }

  if (itemFormOpen) {
    return (
      <Suspense fallback={null}>
        <ProductForm
          key={`create-products-item-${itemFormSeq}`}
          product={null}
          createDefaults={itemDefaults}
          categories={categories}
          units={units.length ? units : [{ id: 'pcs', name: 'pcs' }]}
          branches={branches}
          brandOptions={brandOptions}
          groupCandidates={groupCandidates}
          onSave={(payload) => saveItem((payload || {}) as unknown as Record<string, unknown>)}
          onClose={() => setItemFormOpen(false)}
          t={t}
          usdSymbol={usdSymbol}
          khrSymbol={khrSymbol}
          exchangeRate={exchangeRate}
          user={user}
        />
      </Suspense>
    )
  }

  return (
    <Modal
      title={step === 'header'
        ? tr('create_products_session_title', 'Create products session')
        : `${tr('create_products_session_title', 'Create products session')} · ${summary.items}`}
      onClose={requestClose}
      size="lg"
      unsavedChanges={{ dirty: closeIsGuarded }}>
      <div className="space-y-4">
        {/* ---- step 1: the shared header, entered once ---- */}
        <div className={`rounded-xl border p-3 ${step === 'header'
          ? 'border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-900/10'
          : 'border-gray-200 dark:border-gray-700'}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('create_products_header_step', 'Shared details (entered once)')}
            </span>
            {step === 'items' ? (
              <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => setStep('header')}>
                {tr('create_products_edit_header', 'Edit shared details')}
              </button>
            ) : null}
          </div>

          {step === 'header' ? (
            <>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {tr('create_products_header_hint', 'Brand, supplier and branch apply to every product you add in this session — type them once.')}
              </p>
              {/* All three fields render here from first paint. None of them
                  is gated behind answering another. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('brand', 'Brand')}</span>
                  <input
                    className="input w-full text-sm"
                    value={header.brand}
                    list="create-products-brand-options"
                    aria-label={tr('brand', 'Brand')}
                    placeholder={tr('optional', 'Optional')}
                    onChange={(event) => setHeader((prev) => ({ ...prev, brand: event.target.value }))}
                  />
                  <datalist id="create-products-brand-options">
                    {brandOptions.map((brand) => <option key={brand} value={brand} />)}
                  </datalist>
                </label>
                <div className="block">
                  <SupplierPickerField
                    value={{ supplierId: header.supplierId, supplierName: header.supplierName } as SupplierChoice}
                    onChange={(next) => setHeader((prev) => ({ ...prev, supplierId: next.supplierId, supplierName: next.supplierName }))}
                    tr={(key: string, fallbackEn?: string) => tr(key, fallbackEn || key)}
                    idPrefix="create-products-session"
                    hint={tr('create_products_supplier_hint', 'Recorded on the opening stock of every product this session creates.')}
                    hintDisplay="tooltip"
                  />
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('branch', 'Branch')}</span>
                  <AppSelect
                    value={header.branchId}
                    onChange={(next) => setHeader((prev) => ({ ...prev, branchId: next }))}
                    ariaLabel={tr('branch', 'Branch')}
                    buttonClassName="h-9 w-full text-sm"
                    optionClassName="text-sm"
                    options={branchSelectOptions}
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" className="btn-primary flex h-10 items-center gap-1.5 px-4 text-sm disabled:opacity-50"
                  disabled={!canStart} onClick={startItems}>
                  <PackagePlus className="h-4 w-4 shrink-0" />
                  {tr('create_products_start', 'Add items')}
                </button>
              </div>
            </>
          ) : (
            // ---- the session's own header columns, always visible ----
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><dt className="text-[11px] text-gray-500 dark:text-gray-400">{tr('brand', 'Brand')}</dt><dd className="truncate font-medium text-gray-800 dark:text-gray-200">{summary.brand}</dd></div>
              <div><dt className="text-[11px] text-gray-500 dark:text-gray-400">{tr('supplier', 'Supplier')}</dt><dd className="truncate font-medium text-gray-800 dark:text-gray-200">{summary.supplier}</dd></div>
              <div><dt className="text-[11px] text-gray-500 dark:text-gray-400">{tr('branch', 'Branch')}</dt><dd className="truncate font-medium text-gray-800 dark:text-gray-200">{summary.branch}</dd></div>
              <div><dt className="text-[11px] text-gray-500 dark:text-gray-400">{tr('received_date', 'Received date')}</dt><dd className="truncate font-medium tabular-nums text-gray-800 dark:text-gray-200">{receivedDateRef.current}</dd></div>
            </dl>
          )}
        </div>

        {/* ---- step 2: items + what this session has created ---- */}
        {step === 'items' ? (
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {tr('create_products_created', 'Created this session')} ({summary.items})
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                {tr('total_units', 'Total units')}: {summary.units} · {tr('total_cost', 'Total cost')}: {usdSymbol}{summary.costUsd.toFixed(2)}
              </span>
            </div>

            <button type="button" className="btn-primary mb-3 flex h-10 w-full items-center justify-center gap-1.5 text-sm disabled:opacity-50"
              disabled={saving} onClick={openItemForm}>
              <PackagePlus className="h-4 w-4 shrink-0" />
              {tr('create_products_add_item', 'Add item')}
            </button>

            {rows.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                {tr('create_products_none_yet', 'No products created yet in this session. Add your first item — brand, supplier and branch are already filled in.')}
              </p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {rows.map((row) => (
                  <div key={row.key} className="rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                        {row.status === 'stock_failed' ? '⚠️' : '✅'} {row.name}{row.barcode ? ` · ${row.barcode}` : ''}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                        × {row.quantity} · {usdSymbol}{(row.quantity * row.unitCostUsd).toFixed(2)}
                      </span>
                    </div>
                    {/* The session carries the header on every row too, so a
                        row that overrode one of the three still reads true. */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                      <span className="truncate">{tr('brand', 'Brand')}: {row.brand || tr('none', 'None')}</span>
                      <span className="truncate">{tr('supplier', 'Supplier')}: {row.supplierName || tr('none', 'None')}</span>
                      <span className="truncate">{tr('branch', 'Branch')}: {row.branchName || tr('none', 'None')}</span>
                      <span className={`break-words ${row.status === 'stock_failed' ? 'text-red-500' : ''}`}>{row.detail}</span>
                      {row.status === 'stock_failed' ? (
                        <button type="button" className="btn-secondary shrink-0 px-2 py-0.5 text-[10px]" disabled={saving}
                          onClick={() => void retryOpeningStock(row)}>
                          <Boxes className="mr-1 inline h-3 w-3" />{tr('create_products_retry_stock', 'Retry stock')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button type="button" className="btn-secondary h-10 px-4 text-sm" disabled={saving} onClick={requestClose}>
          {tr('close', 'Close')}
        </button>
        {step === 'items' ? (
          <button type="button" className="btn-primary h-10 px-4 text-sm" disabled={saving} onClick={finish}>
            {`✓ ${tr('create_products_finish', 'Finish session')}`}{summary.items > 0 ? ` — ${summary.items}` : ''}
          </button>
        ) : null}
      </div>

    </Modal>
  )
}
