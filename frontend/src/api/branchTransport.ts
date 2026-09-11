import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { dispatchResolvedSyncError, type SyncProblemReference } from '../utils/syncProblemLifecycle.ts'

type BranchPayload = ExpectedUpdatedAtPayload
const BRANCH_MIRROR_WRITE_DELAY_MS = 10_000

export type PendingTransferRun = {
  version: 1
  actorId: string
  requests: Array<{ bulk: boolean; body: BranchPayload }>
  next: number
  transferred: number
  merges: number
  historyReceipts?: Array<{ operation_id: string; action_history_id: number; generation: number; provenance_version: 1 }>
  syncProblem?: SyncProblemReference
}

type TransferStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function transferStore(): TransferStore {
  return window.sessionStorage
}
function transferRunKey(actorId: unknown): string {
  if (!String(actorId ?? '').trim()) throw new Error('Sign in before transferring stock.')
  return `businessos_pending_transfer_v1:${actorId}`
}

/** Capture device metadata, nested items and the key once, before network I/O. */
export function prepareTransferRun(actorId: unknown, payloads: Array<{ bulk: boolean; body: BranchPayload }>): PendingTransferRun {
  transferRunKey(actorId)
  return JSON.parse(JSON.stringify({
    version: 1, actorId: String(actorId), next: 0, transferred: 0, merges: 0,
    requests: payloads.map(({ bulk, body }) => ({
      bulk, body: ensureClientRequestId({ ...getDevicePayload(), ...body, transfer_provenance_version: 1 }, bulk ? 'transfer-bulk' : 'transfer'),
    })),
  })) as PendingTransferRun
}

export function loadTransferRun(actorId: unknown, storage?: TransferStore): PendingTransferRun | null {
  if (!String(actorId ?? '').trim()) return null
  const raw = (storage ?? transferStore()).getItem(transferRunKey(actorId))
  if (!raw) return null
  const run = JSON.parse(raw) as PendingTransferRun
  if (run.version !== 1 || run.actorId !== String(actorId) || !Array.isArray(run.requests)
    || !run.requests.length || !Number.isInteger(run.next) || run.next < 0 || run.next > run.requests.length
    || run.requests.some((request) => typeof request.bulk !== 'boolean' || !request.body?.client_request_id)) {
    throw new Error('The saved transfer cannot be read. Check transfer history before clearing browser storage.')
  }
  return run
}

export function saveTransferRun(actorId: unknown, run: PendingTransferRun | null, storage?: TransferStore): void {
  const key = transferRunKey(actorId)
  const store = storage ?? transferStore()
  if (run && run.actorId !== String(actorId)) throw new Error('The saved transfer belongs to another user.')
  if (!run) { store.removeItem(key); if (store.getItem(key) != null) throw new Error('The saved transfer could not be cleared.'); return }
  const serialized = JSON.stringify(run)
  const existing = loadTransferRun(actorId, store)
  if (existing && existing.requests[0].body.client_request_id !== run.requests[0].body.client_request_id) {
    throw new Error('Resolve or discard the saved transfer before starting another.')
  }
  store.setItem(key, serialized)
  if (store.getItem(key) !== serialized) throw new Error('The transfer retry could not be saved. No new request was sent.')
}

/** Checkpoint only confirmed responses. A lost reply leaves the same chunk/key pending. */
export async function executeTransferRun(
  run: PendingTransferRun,
  checkpoint: (next: PendingTransferRun) => void,
  send: (request: PendingTransferRun['requests'][number]) => Promise<unknown> = (request) => request.bulk
    ? transferStockBulk(request.body) : transferStock(request.body),
): Promise<PendingTransferRun> {
  let current = run
  while (current.next < current.requests.length) {
    const request = current.requests[current.next]
    let result: { success?: boolean; error?: string; transferredCount?: number; merges?: unknown[]; operation_id?: string; action_history_id?: number; generation?: number; provenance_version?: number }
    try { result = await send(request) as typeof result }
    catch (error) {
      const problem = error as { syncErrorId?: string; syncErrorChannel?: string; code?: string }
      if (problem?.syncErrorId) checkpoint({ ...current, syncProblem: { errorId: problem.syncErrorId, channel: problem.syncErrorChannel, code: problem.code } })
      throw error
    }
    if (!result || result.success === false) throw new Error(result?.error || 'Transfer failed')
    const next = { ...current, next: current.next + 1,
      transferred: current.transferred + (result.transferredCount ?? (request.bulk ? (request.body.items as unknown[]).length : 1)),
      merges: current.merges + (result.merges?.length ?? 0),
      historyReceipts: [...(current.historyReceipts || []), ...(result.provenance_version === 1 && result.operation_id && result.action_history_id != null && Number.isInteger(result.generation)
        ? [{ operation_id: result.operation_id, action_history_id: result.action_history_id, generation: result.generation!, provenance_version: 1 as const }] : [])] }
    checkpoint(next)
    dispatchResolvedSyncError(current.syncProblem)
    current = next
  }
  return current
}

function getDevicePayload(): BranchPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getBranches(): Promise<unknown> {
  return route(
    'branches:get',
    async () => {
      const result = await apiFetch('GET', '/api/branches')
      const run = (): void => {
        import('./localMirrors.ts')
          .then(({ mirrorTable }) => mirrorTable('branches')(result))
          .catch(() => {})
      }
      if (typeof window === 'undefined') Promise.resolve().then(run).catch(() => {})
      else window.setTimeout(run, BRANCH_MIRROR_WRITE_DELAY_MS)
      return result
    },
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('branches').toArray()
    },
    { raceLocalFallback: false },
  )
}

export function createBranch(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:create',
    () => apiFetch('POST', '/api/branches', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export async function updateBranch(id: string | number, payload: BranchPayload = {}): Promise<unknown> {
  const body = await withExpectedUpdatedAt('branches', id, { ...getDevicePayload(), ...(payload || {}) })
  return route(
    'branches:update',
    () => apiFetch('PUT', `/api/branches/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteBranch(
  id: string | number,
  userId: string | number | null,
  userName: string | null,
): Promise<unknown> {
  const payload = await withExpectedUpdatedAt('branches', id, { userId, userName })
  return route(
    'branches:delete',
    () => apiFetch('DELETE', `/api/branches/${encodeId(id)}`, payload),
    null,
    true,
  )
}

export function getBranchStock(id: string | number, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `branches:stock:${id}:${query}`,
    () => apiFetch('GET', appendQuery(`/api/branches/${encodeId(id)}/stock`, query)),
    () => [],
  )
}

/** Current stock is deliberately independent of a history date range. */
export function getBranchSummary(): Promise<unknown> {
  return route('branches:summary', () => apiFetch('GET', '/api/branches/summary'), null)
}

export function getTransfers(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `transfers:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/transfers', query)),
    async () => {
      const { getLocalDb } = await import('./lazyLocalDb.ts')
      const db = await getLocalDb()
      return db.table('stock_transfers').orderBy('created_at').reverse().toArray()
    },
    { raceLocalFallback: false },
  )
}

// Both transfer endpoints REQUIRE a non-empty `reason` in the payload: every
// Worker route that moves stock refuses a reasonless one (branches.ts POST
// /transfer and /transfer-bulk, inventory.ts POST /transfer and /move-row),
// and TransferModal will not submit without one.
//
// Transfers require the live server (the trailing `true`). A request written by an
// older build can still arrive after this one shipped. Those payloads carry
// the old optional `note` instead; the Worker accepts a non-empty `note` as
// the reason for exactly that reason. Nothing new should send `note`.
export function transferStock(payload: BranchPayload = {}): Promise<unknown> {
  const body = payload.client_request_id ? JSON.parse(JSON.stringify(payload)) : ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer')
  body.transfer_provenance_version = 1
  return route(
    'branches:transfer',
    () => apiFetch('POST', '/api/branches/transfer', body),
    null,
    true,
  )
}

export function transferStockBulk(payload: BranchPayload = {}): Promise<unknown> {
  const body = payload.client_request_id ? JSON.parse(JSON.stringify(payload)) : ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer-bulk')
  body.transfer_provenance_version = 1
  return route(
    'branches:transfer-bulk',
    () => apiFetch('POST', '/api/branches/transfer-bulk', body, 90_000),
    null,
    true,
  )
}

export function getBranchStockIntegrity(): Promise<unknown> {
  return route(
    'branches:stockIntegrity',
    () => apiFetch('GET', '/api/branches/stock-integrity'),
    () => ({ issues: [], summary: {} }),
  )
}

export function repairBranchStockIntegrity(payload: BranchPayload = {}): Promise<unknown> {
  return route(
    'branches:stockIntegrity:repair',
    () => apiFetch('POST', '/api/branches/stock-integrity/repair', payload),
    null,
    true,
  )
}
