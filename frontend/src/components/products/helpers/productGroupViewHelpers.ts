type ProductGroupFormatter = (value: unknown) => string
type ProductGroupTranslator = (key: string) => string

interface ProductGroupViewRecord {
  items?: unknown[]
  rows?: unknown[]
  stockTotal?: unknown
  hasMultipleItems?: unknown
  minSellingPriceUsd?: unknown
  maxSellingPriceUsd?: unknown
  branchNames?: unknown
  [key: string]: unknown
}

interface ProductGroupSummaryOptions {
  includeCount?: boolean
  // Branches are relevant on Products/Inventory (a group's rows can span
  // several branches) but not inside a single-branch view like the Branches
  // page's per-branch stock grid, where every row is already scoped to one
  // branch -- default true, callers on a single-branch view pass false.
  includeBranches?: boolean
  t?: ProductGroupTranslator
  fmtUSD?: ProductGroupFormatter
}

const defaultFormatUsd: ProductGroupFormatter = (value) => String(value || 0)
const defaultTranslate: ProductGroupTranslator = (key) => key

export function buildProductGroupPriceLabel(
  group?: ProductGroupViewRecord | null,
  fmtUSD: ProductGroupFormatter = defaultFormatUsd,
): string {
  const min = Number(group?.minSellingPriceUsd || 0)
  const max = Number(group?.maxSellingPriceUsd || 0)
  if (group?.hasMultipleItems && min !== max) return `${fmtUSD(min)} - ${fmtUSD(max)}`
  return fmtUSD(max || min || 0)
}

export function buildProductGroupBranchLabel(
  group?: ProductGroupViewRecord | null,
  t: ProductGroupTranslator = defaultTranslate,
): string | null {
  const branchNames = Array.isArray(group?.branchNames) ? group.branchNames as unknown[] : []
  const branchCount = branchNames.filter((name) => String(name || '').trim()).length
  // A 0-quantity group has no branch with positive stock, so branchNames
  // comes back empty -- this used to return null here, which the caller's
  // .filter(Boolean) then dropped entirely, silently omitting the branch
  // count instead of showing "0 branches" for an out-of-stock group. Show
  // it explicitly instead so 0-stock rows read the same as any other.
  const label = branchCount === 1 ? (t('branch') || 'branch') : (t('branches') || 'branches')
  return `${branchCount} ${label}`
}

export function buildProductGroupSummaryParts(group?: ProductGroupViewRecord | null, {
  includeCount = true,
  includeBranches = true,
  t = defaultTranslate,
  fmtUSD = defaultFormatUsd,
}: ProductGroupSummaryOptions = {}): string[] {
  // Prefer the merged row count (distinct products, branch-duplicates
  // collapsed) over the raw item count -- this is the number the person
  // actually sees rendered under this group's header. Falls back to
  // items.length for callers that haven't been given rows (e.g. any
  // legacy/test group shape without the merge step applied).
  const itemCount = group?.rows?.length ?? group?.items?.length ?? 0
  const stockLabel = String(t('stock') || 'stock').toLowerCase()
  // No price part here on purpose (used to be buildProductGroupPriceLabel):
  // a group's rows can genuinely have different prices, and this summary
  // line only ever showed one number for the whole group -- either the
  // min/max range (which reads oddly next to a single-value price pill) or,
  // once merged/sorted differently, effectively just whichever row happened
  // to be first. Not representative of every row, so not shown here at all.
  // buildProductGroupPriceLabel itself is left in place -- still used
  // elsewhere for an actual "price range" display, just not folded into
  // this pill list anymore.
  const parts: Array<string | null> = [
    includeCount ? `${itemCount} ${itemCount === 1 ? (t('option') || 'option') : (t('options') || 'options')}` : null,
    `${group?.stockTotal || 0} ${stockLabel}`,
    includeBranches ? buildProductGroupBranchLabel(group, t) : null,
  ]
  return parts.filter((part): part is string => Boolean(part))
}
