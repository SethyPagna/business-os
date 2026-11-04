// Kept apart from directMutationRequest.ts so a transport can use the predicate
// without bundling the whole pending-request store into the catalog closure.
// It lives in the app-api-methods chunk (vite.config.ts), shared by feesTransport.ts
// (its own fees-api chunk) and the Returns and sale-modal paths through
// directMutationRequest.ts: left to Rollup it followed its first importer into fees-api
// and every one of those pages fetched the Expenses transport for these ten lines.

/** A 4xx other than 408/425/429 or an idempotency conflict, for a handler
 * whose 4xx answers all come before its single atomic write. */
export function directMutationRefusedBeforeWrite(error: unknown): boolean {
  const row = (error || {}) as { status?: unknown; code?: unknown }
  const status = Number(row.status || 0)
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status) && row.code !== 'idempotency_conflict'
}
