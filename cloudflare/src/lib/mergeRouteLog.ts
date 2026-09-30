// A 5xx on the merge and Resolve routes used to leave only the global
// "[worker] unhandled error <method> <path> <Error object>" line, with no
// product ids and an error object the log viewer shows as {}. The next
// occurrence must be diagnosable from one structured line: which route, which
// products, what failed. Ids and the error text only -- no names, barcodes,
// prices or user details.
export const MERGE_FAILURE_LOG_EVENT = 'product_merge_5xx'

const MAX_IDS = 40
const MAX_MESSAGE = 300

const asId = (value: unknown): number | null => {
  const id = typeof value === 'string' && /^\d{1,15}$/.test(value.trim()) ? Number(value) : value
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null
}

// Ids from a request body, query and path: the named keys the merge routes
// accept, never a blind walk (a body can also carry names and prices).
export function collectMergeProductIds(path: string, query: Record<string, string | undefined>, body: unknown): number[] {
  const ids = new Set<number>()
  const add = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) add(item); return }
    const id = asId(value)
    if (id !== null && ids.size < MAX_IDS) ids.add(id)
  }
  add(path.match(/\/(\d+)$/)?.[1])
  for (const key of ['keepId', 'mergeId']) add(query[key])
  add((query.groupIds ?? '').split(','))
  const read = (source: unknown, depth: number) => {
    if (!source || typeof source !== 'object' || depth > 3) return
    if (Array.isArray(source)) { for (const item of source.slice(0, MAX_IDS)) read(item, depth + 1); return }
    const record = source as Record<string, unknown>
    for (const key of ['keepId', 'mergeId', 'keep_id', 'merge_id', 'keeper_id', 'member_ids', 'product_ids']) add(record[key])
    for (const key of ['steps', 'cases', 'groups', 'resolve']) read(record[key], depth + 1)
  }
  read(body, 0)
  return [...ids]
}

export function describeMergeFailure(input: {
  method: string
  path: string
  status: number
  productIds: number[]
  error: unknown
}): string {
  const error = input.error as { name?: unknown; message?: unknown } | null | undefined
  return JSON.stringify({
    event: MERGE_FAILURE_LOG_EVENT,
    method: input.method,
    route: input.path,
    status: input.status,
    productIds: input.productIds,
    errorName: typeof error?.name === 'string' ? error.name : null,
    error: typeof error?.message === 'string' ? error.message.slice(0, MAX_MESSAGE) : 'returned a 5xx without a thrown error',
  })
}
