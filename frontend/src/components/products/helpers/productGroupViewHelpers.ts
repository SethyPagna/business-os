type ProductGroupFormatter = (value: unknown) => string
type ProductGroupTranslator = (key: string) => string

interface ProductGroupViewRecord {
  items?: unknown[]
  stockTotal?: unknown
  hasMultipleItems?: unknown
  minSellingPriceUsd?: unknown
  maxSellingPriceUsd?: unknown
  [key: string]: unknown
}

interface ProductGroupSummaryOptions {
  includeCount?: boolean
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

export function buildProductGroupSummaryParts(group?: ProductGroupViewRecord | null, {
  includeCount = true,
  t = defaultTranslate,
  fmtUSD = defaultFormatUsd,
}: ProductGroupSummaryOptions = {}): string[] {
  const itemCount = group?.items?.length || 0
  const stockLabel = String(t('stock') || 'stock').toLowerCase()
  const parts: Array<string | null> = [
    includeCount ? `${itemCount} ${itemCount === 1 ? (t('option') || 'option') : (t('options') || 'options')}` : null,
    `${group?.stockTotal || 0} ${stockLabel}`,
    buildProductGroupPriceLabel(group, fmtUSD),
  ]
  return parts.filter((part): part is string => Boolean(part))
}
