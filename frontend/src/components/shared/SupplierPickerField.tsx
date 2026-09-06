import { useEffect, useMemo, useRef, useState } from 'react'
import InfoHint from './InfoHint.tsx'
import SuggestionTextInput, { type SuggestionOption } from './SuggestionTextInput.tsx'

// D5a: the one supplier picker every manual add-stock/receive surface
// shares (ReceiveBatchModal, InventoryStockModals, BranchStockAdjuster,
// BulkAddStockModal) -- the same cross-surface rule as the D4b batch
// picker: no surface gets a weaker version of the field than its siblings.
//
// Semantics mirror the batch writer's first-attribution-sticks rule
// (cloudflare/src/lib/productBatches.ts receiveBatchStock):
// - picking a suggestion links the lot to a supplier CONTACT (id + name);
// - free text is a deliberate name-only attribution (the same first-class
//   state the import engine writes when a name matches no contact) --
//   it NEVER auto-creates a supplier, matching the import engine's
//   match-only rule;
// - when the surface's selected existing lot already carries a supplier,
//   the caller renders the locked variant (lockedName) instead of a live
//   input, because the server would ignore a new choice (COALESCE) and a
//   control whose value is silently dropped is a lie.
//
// The suggestion list is the name-only suppliers read every role may call
// (GET /contacts/suppliers?fields=names -- see routes/contacts.ts's
// requireSupplierAccess carve-out), loaded lazily on first need and cached
// module-wide so four modals don't fetch four times per session.

type TranslationWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export type SupplierChoice = {
  supplierId: number | null
  supplierName: string
}

type SupplierNameRow = { id: number; name: string }

let supplierNamesCache: { rows: SupplierNameRow[]; at: number } | null = null
const SUPPLIER_NAMES_TTL_MS = 60_000
let supplierSyncListenerInstalled = false

export function invalidateSupplierNamesCache(): void {
  supplierNamesCache = null
}

function ensureSupplierSyncCacheListener(): void {
  if (supplierSyncListenerInstalled || typeof window === 'undefined') return
  supplierSyncListenerInstalled = true
  window.addEventListener('sync:update', (event: Event) => {
    const detail = (event as CustomEvent<{ channel?: string }>).detail
    if (String(detail?.channel || '') === 'suppliers') invalidateSupplierNamesCache()
  })
}

// Exported for other supplier-scoped controls (StockChangeSection's D2
// ledger filter) so they share this one cached name-only read instead of
// re-fetching or re-implementing it.
export async function loadSupplierNames(): Promise<SupplierNameRow[]> {
  ensureSupplierSyncCacheListener()
  if (supplierNamesCache && Date.now() - supplierNamesCache.at < SUPPLIER_NAMES_TTL_MS) {
    return supplierNamesCache.rows
  }
  const mod = await import('../../api/contactsTransport.ts')
  const data = await mod.getSuppliers({ fields: 'names' })
  const rows = Array.isArray(data)
    ? (data as Array<Record<string, unknown>>)
        .map((row) => ({ id: Number(row.id), name: String(row.name || '').trim() }))
        .filter((row) => Number.isFinite(row.id) && row.id > 0 && row.name !== '')
    : []
  supplierNamesCache = { rows, at: Date.now() }
  return rows
}

type SupplierPickerFieldProps = {
  value: SupplierChoice
  onChange: (next: SupplierChoice) => void
  tr: TranslationWithFallback
  // Existing-lot case: the lot's recorded supplier. When set, the field is
  // read-only -- first attribution sticks, so offering a live picker would
  // collect a choice the server ignores.
  lockedName?: string | null
  // Extra context line under the input (e.g. the bulk modal's "applies to
  // every lot" note, or "this lot has no supplier yet -- your choice will
  // be recorded on it").
  hint?: string | null
  /** Keep explanatory copy out of dense forms while retaining touch/keyboard access. */
  hintDisplay?: 'inline' | 'tooltip'
  disabled?: boolean
  idPrefix: string
}

export default function SupplierPickerField({
  value,
  onChange,
  tr,
  lockedName,
  hint,
  hintDisplay = 'inline',
  disabled,
  idPrefix,
}: SupplierPickerFieldProps) {
  const [rows, setRows] = useState<SupplierNameRow[]>([])
  const [loading, setLoading] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ channel?: string }>).detail
      if (String(detail?.channel || '') !== 'suppliers') return
      invalidateSupplierNamesCache()
      // Drop suggestions captured before the rename/merge. The next focus
      // performs the versioned server read; typed free text remains intact.
      setRows([])
    }
    window.addEventListener('sync:update', onSync)
    return () => window.removeEventListener('sync:update', onSync)
  }, [])

  const ensureLoaded = () => {
    if (rows.length || loading) return
    setLoading(true)
    loadSupplierNames()
      .then((loaded) => { if (aliveRef.current) setRows(loaded) })
      .catch(() => { /* suggestions unavailable -- free text still works */ })
      .finally(() => { if (aliveRef.current) setLoading(false) })
  }

  const label = tr('supplier', 'Supplier')

  if (lockedName) {
    return (
      <div className="block">
        <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-300">
          {lockedName}
        </div>
        <span className="mt-1 block text-[11px] text-gray-400">
          {tr('supplier_first_attribution', "Recorded on this lot's first receipt — later receipts never change it.")}
        </span>
      </div>
    )
  }

  // The input + floating list is the ONE shared SuggestionTextInput -- the
  // same control ProductForm's Category/Brand/Unit/Supplier and the
  // create-products header's Brand render. This field adds only what is
  // supplier-specific: the contact id a pick carries, and the locked variant
  // above. Before this, four supplier surfaces and the product form each had
  // their own copy of "input plus a dropdown", and they disagreed (the
  // product form's showed nothing until something was typed).
  const suggestionOptions = useMemo<SuggestionOption[]>(
    () => rows.map((row) => ({
      value: row.name,
      key: `supplier-${row.id}`,
      selected: value.supplierId === row.id,
      payload: row.id,
    })),
    [rows, value.supplierId],
  )

  return (
    <div className="block">
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400">
        <label htmlFor={`${idPrefix}-supplier`}>{label}</label>
        {hint && hintDisplay === 'tooltip' ? <InfoHint text={hint} label={label} /> : null}
      </span>
      <SuggestionTextInput
        id={`${idPrefix}-supplier`}
        value={value.supplierName}
        options={suggestionOptions}
        limit={8}
        disabled={disabled}
        loading={loading}
        loadingLabel={tr('loading', 'Loading...')}
        onRequestOptions={ensureLoaded}
        ariaLabel={label}
        inputClassName="input min-h-11 w-full text-sm"
        placeholder={tr('supplier_optional_placeholder', 'Who this lot was bought from')}
        onChange={(next, option) => {
          // A pick carries the contact id; anything else is typing, and
          // typing breaks the link -- the id only ever comes from an explicit
          // pick, so an edited name can't ride on a stale id.
          if (option) onChange({ supplierId: Number(option.payload), supplierName: option.value })
          else onChange({ supplierId: null, supplierName: next })
        }}
      />
      {hint && hintDisplay === 'inline' ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
      {value.supplierName.trim() !== '' ? (
        <span className="mt-1 block text-[11px] text-gray-400">
          {value.supplierId != null
            ? tr('supplier_linked_note', 'Linked to supplier contact.')
            : tr('supplier_free_text_note', 'Not in contacts — recorded by name only.')}
        </span>
      ) : null}
    </div>
  )
}
