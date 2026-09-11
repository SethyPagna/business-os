import { mutationVersionAtLeast } from './directMutationRequest.ts'

export type SaleStatusRecoveryResult<T> =
  | { state: 'recovered'; sale: T }
  | { state: 'pending'; committed: boolean }
  | { state: 'superseded' }

/** Read-only recovery: only the exact operation receipt followed by a current
 * row can release a frozen request. A deadline never implies rollback. */
export async function recoverSaleStatus<T extends { updated_at?: unknown }>(options: {
  isCurrent: () => boolean
  readReceipt: () => Promise<{ committed: boolean; response?: Record<string, unknown> }>
  readSale: () => Promise<T | null>
  timeoutMs?: number
}): Promise<SaleStatusRecoveryResult<T>> {
  let committed = false
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const current = () => !expired && options.isCurrent()
  try {
    return await Promise.race([
      (async (): Promise<SaleStatusRecoveryResult<T>> => {
        if (!current()) return { state: 'superseded' }
        const receipt = await options.readReceipt()
        if (!current()) return { state: 'superseded' }
        committed = receipt.committed === true && !!receipt.response
        if (!committed) return { state: 'pending', committed: false }
        const sale = await options.readSale()
        if (!current()) return { state: 'superseded' }
        if (!sale || !mutationVersionAtLeast(sale.updated_at, receipt.response?.updated_at)) {
          return { state: 'pending', committed: true }
        }
        return { state: 'recovered', sale }
      })(),
      new Promise<SaleStatusRecoveryResult<T>>((resolve) => {
        timer = setTimeout(() => {
          expired = true
          resolve(options.isCurrent() ? { state: 'pending', committed } : { state: 'superseded' })
        }, options.timeoutMs ?? 18_000)
      }),
    ])
  } catch {
    return options.isCurrent() ? { state: 'pending', committed } : { state: 'superseded' }
  } finally {
    expired = true
    clearTimeout(timer)
  }
}
