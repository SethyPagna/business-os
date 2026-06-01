export type QueryPrimitive = string | number | boolean | null | undefined
export type QueryValue = QueryPrimitive | QueryPrimitive[]
export type QueryParams = Record<string, QueryValue>

export interface BuildQueryStringOptions {
  skipEmpty?: boolean
}

export function buildQueryString(
  params: QueryParams | null | undefined = {},
  { skipEmpty = true }: BuildQueryStringOptions = {},
): string {
  const query = new URLSearchParams()
  for (const key of Object.keys(params || {})) {
    const value = params?.[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(query, key, item, skipEmpty)
      }
      continue
    }
    appendQueryValue(query, key, value, skipEmpty)
  }
  return query.toString()
}

export function appendQuery(path: string, query: string): string {
  return query ? `${path}?${query}` : path
}

export function normalizePositiveUniqueIds(ids: unknown[] = [], limit = 100): number[] {
  const uniqueIds: number[] = []
  const seen = new Set<number>()
  for (const value of ids || []) {
    const id = Number(value)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    uniqueIds.push(id)
    if (uniqueIds.length >= limit) break
  }
  return uniqueIds
}

function appendQueryValue(
  query: URLSearchParams,
  key: string,
  value: QueryPrimitive,
  skipEmpty: boolean,
): void {
  if (value == null) return
  if (skipEmpty && value === '') return
  query.append(key, String(value))
}
