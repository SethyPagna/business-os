import { localizeBranchRuleError } from '../../api/branchRuleErrors.ts'
// The Worker's stock-import review text, restated in the UI language.
//
// The unified stock import (cloudflare/src/lib/stockActionImport.ts) answers each review row with an English
// `message` and a list of warnings. Two of its sentences are about the cutover's branch collapse and must read in the
// operator's language, so:
//
//   - a warning that carries a `code` and `params` is restated from the pack key named after the code
//     (stock_import_branch_routing: "Columns combined at {branch}: {columns} = {total}"); with any param missing it
//     keeps the Worker's own English `message`;
//   - a row `message` is the row's errors joined by a space, so the one reworded sentence below is replaced in place
//     and every other sentence stays as the Worker wrote it.
//
//   - a row that carries a `code` from the inventory import (cloudflare/src/lib/importEngine.ts, INVENTORY_IMPORT_ROW_CODES and
//     the three stock-judging codes) and the `params` its sentence names is restated from the pack key named after the
//     code (IMPORT_ROW_CODES below); with any param missing, or on a row saved before the Worker sent params, it keeps the
//     Worker's English `message`.
//
// Pinned to the Worker's strings and to both packs by tests/importRowText.test.ts,
// cloudflare/scripts/test-cutover-li-pack-parity-pure.cjs and the classifyInventory block of
// cloudflare/scripts/test-import-engine-pure.cjs.

export type ImportReviewWarning = {
  kind?: string
  message?: string
  code?: string
  params?: Record<string, unknown> | null
}

type RowCodeSpec = {
  key: string
  params: readonly string[]
  // A param whose value is a word of the language (the field a product was matched on), looked up as a pack key.
  words?: Readonly<Record<string, Readonly<Record<string, string>>>>
}
const MATCHED_FIELD_WORDS = { field: { sku: 'sku', barcode: 'barcode' } } as const

type Translate = (key: string, fallback: string) => string

// Worker code -> [pack key, the params that sentence needs]. The key is named after the code.
export const IMPORT_WARNING_CODES: Readonly<Record<string, { key: string; params: readonly string[] }>> = {
  stock_import_branch_routing: { key: 'stock_import_branch_routing', params: ['branch', 'columns', 'total'] },
}

// Worker row code -> the pack sentence(s) that restate it, tried in order: the first whose params are all present wins, so
// the apply-time variant of a sentence (it names the rows before it) sits ahead of the plain one.
export const IMPORT_ROW_CODES: Readonly<Record<string, readonly RowCodeSpec[]>> = {
  import_insufficient_branch_stock: [
    { key: 'import_insufficient_branch_stock_after_rows', params: ['onHand', 'branch', 'quantity', 'afterEarlierRows'] },
    { key: 'import_insufficient_branch_stock', params: ['onHand', 'branch', 'quantity'] },
  ],
  import_duplicate_count_row: [{ key: 'import_duplicate_count_row', params: ['row', 'branch'] }],
  import_mixed_direction_rows: [{ key: 'import_mixed_direction_rows', params: ['product', 'branch'] }],
  inventory_import_product_not_found: [{ key: 'inventory_import_product_not_found', params: [] }],
  inventory_import_match_many_products: [{ key: 'inventory_import_match_many_products', params: ['field', 'value', 'count'], words: MATCHED_FIELD_WORDS }],
  inventory_import_match_duplicate_products: [{ key: 'inventory_import_match_duplicate_products', params: ['field', 'value', 'count'], words: MATCHED_FIELD_WORDS }],
  inventory_import_match_other_name: [{ key: 'inventory_import_match_other_name', params: ['field', 'value', 'found', 'given'], words: MATCHED_FIELD_WORDS }],
  inventory_import_name_matches_several: [{ key: 'inventory_import_name_matches_several', params: ['name'] }],
  inventory_import_quantity_invalid: [{ key: 'inventory_import_quantity_invalid', params: [] }],
  inventory_import_quantity_negative: [{ key: 'inventory_import_quantity_negative', params: [] }],
  inventory_import_zero_receipt: [{ key: 'inventory_import_zero_receipt', params: [] }],
  inventory_import_zero_removal: [{ key: 'inventory_import_zero_removal', params: [] }],
  inventory_import_quantity_zero: [{ key: 'inventory_import_quantity_zero', params: [] }],
  contact_import_add_not_allowed: [{ key: 'contact_import_add_not_allowed', params: [] }],
  contact_import_edit_not_allowed: [{ key: 'contact_import_edit_not_allowed', params: [] }],
  inventory_import_branch_unmatched: [{ key: 'inventory_import_branch_unmatched', params: ['branch'] }],
  inventory_import_branch_required: [{ key: 'inventory_import_branch_required', params: [] }],
  inventory_import_already_at_count: [{ key: 'inventory_import_already_at_count', params: ['quantity'] }],
}

// The exact English the Worker (and the client pre-check) joins into a row message, and the pack key that says it.
export const IMPORT_ROW_SENTENCES: ReadonlyArray<readonly [string, string]> = [
  ['Enter a shop, warehouse or store quantity.', 'stock_import_quantity_required'],
  ['Name or barcode is required.', 'stock_import_name_or_barcode_required'],
  ['Date must be mm/dd/yyyy (month first, as this column has always been) or yyyy-mm-dd.', 'stock_import_date_invalid'],
]

// The unified stock import's sentences that name a count, a received date or a barcode: found in the joined row message by
// pattern, the captured values filling the pack sentence's placeholders in order. The numeric-parse sentences of that
// import ("Invalid shop quantity", "cost price cannot be negative") carry a per-field name from the shared parser and stay
// the Worker's English.
export const IMPORT_ROW_PATTERNS: ReadonlyArray<{ pattern: RegExp; key: string; names: readonly string[] }> = [
  { pattern: /Received date "([^"]*)" belongs to (\d+) matching product rows; choose the exact row\./g, key: 'stock_import_batch_ambiguous', names: ['batch', 'count'] },
  { pattern: /Name\/barcode match (\d+) product rows; merge the exact duplicates before importing\./g, key: 'stock_import_match_several_rows', names: ['count'] },
  { pattern: /Barcode (.+?) matches (\d+) products; add the product name so the right row is chosen\./g, key: 'stock_import_barcode_matches_several', names: ['barcode', 'count'] },
]

function paramValues(params: unknown, names: readonly string[]): Record<string, string> | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = (params as Record<string, unknown>)[name]
    if (typeof value === 'number' && Number.isFinite(value)) values[name] = String(value)
    else if (typeof value === 'string' && value.trim()) values[name] = value.trim()
    else return null
  }
  return values
}

export function importWarningText(warning: ImportReviewWarning, translate: Translate): string {
  const english = String(warning?.message || '')
  const code = String(warning?.code || '')
  if (!Object.prototype.hasOwnProperty.call(IMPORT_WARNING_CODES, code)) return english
  const spec = IMPORT_WARNING_CODES[code]
  const values = paramValues(warning.params, spec.params)
  if (!values) return english
  // One pass, so a branch name that itself reads like "{total}" is printed as it is.
  return translate(spec.key, english).replace(/\{(\w+)\}/g, (token, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token))
}

/** The pack sentence for a coded inventory import row, or null when the row carries no known code or lacks a param. */
function importRowCodeText(code: string | null | undefined, params: unknown, english: string, translate: Translate): string | null {
  const specs = code && Object.prototype.hasOwnProperty.call(IMPORT_ROW_CODES, code) ? IMPORT_ROW_CODES[code] : null
  if (!specs) return null
  for (const spec of specs) {
    const values: Record<string, string> | null = spec.params.length ? paramValues(params, spec.params) : {}
    if (!values) continue
    for (const [name, words] of Object.entries(spec.words || {})) {
      const key = Object.prototype.hasOwnProperty.call(words, values[name]) ? words[values[name]] : null
      if (key) values[name] = translate(key, values[name])
    }
    // One pass, so a product or branch name that itself reads like "{count}" is printed as it is.
    return translate(spec.key, english).replace(/\{(\w+)\}/g, (token, name: string) => (
      Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token))
  }
  return null
}

export function importRowMessageText(message: string | null | undefined, translate: Translate, code?: string | null, params?: unknown): string {
  const coded = importRowCodeText(code, params, String(message || ''), translate)
  if (coded) return coded
  let text = localizeBranchRuleError({ code, message: String(message || '') }, key => translate(key, String(message || '')))
  if (!text) return text
  for (const [english, key] of IMPORT_ROW_SENTENCES) {
    if (text.includes(english)) text = text.split(english).join(translate(key, english))
  }
  for (const { pattern, key, names } of IMPORT_ROW_PATTERNS) {
    text = text.replace(pattern, (whole: string, ...captured: string[]) => {
      const values: Record<string, string> = {}
      names.forEach((name, index) => { values[name] = String(captured[index] ?? '') })
      // One pass, so a barcode or batch label that itself reads like "{count}" is printed as it is.
      return translate(key, whole).replace(/\{(\w+)\}/g, (token, name: string) => (
        Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token))
    })
  }
  return text
}

/** What the review table shows in a row's Details cell. */
export function importRowDetailText(
  row: { code?: string | null; message?: string | null; params?: Record<string, unknown> | null; warnings?: ImportReviewWarning[] | null },
  translate: Translate,
): string {
  const message = importRowMessageText(row.message, translate, row.code, row.params)
  if (message) return message
  return (row.warnings || []).map((warning) => importWarningText(warning, translate)).filter(Boolean).join(' · ') || '—'
}
