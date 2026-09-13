export type DirectMutationKind = 'sale-status' | 'return-edit' | 'return-history' | 'sale-add-items' | 'sale-amendment'
export type SaleLineMutationKind = 'sale-add-items' | 'sale-amendment'
const isSaleLineKind = (kind: DirectMutationKind): kind is SaleLineMutationKind => kind === 'sale-add-items' || kind === 'sale-amendment'
const isSaleLineStorageKey = (key: string): boolean => key.startsWith('businessos_pending_sale-add-items_v2:') || key.startsWith('businessos_pending_sale-amendment_v2:')
export type DirectMutationDirection = 'undo' | 'redo'

export interface DirectMutationHistoryContext {
  entryId: string
  direction: DirectMutationDirection
}

export interface PendingDirectMutation<TBody extends Record<string, unknown> = Record<string, unknown>> {
  version: 2
  kind: DirectMutationKind
  actorId: string
  entityId: string
  createdAt: number
  reconcileAfter: number
  needsReconciliation: boolean
  history: DirectMutationHistoryContext | null
  body: TBody
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>

export const DIRECT_MUTATION_MAX_PENDING = 24
export const DIRECT_MUTATION_MAX_SERIALIZED_CHARS = 131072
export const DIRECT_MUTATION_RECONCILE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const STORAGE_PREFIX = 'businessos_pending_'

export class DirectMutationPersistenceError extends Error {
  code = 'pending_request_persistence_failed'

  constructor(message = 'This request was not sent because its retry record could not be saved. Clear an older pending retry or browser site storage, then try again.') {
    super(message)
    this.name = 'DirectMutationPersistenceError'
  }
}

function normalizedScopePart(value: unknown): string {
  return String(value ?? '').trim()
}

export function pendingDirectMutationForScope<TBody extends Record<string, unknown>>(
  pending: PendingDirectMutation<TBody> | null | undefined,
  actorId: unknown,
  entityId?: unknown,
): PendingDirectMutation<TBody> | null {
  if (!pending) return null
  const actor = normalizedScopePart(actorId)
  if (!actor || pending.actorId !== actor) return null
  if (entityId !== undefined && pending.entityId !== normalizedScopePart(entityId)) return null
  return pending
}

function requireActorId(actorId: unknown): string {
  const normalized = normalizedScopePart(actorId)
  if (!normalized) throw new DirectMutationPersistenceError('This request was not sent because the signed-in user could not be identified. Sign in again, then retry.')
  return normalized
}

function defaultSessionStore(): SessionStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function directMutationStorageKey(kind: DirectMutationKind, actorId: unknown, entityId: unknown): string {
  return `${STORAGE_PREFIX}${kind}_v2:${requireActorId(actorId)}:${normalizedScopePart(entityId)}`
}

function directMutationSlotKey(kind: DirectMutationKind, actorId: unknown): string {
  return `${STORAGE_PREFIX}${kind}_v2:${requireActorId(actorId)}:active`
}

/** Freeze at the JSON boundary used by apiFetch and sessionStorage. */
export function freezeDirectMutationBody<TBody extends Record<string, unknown>>(body: TBody): TBody {
  return JSON.parse(JSON.stringify(body)) as TBody
}

function isPreparedMutationBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as { client_request_id?: unknown }).client_request_id === 'string'
    && String((value as { client_request_id: string }).client_request_id).trim().length > 0
}

function isPreparedSaleLineBody(kind: SaleLineMutationKind, value: unknown): value is Record<string, unknown> {
  if (!isPreparedMutationBody(value)) return false
  const row = value as Record<string, unknown>
  if (row.money_precision_version !== 1 || typeof row.expected_updated_at !== 'string' || !row.expected_updated_at.trim()
    || typeof row.expected_exchange_rate !== 'number' || !Number.isFinite(row.expected_exchange_rate) || row.expected_exchange_rate <= 0) return false
  if (kind === 'sale-add-items') return Array.isArray(row.items) && row.items.length > 0 && row.items.every(item => !!item && typeof item === 'object' && !Array.isArray(item)
    && Number.isSafeInteger(item.product_id) && item.product_id > 0 && typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
    && typeof item.client_line_key === 'string' && item.client_line_key.trim() && item.pricing_quote && typeof item.pricing_quote === 'object')
    && !!row.expected_header_quote && typeof row.expected_header_quote === 'object'
  return ['line_updated', 'line_removed', 'line_replaced', 'line_quantity_increased', 'line_quantity_decreased', 'delivery_fee_changed', 'delivery_actual_cost_changed', 'delivery_added'].includes(String(row.kind))
    && (row.kind === 'delivery_actual_cost_changed' || (!!row.expected_header_quote && typeof row.expected_header_quote === 'object'))
}

function normalizeHistory(value: unknown): DirectMutationHistoryContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as { entryId?: unknown; direction?: unknown }
  const entryId = String(row.entryId || '').trim()
  if (!entryId || (row.direction !== 'undo' && row.direction !== 'redo')) return null
  return { entryId, direction: row.direction }
}

function parsePending<TBody extends Record<string, unknown>>(
  raw: string,
  kind: DirectMutationKind,
  actorId: string,
  entityId?: string,
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  const parsed = JSON.parse(raw) as Partial<PendingDirectMutation<TBody>> | null
  if (
    parsed?.version !== 2
    || parsed.kind !== kind
    || parsed.actorId !== actorId
    || !String(parsed.entityId || '').trim()
    || (entityId != null && parsed.entityId !== entityId)
    || !Number.isFinite(parsed.createdAt)
    || !Number.isFinite(parsed.reconcileAfter)
    || !isPreparedMutationBody(parsed.body)
    || (isSaleLineKind(kind) && !isPreparedSaleLineBody(kind, parsed.body))
  ) return null
  return {
    version: 2,
    kind,
    actorId,
    entityId: String(parsed.entityId),
    createdAt: Number(parsed.createdAt),
    reconcileAfter: Number(parsed.reconcileAfter),
    needsReconciliation: now >= Number(parsed.reconcileAfter),
    history: normalizeHistory(parsed.history),
    body: freezeDirectMutationBody(parsed.body) as TBody,
  }
}

function readPending<TBody extends Record<string, unknown>>(
  key: string,
  kind: DirectMutationKind,
  actorId: string,
  entityId: string | undefined,
  storage: SessionStore | null,
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  if (!storage) {
    if (isSaleLineKind(kind)) throw new DirectMutationPersistenceError()
    return null
  }
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = parsePending<TBody>(raw, kind, actorId, entityId, now)
    if (!parsed && isSaleLineKind(kind)) throw new DirectMutationPersistenceError('The saved sale request cannot be read safely. It has been preserved for reconciliation.')
    if (!parsed) storage.removeItem(key)
    return parsed
  } catch {
    if (isSaleLineKind(kind)) throw new DirectMutationPersistenceError('The saved sale request cannot be read safely. It has been preserved for reconciliation.')
    try { storage.removeItem(key) } catch { /* invalid entry remains harmless */ }
    return null
  }
}

function pendingEntryCount(storage: SessionStore, targetKey: string): number {
  let count = 0
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX) || key === targetKey) continue
    const raw = storage.getItem(key)
    if (!raw) continue
    // Corrupt/foreign financial attempts still occupy a slot. Counting other
    // kinds must never silently remove evidence from the new sale lanes.
    if (isSaleLineStorageKey(key)) { count += 1; continue }
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; body?: unknown; actorId?: unknown; entityId?: unknown }
      if (parsed?.version !== 2 || !isPreparedMutationBody(parsed.body) || !String(parsed.actorId || '').trim() || !String(parsed.entityId || '').trim()) {
        storage.removeItem(key)
        continue
      }
      count += 1
    } catch {
      storage.removeItem(key)
    }
  }
  return count
}

function persistPending<TBody extends Record<string, unknown>>(
  key: string,
  pending: PendingDirectMutation<TBody> | null,
  storage: SessionStore | null,
): PendingDirectMutation<TBody> | null {
  if (!storage) throw new DirectMutationPersistenceError()
  try {
    if (!pending) {
      storage.removeItem(key)
      if (storage.getItem(key) != null) throw new Error('pending retry was not removed')
      return null
    }
    const serialized = JSON.stringify({ ...pending, needsReconciliation: undefined })
    if (serialized.length > DIRECT_MUTATION_MAX_SERIALIZED_CHARS) {
      throw new DirectMutationPersistenceError('This request was not sent because its retry record is too large for safe browser storage. Reduce the edited return and try again.')
    }
    if (storage.getItem(key) == null && pendingEntryCount(storage, key) >= DIRECT_MUTATION_MAX_PENDING) {
      throw new DirectMutationPersistenceError('This request was not sent because too many earlier requests still need reconciliation. Resolve or discard an older pending retry first.')
    }
    storage.setItem(key, serialized)
    if (storage.getItem(key) !== serialized) throw new Error('pending retry read-back did not match')
    return pending
  } catch (error) {
    if (error instanceof DirectMutationPersistenceError) throw error
    throw new DirectMutationPersistenceError()
  }
}

function buildPending<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: string,
  entityId: unknown,
  body: TBody,
  history: DirectMutationHistoryContext | null,
  now = Date.now(),
): PendingDirectMutation<TBody> {
  if (!isPreparedMutationBody(body)) throw new DirectMutationPersistenceError('This request was not sent because its retry identity is missing. Refresh and try again.')
  if (isSaleLineKind(kind) && !isPreparedSaleLineBody(kind, freezeDirectMutationBody(body))) throw new DirectMutationPersistenceError('This sale request is incomplete. Its exact review must be prepared before sending.')
  return {
    version: 2,
    kind,
    actorId,
    entityId: normalizedScopePart(entityId),
    createdAt: now,
    reconcileAfter: now + DIRECT_MUTATION_RECONCILE_AFTER_MS,
    needsReconciliation: false,
    history: normalizeHistory(history),
    body: freezeDirectMutationBody(body),
  }
}

export function loadPendingDirectMutation<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  storage: SessionStore | null = defaultSessionStore(),
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  const actor = normalizedScopePart(actorId)
  const entity = normalizedScopePart(entityId)
  if (!actor || !entity) return null
  return readPending(directMutationStorageKey(kind, actor, entity), kind, actor, entity, storage, now)
}

export function savePendingDirectMutation<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  body: TBody | null,
  storage: SessionStore | null = defaultSessionStore(),
  history: DirectMutationHistoryContext | null = null,
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  const actor = requireActorId(actorId)
  const entity = normalizedScopePart(entityId)
  if (!entity) throw new DirectMutationPersistenceError('This request was not sent because its target could not be identified. Refresh and try again.')
  const key = directMutationStorageKey(kind, actor, entity)
  if (isSaleLineKind(kind)) {
    if (!body) throw new DirectMutationPersistenceError('Sale requests require an exact receipt-bound release.')
    const pending = readPending<TBody>(key, kind, actor, entity, storage, now)
    if (pending) {
      if (JSON.stringify(pending.body) !== JSON.stringify(freezeDirectMutationBody(body))) throw new DirectMutationPersistenceError('An earlier sale request is still awaiting reconciliation. Its exact body has been preserved.')
      return pending
    }
  }
  return persistPending(key, body ? buildPending(kind, actor, entity, body, history, now) : null, storage)
}

export function loadPendingDirectMutationSlot<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  storage: SessionStore | null = defaultSessionStore(),
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  const actor = normalizedScopePart(actorId)
  if (!actor) return null
  return readPending(directMutationSlotKey(kind, actor), kind, actor, undefined, storage, now)
}

export function savePendingDirectMutationSlot<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  body: TBody | null,
  storage: SessionStore | null = defaultSessionStore(),
  history: DirectMutationHistoryContext | null = null,
  now = Date.now(),
): PendingDirectMutation<TBody> | null {
  const actor = requireActorId(actorId)
  const entity = normalizedScopePart(entityId)
  if (!entity) throw new DirectMutationPersistenceError('This request was not sent because its target could not be identified. Refresh and try again.')
  const key = directMutationSlotKey(kind, actor)
  if (isSaleLineKind(kind)) throw new DirectMutationPersistenceError('Sale line requests use a sale-specific durable slot.')
  return persistPending(key, body ? buildPending(kind, actor, entity, body, history, now) : null, storage)
}

/** Release only the exact attempt the caller has authoritatively reconciled.
 * A newer request or corrupted record is never erased by a late response. */
export function releasePendingSaleLineMutation(kind: SaleLineMutationKind, actorId: unknown, entityId: unknown,
  expectedBody: Record<string, unknown>, storage: SessionStore): void {
  const actor = requireActorId(actorId), entity = normalizedScopePart(entityId)
  const key = directMutationStorageKey(kind, actor, entity)
  const pending = readPending(key, kind, actor, entity, storage)
  if (!pending || JSON.stringify(pending.body) !== JSON.stringify(freezeDirectMutationBody(expectedBody))) throw new DirectMutationPersistenceError('The saved sale request changed. Reconcile it before continuing.')
  persistPending(key, null, storage)
}

/** The storage check/reserve/release must be one origin-wide critical section.
 * Hold only for local synchronous bookkeeping, never for a network request.
 * Unsupported browsers refuse admission rather than use a racy check/set. */
export async function withSaleLineMutationLock<T>(actorId: unknown, entityId: unknown,
  isCurrent: () => boolean, action: () => T): Promise<T> {
  const actor = requireActorId(actorId), entity = normalizedScopePart(entityId)
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!entity || !locks?.request) throw new DirectMutationPersistenceError('Safe sale recovery is unavailable in this browser. No request was sent.')
  return locks.request(`businessos-sale-line-mutation:${actor}:${entity}`, { mode: 'exclusive' }, () => {
    if (!isCurrent()) throw new DirectMutationPersistenceError('The signed-in session changed. No new sale request was sent.')
    return action()
  })
}

/** Caller must hold the sale lock and have an explicit, receipt-first server
 * proof of no commit. This changes ONLY the reviewed header and request id;
 * the original line/manual/lot intent and expected row version stay exact. */
export function replaceReviewedSaleLineHeader(kind: SaleLineMutationKind, actorId: unknown, entityId: unknown,
  oldBody: Record<string, unknown>, newBody: Record<string, unknown>, storage: SessionStore): void {
  const actor = requireActorId(actorId), entity = normalizedScopePart(entityId), key = directMutationStorageKey(kind, actor, entity)
  const pending = readPending(key, kind, actor, entity, storage)
  const fixedIntent = (body: Record<string, unknown>) => { const { client_request_id: _id, expected_header_quote: _quote, ...rest } = body; return JSON.stringify(rest) }
  if (!pending || JSON.stringify(pending.body) !== JSON.stringify(freezeDirectMutationBody(oldBody))
    || newBody.client_request_id === oldBody.client_request_id || fixedIntent(oldBody) !== fixedIntent(newBody)) throw new DirectMutationPersistenceError('The saved request changed; its original intent was preserved.')
  persistPending(key, buildPending(kind, actor, entity, newBody, null), storage)
}

/** One exact-body path for a fresh submission, explicit retry or reopened
 * read-only recovery. Missing/denied receipt proof never changes the body. */
export async function runSaleLineMutation<T>(options: {
  kind: SaleLineMutationKind; actorId: string; entityId: string; storage: SessionStore;
  body?: Record<string, unknown>; readOnly?: boolean; isCurrent: () => boolean;
  readReceipt: (body: Record<string, unknown>) => Promise<{ committed: boolean; response?: Record<string, unknown> }>;
  send: (body: Record<string, unknown>) => Promise<T>; isCommitted: (result: T) => boolean;
  onPending?: (body: Record<string, unknown>) => void;
}): Promise<{ committed: boolean; response?: Record<string, unknown>; result?: T; body: Record<string, unknown> }> {
  const { kind, actorId, entityId, storage } = options
  const admitted = await withSaleLineMutationLock(actorId, entityId, options.isCurrent, () => {
    const opposite: SaleLineMutationKind = kind === 'sale-add-items' ? 'sale-amendment' : 'sale-add-items'
    if (loadPendingDirectMutation(opposite, actorId, entityId, storage)) throw new DirectMutationPersistenceError('Another change to this sale is awaiting reconciliation.')
    const prior = loadPendingDirectMutation(kind, actorId, entityId, storage)
    if (prior) {
      if (options.body && JSON.stringify(freezeDirectMutationBody(options.body)) !== JSON.stringify(prior.body)) throw new DirectMutationPersistenceError('Review the existing pending sale request before starting a different change.')
      return { body: prior.body, retry: true }
    }
    if (!options.body || options.readOnly) throw new DirectMutationPersistenceError('No prepared sale request is available for recovery.')
    return { body: savePendingDirectMutation(kind, actorId, entityId, options.body, storage)!.body, retry: false }
  })
  const current = () => { if (!options.isCurrent()) throw new DirectMutationPersistenceError('The session changed; the saved request remains available to its original owner.') }
  current()
  options.onPending?.(freezeDirectMutationBody(admitted.body))
  const release = () => withSaleLineMutationLock(actorId, entityId, options.isCurrent,
    () => releasePendingSaleLineMutation(kind, actorId, entityId, admitted.body, storage))
  if (admitted.retry) {
    const receipt = await options.readReceipt(freezeDirectMutationBody(admitted.body))
    current()
    if (receipt.committed === true && receipt.response) {
      await release()
      return { committed: true, response: receipt.response, body: admitted.body }
    }
    if (receipt.committed !== false) throw new DirectMutationPersistenceError('The sale receipt could not be verified. The original request remains frozen.')
    if (options.readOnly) return { committed: false, body: admitted.body }
  }
  current()
  const result = await options.send(freezeDirectMutationBody(admitted.body))
  current()
  const committed = options.isCommitted(result)
  if (committed) await release()
  return { committed, result, body: admitted.body }
}

/** True only when a write may have reached the server without a readable result. */
export function directMutationOutcomeIsUnknown(error: unknown): boolean {
  const row = (error || {}) as { code?: unknown; status?: unknown; reason?: unknown; name?: unknown }
  const status = Number(row.status)
  if (Number.isFinite(status) && status > 0) return status >= 500
  const code = String(row.code || '').toLowerCase()
  if (code === 'pending_request_persistence_failed') return false
  if (code === 'loader_timeout' || code === 'request_timeout') return true
  if (code === 'write_requires_live_server') return String(row.reason || '') === 'server_unreachable'
  if (String(row.name || '') === 'AbortError') return false
  return true
}

/** Missing receipts and stale reads never prove a mutation committed. */
export async function reconcileDirectMutationReceipt(
  read: () => Promise<{ committed: boolean; response?: Record<string, unknown> }>,
  pause: (attempt: number) => Promise<void> = async () => {},
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const receipt = await read()
      if (receipt.committed === true && receipt.response) return receipt.response
    } catch (error) {
      if (!directMutationOutcomeIsUnknown(error)) return null
    }
    if (attempt < 2) await pause(attempt)
  }
  return null
}

export function mutationVersionAtLeast(actual: unknown, committed: unknown): boolean {
  if (!committed) return true
  if (actual === committed) return true
  const stamp = (value: unknown) => Date.parse(String(value || '').replace(' ', 'T').replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/, '$1Z'))
  const left = stamp(actual)
  const right = stamp(committed)
  return Number.isFinite(left) && Number.isFinite(right) && left >= right
}

/** A present but stale row is not a reason to stop the bounded read loop. */
export async function readCommittedMutationState<T>(
  read: () => Promise<T | null>,
  accept: (value: T) => boolean,
  pause: (attempt: number) => Promise<void> = async () => {},
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const value = await read()
      if (value && accept(value)) return value
    } catch { /* A failed read never fabricates an authoritative row. */ }
    if (attempt < 2) await pause(attempt)
  }
  return null
}
