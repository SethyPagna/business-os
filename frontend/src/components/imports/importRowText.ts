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
// Pinned to the Worker's strings and to both packs by tests/importRowText.test.ts and
// cloudflare/scripts/test-cutover-li-pack-parity-pure.cjs.

export type ImportReviewWarning = {
  kind?: string
  message?: string
  code?: string
  params?: Record<string, unknown> | null
}

type Translate = (key: string, fallback: string) => string

// Worker code -> [pack key, the params that sentence needs]. The key is named after the code.
export const IMPORT_WARNING_CODES: Readonly<Record<string, { key: string; params: readonly string[] }>> = {
  stock_import_branch_routing: { key: 'stock_import_branch_routing', params: ['branch', 'columns', 'total'] },
}

// The exact English the Worker (and the client pre-check) joins into a row message, and the pack key that says it.
export const IMPORT_ROW_SENTENCES: ReadonlyArray<readonly [string, string]> = [
  ['Enter a shop, warehouse or store quantity.', 'stock_import_quantity_required'],
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

export function importRowMessageText(message: string | null | undefined, translate: Translate): string {
  let text = String(message || '')
  if (!text) return text
  for (const [english, key] of IMPORT_ROW_SENTENCES) {
    if (text.includes(english)) text = text.split(english).join(translate(key, english))
  }
  return text
}

/** What the review table shows in a row's Details cell. */
export function importRowDetailText(
  row: { message?: string | null; warnings?: ImportReviewWarning[] | null },
  translate: Translate,
): string {
  const message = importRowMessageText(row.message, translate)
  if (message) return message
  return (row.warnings || []).map((warning) => importWarningText(warning, translate)).filter(Boolean).join(' · ') || '—'
}
