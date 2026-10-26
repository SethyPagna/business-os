import { apiFetch } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { readCompleteReturnStatement, type ReturnStatementPage } from './returnsStatementTransport.ts'
import type { ReturnsStatementRange } from '../utils/returnsExportWindow.ts'

/** No cache or automatic retry. The caller owns cancellation and publication. */
export async function loadReturnStatement<T extends { id: number }>(range: ReturnsStatementRange, filters: QueryParams, options: {
  signal: AbortSignal
  assertAllowed: () => void
  onProgress?: (received: number, total: number) => void
  expectedIds?: number[]
}) {
  let queryForVerify: Readonly<QueryParams> | null = null
  let tokenForVerify = '', totalForVerify = -1, received = 0
  const verify = async () => {
    options.assertAllowed()
    if (!queryForVerify || !tokenForVerify) throw new Error('Missing return statement snapshot')
    const response = await apiFetch('GET', appendQuery('/api/returns/export', buildQueryString({ ...queryForVerify, snapshotToken: tokenForVerify, verify: '1' })), undefined, 30000, { signal: options.signal }) as ReturnStatementPage<T>
    options.assertAllowed()
    if (response.snapshotToken !== tokenForVerify || response.total !== totalForVerify || !Array.isArray(response.rows) || response.rows.length || response.nextCursor !== null) throw new Error('Return statement changed; restart the download')
  }
  const complete = await readCompleteReturnStatement<T>(range, filters, {
    signal: options.signal,
    readPage: async (query, cursor, snapshotToken, signal) => {
      options.assertAllowed()
      const response = await apiFetch('GET', appendQuery('/api/returns/export', buildQueryString({ ...query, ...(cursor ? { cursor } : {}), ...(snapshotToken ? { snapshotToken } : {}) })), undefined, 30000, { signal }) as ReturnStatementPage<T>
      options.assertAllowed()
      queryForVerify = query
      tokenForVerify = response.snapshotToken
      totalForVerify = response.total
      if (Array.isArray(response.rows)) received += response.rows.length
      options.onProgress?.(received, response.total)
      return response
    },
    verifySnapshot: verify,
  })
  if (options.expectedIds && (complete.rows.length !== options.expectedIds.length || complete.rows.some(row => !options.expectedIds!.includes(row.id)))) throw new Error('Selected returns changed or are unavailable; review the selection')
  return {
    ...complete,
    verifyBeforeExport: async () => { complete.assertCurrent(); await verify(); complete.assertCurrent(); options.assertAllowed() },
  }
}
