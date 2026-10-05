// Shared-core search over rows a picker already holds (G37): a fully loaded
// branch stock list, an import file's rows, a duplicates review. Same
// normalizer, typo rules and ranking as the catalog index
// (utils/searchCore.ts), so a picker that filters in memory agrees with the
// server-backed ones instead of keeping its own substring or fuzzy rules.
import { buildTermIndex, searchTermIndex, type SearchOptions } from './searchCore.ts'

export interface RowSearchFields {
  name?: unknown
  brand?: unknown
  barcode?: unknown
  sku?: unknown
}

export type RowSearch<T> = (query: string, options?: SearchOptions) => T[]

/**
 * Builds the index once for `rows` (memoize it on the rows array) and
 * returns a search that yields the matching rows best first. An empty
 * query returns the rows unchanged.
 */
export function createRowSearch<T>(rows: readonly T[], fields: (row: T) => RowSearchFields): RowSearch<T> {
  const index = buildTermIndex(rows.map((row, position) => ({ id: position, ...fields(row) })))
  return (query: string, options: SearchOptions = {}) => {
    if (!String(query || '').trim()) return rows.slice()
    return searchTermIndex(index, query, options).hits.map((hit) => rows[hit.id])
  }
}
