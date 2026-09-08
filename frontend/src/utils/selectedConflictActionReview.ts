import { selectedConflictCaseKey, type ProductConflictCluster } from './selectedConflictMerge.ts'

export const SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT = 50

export type SelectedConflictGroupRequest = {
  group_key: string
  member_ids: number[]
}

export type SelectedConflictGroupReviewRequest = {
  manifest_version: 1
  resolution_version: 2
  client_request_id: string
  merge_groups: SelectedConflictGroupRequest[]
  remove_rows: Array<{ product_id: number; reason: string }>
}

export type SelectedConflictGroupResolutionChoice = {
  keeper_id?: number
  barcode?: {
    mode: 'canonical' | 'member' | 'clear'
    source_product_id?: number
  }
  category_source_id?: number
  brand_source_id?: number
  unit_source_id?: number
}

export function buildSelectedConflictGroupReviewRequest(
  clusters: ProductConflictCluster[],
  clientRequestId: string,
  removalReasons: Readonly<Record<number, string>> = {},
): SelectedConflictGroupReviewRequest {
  const requestId = String(clientRequestId || '').trim()
  if (!requestId) throw new Error('A stable client request ID is required.')

  const selectedProductIds = new Set(clusters.flatMap((cluster) => (cluster.products || [])
    .map((product) => Number(product.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)))
  const removeRows = Object.entries(removalReasons).map(([rawId, rawReason]) => ({
    product_id: Number(rawId),
    reason: String(rawReason || '').trim(),
  })).filter((row) => selectedProductIds.has(row.product_id))
    .sort((left, right) => left.product_id - right.product_id)
  const invalidRemoval = removeRows.find((row) => !row.reason || row.reason.length > 500)
  if (invalidRemoval) throw new Error(`A removal reason of 1-500 characters is required for product #${invalidRemoval.product_id}.`)
  const removalIds = new Set(removeRows.map((row) => row.product_id))

  const mergeGroups: SelectedConflictGroupRequest[] = []
  const seenGroupKeys = new Set<string>()
  for (const cluster of clusters) {
    const groupKey = selectedConflictCaseKey(cluster)
    if (!groupKey || seenGroupKeys.has(groupKey)) continue
    const memberIds = [...new Set((cluster.products || [])
      .map((product) => Number(product.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0 && !removalIds.has(id)))]
      .sort((left, right) => left - right)
    if (memberIds.length < 2) continue
    seenGroupKeys.add(groupKey)
    mergeGroups.push({ group_key: groupKey, member_ids: memberIds })
  }

  return {
    manifest_version: 1,
    resolution_version: 2,
    client_request_id: requestId,
    merge_groups: mergeGroups,
    remove_rows: removeRows,
  }
}

type ChoiceGroup = {
  group_key?: string
  eligibility_basis: 'name' | 'barcode' | null
  member_ids: number[]
  options: {
    barcode_source_ids: number[]
    category_source_ids: number[]
    brand_source_ids: number[]
    unit_source_ids: number[]
  }
}

export function selectedConflictGroupChoiceComplete(
  group: ChoiceGroup,
  choice: SelectedConflictGroupResolutionChoice | undefined,
): boolean {
  if (!choice || !group.member_ids.includes(Number(choice.keeper_id))) return false
  const barcodeComplete = choice.barcode?.mode === 'clear'
    || (choice.barcode?.mode === 'canonical' && group.eligibility_basis === 'barcode')
    || (choice.barcode?.mode === 'member'
      && group.options.barcode_source_ids.includes(Number(choice.barcode.source_product_id)))
  if (!barcodeComplete) return false
  return ([
    ['category_source_id', group.options.category_source_ids],
    ['brand_source_id', group.options.brand_source_ids],
    ['unit_source_id', group.options.unit_source_ids],
  ] as const).every(([field, allowed]) => allowed.includes(Number(choice[field])))
}

export type SelectedConflictGroupFinalizeRequest = {
  manifest_version: 1
  resolution_version: 2
  review_id: string
  draft_digest: string
  resolutions: Array<{
    group_key: string
    keeper_id: number
    barcode: {
      mode: 'canonical' | 'member' | 'clear'
      source_product_id?: number
    }
    category_source_id: number
    brand_source_id: number
    unit_source_id: number
  }>
}

export function buildSelectedConflictGroupFinalizeRequest(
  review: { review_id: string; draft_digest: string },
  groups: Array<ChoiceGroup & { group_key: string; blocked: unknown }>,
  choices: Readonly<Record<string, SelectedConflictGroupResolutionChoice | undefined>>,
): SelectedConflictGroupFinalizeRequest {
  const resolutions = groups.filter((group) => !group.blocked).map((group) => {
    const choice = choices[group.group_key]
    if (!selectedConflictGroupChoiceComplete(group, choice)) {
      throw new Error(`Complete every choice for ${group.group_key} before continuing.`)
    }
    return {
      group_key: group.group_key,
      keeper_id: Number(choice?.keeper_id),
      barcode: choice?.barcode as NonNullable<SelectedConflictGroupResolutionChoice['barcode']>,
      category_source_id: Number(choice?.category_source_id),
      brand_source_id: Number(choice?.brand_source_id),
      unit_source_id: Number(choice?.unit_source_id),
    }
  })
  return {
    manifest_version: 1,
    resolution_version: 2,
    review_id: review.review_id,
    draft_digest: review.draft_digest,
    resolutions,
  }
}

export function selectedConflictGroupChoicesComplete(
  groups: Array<ChoiceGroup & { group_key: string; blocked: unknown }>,
  choices: Readonly<Record<string, SelectedConflictGroupResolutionChoice | undefined>>,
): boolean {
  return groups.filter((group) => !group.blocked)
    .every((group) => selectedConflictGroupChoiceComplete(group, choices[group.group_key]))
}

export function selectedConflictGroupSourceValue<T extends {
  id: number
  barcode: string | null
  category: string | null
  brand: string | null
  unit: string | null
}>(
  members: T[],
  sourceId: number | undefined,
  field: 'barcode' | 'category' | 'brand' | 'unit',
): string | null | undefined {
  if (!Number.isSafeInteger(Number(sourceId))) return undefined
  return members.find((member) => member.id === Number(sourceId))?.[field]
}

export function selectedConflictGroupLoadedProgress(
  pages: Array<{
    groups: Array<{ ordinal: number }>
    removals?: Array<{ action_ordinal: number }>
    next_cursor: string | null
  }>,
  totalActions: number,
): { loaded: number; total: number | null; complete: boolean } {
  const loaded = new Set(pages.flatMap((page) => [
    ...page.groups.map((group) => group.ordinal),
    ...(page.removals || []).map((removal) => removal.action_ordinal),
  ])).size
  const total = Number.isSafeInteger(totalActions) && totalActions >= 0 ? totalActions : null
  return { loaded, total, complete: pages.length > 0 && pages[pages.length - 1].next_cursor == null && (total == null || loaded === total) }
}
