export const MERGE_COST_FIELDS = ['cost_price_usd', 'cost_price_khr'] as const
export const MERGE_PRICE_FIELDS = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'] as const

type MergeField = typeof MERGE_COST_FIELDS[number] | typeof MERGE_PRICE_FIELDS[number]
export type ProductMergeIssue = { field: MergeField; rowId: number | null; value: unknown; code: 'negative' | 'malformed' }

function parseMoney(value: unknown): { value?: number; missing?: true; issue?: 'negative' | 'malformed' } {
  if (value === null || value === undefined) return { missing: true }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return { missing: true }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return { issue: text.startsWith('-') ? 'negative' : 'malformed' }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? { value: parsed } : { issue: 'malformed' }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { issue: 'malformed' }
  return value < 0 ? { issue: 'negative' } : { value }
}

function round4(value: number): number {
  return Math.ceil(value * 10_000 - 1e-9) / 10_000 || 0
}

export function resolveProductMergeEconomics(rows: ReadonlyArray<Record<string, unknown>>): {
  merged: Partial<Record<MergeField, number>>
  issues: ProductMergeIssue[]
} {
  const merged: Partial<Record<MergeField, number>> = {}
  const issues: ProductMergeIssue[] = []
  for (const field of [...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS]) {
    const values: number[] = []
    for (const row of rows) {
      const parsed = parseMoney(row[field])
      if (parsed.missing) continue
      if (parsed.issue) {
        issues.push({ field, rowId: Number.isSafeInteger(Number(row.id)) ? Number(row.id) : null, value: row[field], code: parsed.issue })
      } else if (parsed.value !== undefined) values.push(parsed.value)
    }
    if (!values.length) continue
    if ((MERGE_COST_FIELDS as readonly string[]).includes(field)) {
      const distinctPositive = [...new Set(values.filter((value) => value > 0))]
      merged[field] = distinctPositive.length
        ? round4(distinctPositive.reduce((sum, value) => sum + value, 0) / distinctPositive.length)
        : 0
    } else {
      merged[field] = Math.max(...values)
    }
  }
  return { merged, issues }
}
