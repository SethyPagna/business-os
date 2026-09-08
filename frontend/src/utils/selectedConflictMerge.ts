import {
  identityBarcodeKey,
  normalizeLeadingZeroBarcodeForCleanup,
  normalizeProductFuzzyName,
  normalizeProductGroupName,
  resolveMergedCostDetail,
} from './productDetailRule.ts'

export const SELECTED_CONFLICT_MAX_CASES = 12

export type ProductConflictClusterType = 'leadingzero' | 'barcode' | 'name' | 'similar'
export type ProductConflictSeverity = 'leading_zero' | 'same_barcode' | 'same_name' | 'similar_name'

export type ProductConflictBranchStock = {
  branch_id: number
  branch_name: string | null
  quantity: number
}

export type ProductConflictProduct = {
  id: number
  name: string | null
  barcode: string | null
  cost_price_usd: number | null
  cost_price_khr?: number | null
  selling_price_usd: number | null
  selling_price_khr?: number | null
  wholesale_price_usd?: number | null
  wholesale_price_khr?: number | null
  stock_quantity: number | null
  image_path: string | null
  is_active?: number | boolean | null
  is_group?: number | boolean | null
  group_id?: number | string | null
  branch_stock?: ProductConflictBranchStock[]
}

export type ProductConflictCluster = {
  type: ProductConflictClusterType
  value: string
  severity: ProductConflictSeverity
  products: ProductConflictProduct[]
}

export type SelectedConflictPreviewCaseRequest = {
  case_key: string
  cluster_type: ProductConflictClusterType
  cluster_value: string
  product_ids: [number, number]
}

export type SelectedConflictLocalSkipCode =
  | 'not_exact_pair'
  | 'incompatible_product_identity'
  | 'invalid_merge_numeric'
  | 'selection_limit_exceeded'

export type SelectedConflictLocalSkip = {
  caseKey: string
  code: SelectedConflictLocalSkipCode
  productIds: number[]
}

export type SelectedConflictPartition = {
  cases: SelectedConflictPreviewCaseRequest[]
  skipped: SelectedConflictLocalSkip[]
}

export type SelectedConflictStockChoice = 'merge' | 'write_off'

export function selectedConflictCaseKey(cluster: Pick<ProductConflictCluster, 'type' | 'value'>): string {
  const raw = String(cluster.value || '').trim()
  const normalized = cluster.type === 'leadingzero'
    ? identityBarcodeKey(raw)
    : cluster.type === 'similar'
      ? normalizeProductFuzzyName(raw)
      : cluster.type === 'name'
        ? normalizeProductGroupName(raw)
        : raw
  return normalized ? `${cluster.type}:${normalized}` : ''
}

function rowIsActiveNonGroup(product: ProductConflictProduct): boolean {
  const active = product.is_active == null || product.is_active === true || Number(product.is_active) === 1
  const grouped = product.is_group === true || Number(product.is_group) === 1 || product.group_id != null
  return active && !grouped
}

function mergeNumericFieldsAreValid(product: ProductConflictProduct): boolean {
  const values = [
    product.cost_price_usd,
    product.cost_price_khr,
    product.selling_price_usd,
    product.selling_price_khr,
    product.wholesale_price_usd,
    product.wholesale_price_khr,
    product.stock_quantity,
  ]
  return values.every((value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0))
}

export function selectedConflictEligibility(cluster: ProductConflictCluster): {
  eligible: true
  keeper: ProductConflictProduct
  discarded: ProductConflictProduct
} | {
  eligible: false
  code: Exclude<SelectedConflictLocalSkipCode, 'selection_limit_exceeded'>
} {
  const value = selectedConflictCaseKey(cluster).slice(cluster.type.length + 1)
  const products = Array.isArray(cluster.products) ? cluster.products : []
  if (!value || products.length !== 2 || new Set(products.map((product) => Number(product.id))).size !== 2) {
    return { eligible: false, code: 'not_exact_pair' }
  }
  const [left, right] = products
  if (!products.every(rowIsActiveNonGroup)) return { eligible: false, code: 'not_exact_pair' }
  if (!products.every(mergeNumericFieldsAreValid)) return { eligible: false, code: 'invalid_merge_numeric' }

  const leftName = normalizeProductGroupName(left.name || '')
  const rightName = normalizeProductGroupName(right.name || '')
  const leftBarcode = identityBarcodeKey(left.barcode)
  const rightBarcode = identityBarcodeKey(right.barcode)
  if (!leftName || leftName !== rightName || !leftBarcode || leftBarcode !== rightBarcode) {
    return { eligible: false, code: 'incompatible_product_identity' }
  }
  if (resolveMergedCostDetail(products).outliers.length) {
    return { eligible: false, code: 'incompatible_product_identity' }
  }
  const [keeper, discarded] = chooseSelectedConflictKeeper(products)
  return { eligible: true, keeper, discarded }
}

export function chooseSelectedConflictKeeper(products: ProductConflictProduct[]): [ProductConflictProduct, ProductConflictProduct] {
  if (products.length !== 2) throw new Error('A selected conflict merge requires exactly two products.')
  const rawBarcodes = new Set(products.map((product) => String(product.barcode || '').trim().toLowerCase()))
  const isLeadingZeroPair = rawBarcodes.size > 1
  const zerosShed = (product: ProductConflictProduct) => {
    const raw = String(product.barcode || '').trim().toLowerCase()
    return raw.length - normalizeLeadingZeroBarcodeForCleanup(raw).length
  }
  const ordered = [...products].sort((left, right) => {
    if (isLeadingZeroPair) {
      const zeroDifference = zerosShed(left) - zerosShed(right)
      if (zeroDifference) return zeroDifference
    }
    const stockDifference = (Number(right.stock_quantity) || 0) - (Number(left.stock_quantity) || 0)
    if (stockDifference) return stockDifference
    return Number(left.id) - Number(right.id)
  })
  return [ordered[0], ordered[1]]
}

export function partitionSelectedConflictClusters(clusters: ProductConflictCluster[]): SelectedConflictPartition {
  const cases: SelectedConflictPreviewCaseRequest[] = []
  const skipped: SelectedConflictLocalSkip[] = []
  for (const cluster of clusters) {
    const caseKey = selectedConflictCaseKey(cluster)
    const eligibility = selectedConflictEligibility(cluster)
    if (!eligibility.eligible) {
      skipped.push({ caseKey, code: eligibility.code, productIds: cluster.products.map((product) => Number(product.id)) })
      continue
    }
    if (cases.length >= SELECTED_CONFLICT_MAX_CASES) {
      skipped.push({ caseKey, code: 'selection_limit_exceeded', productIds: cluster.products.map((product) => Number(product.id)) })
      continue
    }
    cases.push({
      case_key: caseKey,
      cluster_type: cluster.type,
      cluster_value: String(cluster.value).trim(),
      product_ids: [eligibility.keeper.id, eligibility.discarded.id],
    })
  }
  return { cases, skipped }
}

export function selectedConflictChoicesComplete(
  cases: Array<{ case_key: string; needs_stock_choice: boolean; blocked?: unknown }>,
  choices: Readonly<Record<string, SelectedConflictStockChoice | undefined>>,
): boolean {
  const eligible = cases.filter((item) => !item.blocked)
  return eligible.length > 0 && eligible.every((item) => !item.needs_stock_choice || choices[item.case_key] === 'merge' || choices[item.case_key] === 'write_off')
}

export function preserveSelectedConflictChoices(
  previousCases: Array<{ case_key: string; keep_id: number; merge_id: number; needs_stock_choice: boolean }>,
  nextCases: Array<{ case_key: string; keep_id: number; merge_id: number; needs_stock_choice: boolean }>,
  choices: Readonly<Record<string, SelectedConflictStockChoice | undefined>>,
): Record<string, SelectedConflictStockChoice> {
  const previous = new Map(previousCases.map((item) => [item.case_key, item]))
  const preserved: Record<string, SelectedConflictStockChoice> = {}
  for (const item of nextCases) {
    const before = previous.get(item.case_key)
    const choice = choices[item.case_key]
    if (!before || !choice || !item.needs_stock_choice) continue
    if (before.keep_id !== item.keep_id || before.merge_id !== item.merge_id || before.needs_stock_choice !== item.needs_stock_choice) continue
    preserved[item.case_key] = choice
  }
  return preserved
}

export function createSelectedConflictRequestCoordinator(): {
  begin: () => { signal: AbortSignal; isCurrent: () => boolean; finish: () => boolean }
  cancel: () => void
} {
  let active: AbortController | null = null
  return {
    begin() {
      active?.abort()
      const controller = new AbortController()
      active = controller
      return {
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted,
        finish: () => {
          if (active !== controller) return false
          active = null
          return !controller.signal.aborted
        },
      }
    },
    cancel() {
      active?.abort()
      active = null
    },
  }
}

export function selectedConflictCanContinueAutomatically(result: {
  complete?: boolean
  blockedOnly?: boolean
  interruptionCode?: string | null
  madeProgress?: boolean
  maxAdditionalRequests?: number | null
} | null | undefined): boolean {
  if (!result || result.complete || result.blockedOnly) return false
  if (result.interruptionCode !== 'merge_budget_reached' || !result.madeProgress) return false
  const additional = Number(result.maxAdditionalRequests)
  return Number.isSafeInteger(additional) && additional > 0
}

export function selectedConflictRequiresManualResume(result: {
  complete?: boolean
  interruptionCode?: string | null
} | null | undefined): boolean {
  if (!result || result.complete) return false
  return result.interruptionCode === 'merge_infrastructure_interrupted'
    || result.interruptionCode === 'merge_history_pending'
    || result.interruptionCode === 'merge_history_unavailable'
    || result.interruptionCode === 'merge_state_conflict'
}

export function selectedConflictOutcomeIsUnknown(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  const status = Number((error as { status?: unknown } | null)?.status)
  return !Number.isFinite(status) || status <= 0 || status >= 500
}
