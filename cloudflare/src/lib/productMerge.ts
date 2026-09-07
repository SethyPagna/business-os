export const MERGE_COST_FIELDS = ['cost_price_usd', 'cost_price_khr'] as const
export const MERGE_PRICE_FIELDS = [
  'selling_price_usd',
  'selling_price_khr',
  'wholesale_price_usd',
  'wholesale_price_khr',
] as const

export type MergeMoneyField = typeof MERGE_COST_FIELDS[number] | typeof MERGE_PRICE_FIELDS[number]

export type ProductMergeNumericIssue = {
  field: MergeMoneyField
  rowId: number | null
  value: unknown
  code: 'negative' | 'malformed'
}

export type ProductMergeEconomics = {
  merged: Partial<Record<MergeMoneyField, number>>
  distinctCosts: Partial<Record<typeof MERGE_COST_FIELDS[number], number[]>>
  issues: ProductMergeNumericIssue[]
}

type NumericValue = { kind: 'missing' } | { kind: 'value'; value: number } | { kind: 'invalid'; code: 'negative' | 'malformed' }

// Money arrives from both SQLite (number) and import paths (decimal text).
// Accept ordinary non-negative decimals only: scientific notation, Infinity,
// NaN and partial parses are data errors and block the merge. Blank/null means
// "not recorded"; it is different from an explicit zero.
export function parseMergeMoney(value: unknown): NumericValue {
  if (value === null || value === undefined) return { kind: 'missing' }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return { kind: 'missing' }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      return { kind: 'invalid', code: text.startsWith('-') ? 'negative' : 'malformed' }
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? { kind: 'value', value: parsed } : { kind: 'invalid', code: 'malformed' }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'invalid', code: 'malformed' }
  if (value < 0) return { kind: 'invalid', code: 'negative' }
  return { kind: 'value', value }
}

function roundMoney(value: number, places: number): number {
  const scale = 10 ** places
  return Math.round((value + Number.EPSILON) * scale) / scale
}

export function resolveProductMergeEconomics(rows: ReadonlyArray<Record<string, unknown>>): ProductMergeEconomics {
  const merged: Partial<Record<MergeMoneyField, number>> = {}
  const distinctCosts: ProductMergeEconomics['distinctCosts'] = {}
  const issues: ProductMergeNumericIssue[] = []

  for (const field of [...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS]) {
    const values: number[] = []
    for (const row of rows) {
      const parsed = parseMergeMoney(row?.[field])
      if (parsed.kind === 'missing') continue
      if (parsed.kind === 'invalid') {
        issues.push({ field, rowId: Number.isInteger(Number(row?.id)) ? Number(row.id) : null, value: row?.[field], code: parsed.code })
        continue
      }
      values.push(parsed.value)
    }
    if (!values.length) continue
    if ((MERGE_COST_FIELDS as readonly string[]).includes(field)) {
      // The owner's rule is cluster-wide: DISTINCT valid non-zero costs are
      // collected before one mean and one final rounding. Repeated 4s do not
      // overweight 5, and 4/5/6 becomes 5 rather than pairwise 5.25.
      const positive = [...new Set(values.filter((value) => value > 0))]
      distinctCosts[field as typeof MERGE_COST_FIELDS[number]] = positive
      merged[field] = positive.length
        ? roundMoney(positive.reduce((sum, value) => sum + value, 0) / positive.length, 4)
        : 0
    } else {
      merged[field] = Math.max(...values)
    }
  }

  return { merged, distinctCosts, issues }
}

export function productMergeNumericError(issues: ProductMergeNumericIssue[]): string {
  const first = issues[0]
  if (!first) return ''
  const row = first.rowId == null ? '' : ` on product #${first.rowId}`
  return `${first.field}${row} is ${first.code === 'negative' ? 'negative' : 'not a valid decimal'}. Correct it before merging.`
}

export type ProductMergeCasRow = {
  id: number
  name: string | null
  barcode: string | null
  is_active: number
  updated_at: string | null
}

// Product ids are immutable, so this key remains stable across retries and
// lets a bounded client deduplicate receipts after a lost response.
export function productMergeCaseKey(keeperId: number, mergedId: number): string {
  if (!Number.isSafeInteger(keeperId) || keeperId <= 0 || !Number.isSafeInteger(mergedId) || mergedId <= 0 || keeperId === mergedId) {
    throw new Error('A product merge case requires two different positive integer ids.')
  }
  return `${keeperId}:${mergedId}`
}

// D1 batch() is transactional, but a zero-row UPDATE does not fail a batch.
// This read-only statement deliberately raises a SQLite JSON error when either
// row differs from the state the fold inspected, rolling the entire batch back.
export function productMergeCasAssertion(rows: readonly ProductMergeCasRow[]): { sql: string; params: Record<string, unknown> } {
  if (rows.length !== 2) throw new Error('A product merge CAS requires exactly two rows.')
  const [a, b] = rows
  return {
    sql: `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM products WHERE id=@aId AND is_active=@aActive
        AND COALESCE(name,'')=COALESCE(@aName,'') AND COALESCE(barcode,'')=COALESCE(@aBarcode,'')
        AND COALESCE(updated_at,'')=COALESCE(@aUpdated,''))
      AND EXISTS(SELECT 1 FROM products WHERE id=@bId AND is_active=@bActive
        AND COALESCE(name,'')=COALESCE(@bName,'') AND COALESCE(barcode,'')=COALESCE(@bBarcode,'')
        AND COALESCE(updated_at,'')=COALESCE(@bUpdated,''))
      THEN 1 ELSE json_extract('', '$') END AS merge_guard`,
    params: {
      aId: a.id, aActive: a.is_active, aName: a.name, aBarcode: a.barcode, aUpdated: a.updated_at,
      bId: b.id, bActive: b.is_active, bName: b.name, bBarcode: b.barcode, bUpdated: b.updated_at,
    },
  }
}
