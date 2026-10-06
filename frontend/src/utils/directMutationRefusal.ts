// Kept apart from directMutationRequest.ts so a transport on the storefront's
// boot path (feesTransport.ts -> app-api-methods) can use the predicate
// without bundling the whole pending-request store into the catalog closure.

/** A 4xx other than 408/425/429 or an idempotency conflict, for a handler
 * whose 4xx answers all come before its single atomic write. */
export function directMutationRefusedBeforeWrite(error: unknown): boolean {
  const row = (error || {}) as { status?: unknown; code?: unknown }
  const status = Number(row.status || 0)
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status) && row.code !== 'idempotency_conflict'
}
