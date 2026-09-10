export type DirectMutationKind = 'sale-status' | 'return-edit' | 'return-history'
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
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = parsePending<TBody>(raw, kind, actorId, entityId, now)
    if (!parsed) storage.removeItem(key)
    return parsed
  } catch {
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
  return persistPending(key, body ? buildPending(kind, actor, entity, body, history, now) : null, storage)
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
