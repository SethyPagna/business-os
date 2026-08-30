import { useEffect, useRef, useState } from 'react'

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

// Exported for other supplier-scoped controls (StockChangeSection's D2
// ledger filter) so they share this one cached name-only read instead of
// re-fetching or re-implementing it.
export async function loadSupplierNames(): Promise<SupplierNameRow[]> {
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
  disabled?: boolean
  idPrefix: string
}

export default function SupplierPickerField({
  value,
  onChange,
  tr,
  lockedName,
  hint,
  disabled,
  idPrefix,
}: SupplierPickerFieldProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<SupplierNameRow[]>([])
  const [loading, setLoading] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
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

  const query = value.supplierName.trim().toLowerCase()
  const matches = (query === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(query))).slice(0, 8)

  const pick = (row: SupplierNameRow) => {
    onChange({ supplierId: row.id, supplierName: row.name })
    setOpen(false)
  }

  return (
    <div className="relative block">
      <label htmlFor={`${idPrefix}-supplier`} className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <input
        id={`${idPrefix}-supplier`}
        className="input w-full text-sm"
        value={value.supplierName}
        disabled={disabled}
        onFocus={() => { setOpen(true); ensureLoaded() }}
        onChange={(event) => {
          // Typing breaks any contact link -- the id only ever comes from an
          // explicit pick, so a edited name can't ride on a stale id.
          onChange({ supplierId: null, supplierName: event.target.value })
          setOpen(true)
          ensureLoaded()
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}
        placeholder={tr('supplier_optional_placeholder', 'Who this lot was bought from')}
        autoComplete="off"
      />
      {open && (loading || matches.length > 0) ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-40 overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-800">
          {loading && !matches.length ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">{tr('loading', 'Loading...')}</div>
          ) : null}
          {matches.map((row) => (
            <button
              key={row.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20"
              // Mousedown so the pick lands before the input's blur closes
              // the menu (click would fire after blur and be lost).
              onMouseDown={(event) => { event.preventDefault(); pick(row) }}
            >
              <span className="font-medium text-gray-800 dark:text-gray-200">{row.name}</span>
              {value.supplierId === row.id ? <span className="text-xs text-blue-500">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
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
