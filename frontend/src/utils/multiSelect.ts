// Shared helper for filter state stored as a single comma-joined string
// (e.g. "Skincare,Makeup" or the sentinel "all" for "no filter selected").
// This keeps existing sessionStorage/query-param plumbing (a single string
// per filter) working unchanged while letting a filter hold >1 value.

const SEPARATOR = ','
const ALL = 'all'

/** Split a stored filter value into its individual selected values. Returns [] when nothing is selected. */
export function parseMultiValues(raw: string | null | undefined): string[] {
  if (!raw || raw === ALL) return []
  return raw
    .split(SEPARATOR)
    .map((value) => value.trim())
    .filter(Boolean)
}

/** Whether a specific value is currently selected within a stored filter value. */
export function isMultiActive(raw: string | null | undefined, value: string, caseInsensitive = false): boolean {
  const target = caseInsensitive ? String(value).toLowerCase() : String(value)
  return parseMultiValues(raw).some((v) => (caseInsensitive ? v.toLowerCase() : v) === target)
}

/**
 * Toggle a value in/out of a stored filter value.
 * Passing the sentinel "all" always clears the whole selection.
 */
export function toggleMultiValue(raw: string | null | undefined, value: string): string {
  if (value === ALL) return ALL
  const current = parseMultiValues(raw)
  const idx = current.findIndex((v) => v.toLowerCase() === String(value).toLowerCase())
  const next = idx >= 0 ? [...current.slice(0, idx), ...current.slice(idx + 1)] : [...current, value]
  return next.length ? next.join(SEPARATOR) : ALL
}

/**
 * Whether a candidate record value matches an active (possibly multi-value) filter.
 * An empty/"all" filter always matches (i.e. the filter is inactive).
 */
export function matchesMulti(raw: string | null | undefined, candidate: string | number | null | undefined, caseInsensitive = true): boolean {
  const values = parseMultiValues(raw)
  if (!values.length) return true
  const cand = String(candidate ?? '')
  return values.some((v) => (caseInsensitive ? v.toLowerCase() === cand.toLowerCase() : v === cand))
}

/**
 * Batch version of toggleMultiValue: applies the same checked/unchecked
 * state to every value in `values` in one step (e.g. selecting a whole
 * "Main - Sub" category group at once instead of one subcategory at a
 * time). Passing the sentinel "all" among `values` is not supported --
 * callers that want to clear everything should call toggleMultiValue('all')
 * directly instead.
 */
export function toggleMultiValues(raw: string | null | undefined, values: string[], checked: boolean): string {
  const current = parseMultiValues(raw)
  const wanted = new Set(values.map((value) => value.toLowerCase()))
  const kept = current.filter((value) => !wanted.has(value.toLowerCase()))
  const next = checked ? [...kept, ...values] : kept
  return next.length ? next.join(SEPARATOR) : ALL
}

/** Number of individually selected values (for "Filters (n)" badges that should count values, not just active dimensions). */
export function countMultiValues(raw: string | null | undefined): number {
  return parseMultiValues(raw).length
}
