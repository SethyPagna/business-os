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
  | 'unknown'

export interface ImportTemplateDetection {
  type: DetectedImportType
  // The header cells that decided it -- shown in the routing plan so the
  // operator can see WHY a file was classified, not just trust it.
  signals: string[]
  header: string[]
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
