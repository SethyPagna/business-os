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
  remove_rows: []
}

export type SelectedConflictGroupResolutionChoice = {
  keeper_id?: number
  barcode_source_id?: number
  category_source_id?: number
  brand_source_id?: number
  unit_source_id?: number
}

export function buildSelectedConflictGroupReviewRequest(
  clusters: ProductConflictCluster[],
  clientRequestId: string,
): SelectedConflictGroupReviewRequest {
  const requestId = String(clientRequestId || '').trim()
  if (!requestId) throw new Error('A stable client request ID is required.')

  const mergeGroups: SelectedConflictGroupRequest[] = []
  const seenGroupKeys = new Set<string>()
  for (const cluster of clusters) {
    const groupKey = selectedConflictCaseKey(cluster)
    if (!groupKey || seenGroupKeys.has(groupKey)) continue
    const memberIds = [...new Set((cluster.products || [])
      .map((product) => Number(product.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0))]
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
    remove_rows: [],
  }
}

export function selectedConflictGroupChoiceComplete(
  options: {
    barcode_source_ids: number[]
    category_source_ids: number[]
    brand_source_ids: number[]
    unit_source_ids: number[]
  },
  memberIds: number[],
  choice: SelectedConflictGroupResolutionChoice | undefined,
): boolean {
  if (!choice || !memberIds.includes(Number(choice.keeper_id))) return false
  return ([
    ['barcode_source_id', options.barcode_source_ids],
    ['category_source_id', options.category_source_ids],
    ['brand_source_id', options.brand_source_ids],
    ['unit_source_id', options.unit_source_ids],
  ] as const).every(([field, allowed]) => allowed.includes(Number(choice[field])))
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
  pages: Array<{ groups: Array<{ ordinal: number }>; next_cursor: string | null }>,
  requestedGroups: number,
): { loaded: number; total: number | null; complete: boolean } {
  const loaded = new Set(pages.flatMap((page) => page.groups.map((group) => group.ordinal))).size
  const total = Number.isSafeInteger(requestedGroups) && requestedGroups >= 0 ? requestedGroups : null
  return { loaded, total, complete: pages.length > 0 && pages[pages.length - 1].next_cursor == null }
}
