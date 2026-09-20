import type { QueryParams } from './query.ts'
import { captureActorReadScope, assertActorReadScope } from './actorReadScope.ts'
import { returnsStatementParams, type ReturnsStatementRange } from '../utils/returnsExportWindow.ts'

export type ReturnStatementPage<T> = {
  rows: T[]
  total: number
  /** Must represent an authoritative server consistency guard, not max ID. */
  snapshotToken: string
  nextCursor: string | null
}

export type ReturnStatementReader<T> = {
  signal?: AbortSignal
  readPage: (query: Readonly<QueryParams>, cursor: string | null, snapshotToken: string | null, signal?: AbortSignal) => Promise<ReturnStatementPage<T>>
  /** Revalidate the authoritative snapshot after the final page, before handoff. */
  verifySnapshot: (query: Readonly<QueryParams>, snapshotToken: string, signal?: AbortSignal) => Promise<void>
}

/**
 * Candidate transport primitive. Intentionally not wired to an endpoint/UI:
 * server snapshot coverage must be certified before enabling statement export.
 * No cache, retries, partial-row callback, or file side effect. Call assertCurrent
 * again immediately before publishing an asynchronously formatted file.
 * This retains all result rows for current formatters; it is not constant-memory.
 */
export async function readCompleteReturnStatement<T extends { id: number }>(
  range: ReturnsStatementRange,
  filters: QueryParams,
  reader: ReturnStatementReader<T>,
): Promise<{ rows: T[]; assertCurrent: () => void }> {
  const authorities = ['returns', 'products', 'sales', 'customers'].map(captureActorReadScope)
  const assertCurrent = (): void => {
    for (const authority of authorities) assertActorReadScope(authority)
    if (reader.signal?.aborted) throw new DOMException('Return statement export cancelled', 'AbortError')
  }
  assertCurrent()
  const capturedFilters: QueryParams = {}
  for (const [key, value] of Object.entries(filters)) {
    capturedFilters[key] = Array.isArray(value) ? value.slice() : value
    if (Array.isArray(capturedFilters[key])) Object.freeze(capturedFilters[key])
  }
  const query = Object.freeze({ ...capturedFilters, ...returnsStatementParams(range), limit: 500 })
  const rows: T[] = []
  const ids = new Set<number>(), cursors = new Set<string>()
  let cursor: string | null = null, snapshotToken: string | null = null, total: number | null = null
  do {
    assertCurrent()
    const page = await reader.readPage(query, cursor, snapshotToken, reader.signal)
    assertCurrent()
    if (!Array.isArray(page.rows) || page.rows.length > 500 || !Number.isSafeInteger(page.total) || page.total < 0
      || typeof page.snapshotToken !== 'string' || !page.snapshotToken
      || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) {
      throw new Error('Invalid return statement page')
    }
    if ((snapshotToken !== null && snapshotToken !== page.snapshotToken) || (total !== null && total !== page.total)) {
      throw new Error('Return statement changed during export; restart the download')
    }
    snapshotToken = page.snapshotToken
    total = page.total
    for (const row of page.rows) {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw new Error('Invalid or repeated return in statement export')
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length > total || (page.nextCursor !== null && (!page.rows.length || rows.length >= total || cursors.has(page.nextCursor)))) {
      throw new Error('Return statement cursor did not progress consistently')
    }
    cursor = page.nextCursor
    if (cursor !== null) cursors.add(cursor)
  } while (cursor !== null)
  if (rows.length !== total) throw new Error('Return statement is incomplete; no file was produced')
  assertCurrent()
  await reader.verifySnapshot(query, snapshotToken!, reader.signal)
  assertCurrent()
  return { rows, assertCurrent }
}
