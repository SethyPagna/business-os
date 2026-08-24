type HistoryRecord = Record<string, unknown>

interface HistoryResultPayload {
  id?: unknown
  data?: { id?: unknown } | null
  item?: { id?: unknown } | null
}

interface ResolveCreatedHistorySnapshotOptions {
  result?: HistoryResultPayload | null
  latestItems?: HistoryRecord[]
  clientRequestId?: string
  fallbackSnapshot?: HistoryRecord | null
}

interface ResolvedHistorySnapshot {
  id: number
  snapshot: HistoryRecord
}

export function cloneHistorySnapshot<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function extractHistoryResultId(result: HistoryResultPayload | null | undefined): number {
  const value = Number(
    result?.id
    ?? result?.data?.id
    ?? result?.item?.id
    ?? 0,
  )
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function resolveCreatedHistorySnapshot({
  result = null,
  latestItems = [],
  clientRequestId = '',
  fallbackSnapshot = null,
}: ResolveCreatedHistorySnapshotOptions = {}): ResolvedHistorySnapshot {
  const explicitId = extractHistoryResultId(result)
  const items = Array.isArray(latestItems) ? latestItems : []
  const normalizedClientRequestId = String(clientRequestId || '').trim()

  const matchedItem = items.find((item) => Number(item?.id || 0) === explicitId)
    || (normalizedClientRequestId
      ? items.find((item) => String(item?.client_request_id || '').trim() === normalizedClientRequestId)
      : null)
    || null

  const snapshot = cloneHistorySnapshot(matchedItem || fallbackSnapshot || {})
  const resolvedId = Number(snapshot?.id || explicitId || 0)
  if (resolvedId > 0 && snapshot && !snapshot.id) snapshot.id = resolvedId

  return {
    id: Number.isFinite(resolvedId) && resolvedId > 0 ? resolvedId : 0,
    snapshot,
  }
}
