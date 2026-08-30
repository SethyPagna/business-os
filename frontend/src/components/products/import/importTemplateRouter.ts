// N1c(a): "one Import entry point that routes by detected template rather
// than forcing the user to know which page owns which file." Pure
// header-shape classifier -- given the first row of an uploaded sheet,
// name which import engine owns it. Signals are the REAL template columns
// each engine ships (downloadImportTemplate / SALES_IMPORT_COLUMNS /
// CONTACT_IMPORT_CONFIG / the §12 unified stock contract), not guesses;
// anything ambiguous stays 'unknown' with the person choosing, never a
// silent misroute.

export type DetectedImportType =
  | 'products'
  | 'stock_actions'
  | 'sales'
  | 'customers'
  | 'suppliers'
  | 'delivery_contacts'
  | 'deferred_ledger'
  | 'unknown'

// The old-system ledger exports that have NO destination feature yet
// (IMPORT-MANIFEST `later/`). They are recognized BY NAME so the hub can
// say what each file is and why it must wait, instead of a generic
// "columns not recognized" that invites force-routing one into products
// or stock -- which would double-count inventory.
export type DeferredLedgerKind =
  | 'po_invoices'
  | 'stock_adjustments'
  | 'drawer_sessions'
  | 'stock_in_invoice_lines'
  | 'sold_by_supplier_summary'

export const DEFERRED_LEDGER_INFO: Record<DeferredLedgerKind, { label: string; reason: string }> = {
  po_invoices: {
    label: 'Supplier invoice ledger',
    reason: 'Purchase-order invoices need the supplier accounting feature first — no destination exists yet, so importing now would misfile them as contacts or products.',
  },
  stock_adjustments: {
    label: 'Stock adjustment ledger',
    reason: 'Adjustment audit rows need the stock-change ledger feature first — importing them as products or stock actions would change live counts that already include these adjustments.',
  },
  drawer_sessions: {
    label: 'Cash drawer sessions',
    reason: 'Cash-session records need the drawer-session feature first — no destination exists yet.',
  },
  stock_in_invoice_lines: {
    label: 'Stock-in invoice lines',
    reason: 'These lines are already merged into the imported stock history (supplier, cost, branch) — importing them again as stock would double-count inventory. They stay the source for a future supplier-invoice ledger.',
  },
  sold_by_supplier_summary: {
    label: 'Per-supplier sales summary',
    reason: 'A report snapshot, not importable data — its totals are already derivable from the imported sales.',
  },
}

export interface ImportTemplateDetection {
  type: DetectedImportType
  // The header cells that decided it -- shown in the routing plan so the
  // operator can see WHY a file was classified, not just trust it.
  signals: string[]
  header: string[]
  deferredLedger?: DeferredLedgerKind
}

// First non-empty line, split on the delimiter that yields the most cells
// (the same tolerant comma/semicolon/tab family the import parsers accept).
export function readHeaderCells(content: string): string[] {
  const line = String(content || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .find((row) => row.trim().length > 0) || ''
  let best: string[] = []
  for (const delimiter of [',', ';', '\t']) {
    const cells = splitDelimited(line, delimiter)
    if (cells.length > best.length) best = cells
  }
  return best.map((cell) => cell.trim().toLowerCase())
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++ } else quoted = false
      } else current += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      cells.push(current); current = ''
    } else current += ch
  }
  cells.push(current)
  return cells
}

export function classifyImportHeader(headerCells: string[]): ImportTemplateDetection {
  const header = headerCells.map((cell) => String(cell || '').trim().toLowerCase())
  const has = (name: string) => header.includes(name)
  const pick = (...names: string[]) => names.filter((name) => has(name))

  // Deferred ledgers FIRST: each shape is checked by columns that exist in
  // no import template, and matching one must beat every routable type --
  // these files carry data the live tables already account for (or have no
  // destination for), so they are named and kept aside, never routed.
  const deferred = detectDeferredLedger(has, pick)
  if (deferred) {
    return { type: 'deferred_ledger', header, signals: deferred.signals, deferredLedger: deferred.kind }
  }
  // Sales first: receipt_number exists in NO other template.
  if (has('receipt_number')) {
    return { type: 'sales', header, signals: pick('receipt_number', 'sale_date', 'payment_method') }
  }
  // §12 unified stock: an `action` column plus the per-branch quantity
  // columns. (The products template has neither.)
  if (has('action') && (has('shop') || has('warehouse'))) {
    return { type: 'stock_actions', header, signals: pick('action', 'shop', 'warehouse', 'cost_price') }
  }
  // Products: pricing/stock/batch/image columns straight from the template.
  const productSignals = pick('selling_price_usd', 'selling_price_khr', 'stock_quantity', 'batch(mm/dd/yyyy)', 'image_filename_1', 'is_group', 'low_stock_threshold')
  if (productSignals.length >= 1 && has('name') && !has('action')) {
    return { type: 'products', header, signals: productSignals }
  }
  // Contacts family -- each tab's template carries a distinguishing column:
  // customers: membership_number · suppliers: company/contact_person ·
  // delivery: area. A bare name+phone sheet is ambiguous on purpose.
  if (has('membership_number')) {
    return { type: 'customers', header, signals: pick('membership_number', 'phone', 'name') }
  }
  if (has('company') || has('contact_person')) {
    return { type: 'suppliers', header, signals: pick('company', 'contact_person', 'phone', 'name') }
  }
  if (has('area') && has('phone')) {
    return { type: 'delivery_contacts', header, signals: pick('area', 'phone', 'name') }
  }
  return { type: 'unknown', header, signals: [] }
}

// Matched against the REAL exported headers (later/*.csv in the migration
// pack), most specific first. `invoice_no`+`barcode` separates the
// per-line stock-in export from the per-invoice PO ledger, which shares
// `invoice_no`+`supplier` but has no product columns.
function detectDeferredLedger(
  has: (name: string) => boolean,
  pick: (...names: string[]) => string[],
): { kind: DeferredLedgerKind; signals: string[] } | null {
  if (has('invoice_no') && has('barcode')) {
    return { kind: 'stock_in_invoice_lines', signals: pick('invoice_no', 'barcode', 'unit_cost_usd') }
  }
  if (has('invoice_no') && has('supplier')) {
    return { kind: 'po_invoices', signals: pick('invoice_no', 'supplier', 'net_total_usd') }
  }
  if (has('adjustment_no') || (has('before_qty') && has('after_qty'))) {
    return { kind: 'stock_adjustments', signals: pick('adjustment_no', 'before_qty', 'after_qty') }
  }
  if (has('begin_time') && has('end_time')) {
    return { kind: 'drawer_sessions', signals: pick('begin_time', 'end_time', 'drawer_amount', 'actual_usd') }
  }
  if (has('supplier') && (has('sold_qty') || has('sold_lines'))) {
    return { kind: 'sold_by_supplier_summary', signals: pick('supplier', 'sold_qty', 'sold_lines') }
  }
  return null
}

export function classifyImportContent(content: string): ImportTemplateDetection {
  return classifyImportHeader(readHeaderCells(content))
}

// ---------------------------------------------------------------------------
// N1b: per-job option visibility -- "see them recorded per job". One
// reader renders whatever a job's persisted policy actually holds as
// human-readable option lines; unknown keys pass through verbatim rather
// than vanishing (an option that was recorded must be visible, even if
// this list lags a new engine flag).

const POLICY_LABELS: Record<string, { label: string; render?: (value: unknown) => string }> = {
  source: { label: 'Started from' },
  accrue_loyalty: { label: 'Loyalty points', render: (value) => (value ? 'counted for these sales' : 'not counted (historical)') },
  stock_action_mode: { label: 'Stock mode', render: (value) => (String(value) === 'reconcile' ? 'reconcile against live stock' : 'direct add/sale') },
  conflictMode: { label: 'Duplicates', render: (value) => String(value || '') },
  image_conflict_mode: { label: 'Existing images', render: (value) => String(value || '') },
  import_mode: { label: 'Import mode', render: (value) => String(value || '') },
  importMode: { label: 'Import mode', render: (value) => String(value || '') },
}

const HIDDEN_POLICY_KEYS = new Set(['fieldRules', 'field_rules', 'decisions'])

export function describeJobPolicy(policy: unknown): Array<{ key: string; label: string; value: string }> {
  if (!policy || typeof policy !== 'object') return []
  const out: Array<{ key: string; label: string; value: string }> = []
  for (const [key, raw] of Object.entries(policy as Record<string, unknown>)) {
    if (raw == null || raw === '') continue
    if (HIDDEN_POLICY_KEYS.has(key)) continue
    const known = POLICY_LABELS[key]
    if (known) {
      out.push({ key, label: known.label, value: known.render ? known.render(raw) : String(raw) })
    } else if (typeof raw !== 'object') {
      out.push({ key, label: key.replace(/_/g, ' '), value: String(raw) })
    }
  }
  return out
}
