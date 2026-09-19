import { Hono } from 'hono'
import { acquisitionCostResponses } from '../lib/acquisitionCostAccess'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, isActionBlocked } from '../lib/permissions'
import type { Env } from '../index'
import { runAdjustAction, type InventoryContext } from './inventory'
import { runReceiveBatchAction, type ReceiveBody } from './batches'

// P4-B: the fast stock-in modal used to commit its pending lines one at a
// time -- N lines meant N sequential POST /api/inventory/adjust or POST
// /api/batches round trips, each one its own Worker invocation across
// whatever region D1 answered from. That per-request latency, not D1 write
// time, was the dominant cost of a multi-line session (FastStockInModal.tsx
// ~line 646's `for (const line of pending) { await ... }`).
//
// This route collapses the HTTP side of that to ONE request for the whole
// session. It does NOT re-implement stock-write validation: every line runs
// through the exact same kernel the single-line endpoints call --
// routes/inventory.ts's runAdjustAction (exported, unchanged body, only
// pulled out from behind `app.post('/adjust', ...)`) or routes/batches.ts's
// runReceiveBatchAction (same extraction). Same Hono Context object is
// reused across every line in the loop below, so c.env/c.executionCtx and
// the resolved user are identical to what a real per-line request would see;
// only c.req.json() parsing is skipped because the line body arrives
// pre-parsed in this route's own request.
//
// What is NOT batched, on purpose: each kernel call still does its own
// sequential D1 reads (resolve target product/variant, existing lot lookup)
// interleaved with its own writes (mostly one env.DB.batch() per line inside
// the kernel already -- see lib/productBatches.ts's receiveBatchStock and
// removeStockFromBatch/removeStockAcrossBatches). Combining N lines' reads
// and writes into fewer than N round trips to D1 itself would require the
// kernels to return statement lists instead of executing directly, which
// they do not; that is a larger change than this lane's scope covers (see
// the lane brief's own "read-then-write per line, document it" allowance).
// The win here is entirely the collapsed HTTP hop count: 1 request instead
// of N, same D1 traffic per line as before.
//
// Quota: bumpVersion()/audit() inside each reused kernel already call
// consumeQuota('kv_write', 1) once per line (lib/cache.ts), exactly as the
// N separate requests did before. This route does not call consumeQuota
// itself -- doing so would double-count every line's kv_write against the
// free-plan budget.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
app.use('*', acquisitionCostResponses)

export type StockInCommitLine =
  | { key?: string; wire: 'adjust'; body: Record<string, unknown> }
  | { key?: string; wire: 'receive'; body: ReceiveBody }

export interface StockInCommitLineResult {
  ok: boolean
  key?: string
  error?: string
  [field: string]: unknown
}

// Same predicate POST /api/batches' own `app.use('*', ...)` write gate uses
// for a non-GET/HEAD request (routes/batches.ts) -- reproduced here (not
// re-derived) because that gate lives on the batches Hono app's own
// middleware chain, which this route bypasses by calling runReceiveBatchAction
// directly instead of routing an HTTP request through it.
function canReceiveBatchStock(user: SessionUser | undefined): boolean {
  return hasPermission(user, 'inventory') && !isActionBlocked(user, 'inventory', 'adjust')
}

async function runLine(c: InventoryContext, line: StockInCommitLine): Promise<StockInCommitLineResult> {
  try {
    if (line.wire === 'receive') {
      const user = c.get('user')
      if (!canReceiveBatchStock(user)) {
        return { ok: false, key: line.key, error: 'You do not have permission to perform this action' }
      }
      const res = await runReceiveBatchAction(c, line.body)
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status >= 200 && res.status < 300) return { ok: true, key: line.key, ...json }
      return { ok: false, key: line.key, error: String(json.error || 'Failed to receive stock') }
    }
    const res = await runAdjustAction(c, line.body)
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status >= 200 && res.status < 300) return { ok: true, key: line.key, ...json }
    return { ok: false, key: line.key, error: String(json.error || 'Failed to adjust stock') }
  } catch (error) {
    return { ok: false, key: line.key, error: error instanceof Error ? error.message : 'Failed' }
  }
}

// POST /api/inventory/fast-stock-in/commit -- body: { lines: StockInCommitLine[] }.
// Lines run in order, sequentially (each kernel call may read-then-write
// against the same product/branch as its neighbours, so out-of-order or
// concurrent execution could race two lines touching the same lot). A
// failure on one line does not stop the rest -- exactly the old per-line
// loop's behaviour, where each `await adjustStock(...)`/`await
// receiveBatchStock(...)` sat in its own try/catch and the for-loop kept
// going after a caught error. `results` always has one entry per input line,
// in the same order, so the caller can map status back onto its own list by
// index without depending on `key`.
// Exported separately from the route registration so scripts/test-fast-stock-in-commit-pure.cjs
// can call it directly with a fake Context, the same way runAdjustAction and
// runReceiveBatchAction are tested -- no real Hono app.request() round trip
// needed to exercise the ordering/permission/kernel-parity behaviour.
export async function runStockInCommit(c: InventoryContext, lines: StockInCommitLine[]): Promise<StockInCommitLineResult[]> {
  const results: StockInCommitLineResult[] = []
  for (const line of lines) {
    results.push(await runLine(c, line))
  }
  return results
}

app.post('/commit', async (c) => {
  const body = (await c.req.json<{ lines?: unknown }>().catch(() => ({}))) as { lines?: unknown }
  const lines = Array.isArray(body.lines) ? (body.lines as StockInCommitLine[]) : []
  if (lines.length === 0) return c.json({ error: 'lines must be a non-empty array' }, 400)
  const results = await runStockInCommit(c as InventoryContext, lines)
  return c.json({ results })
})

export default app
