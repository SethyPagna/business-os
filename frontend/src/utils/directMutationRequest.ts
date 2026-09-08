export type DirectMutationKind = 'sale-status' | 'return-edit' | 'return-history'

export interface PendingDirectMutation<TBody extends Record<string, unknown> = Record<string, unknown>> {
  version: 1
  kind: DirectMutationKind
  actorId: string
  entityId: string
  body: TBody
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function normalizedScopePart(value: unknown): string {
  const normalized = String(value ?? '').trim()
  return normalized || 'unknown'
}

export function directMutationStorageKey(kind: DirectMutationKind, actorId: unknown, entityId: unknown): string {
  return `businessos_pending_${kind}_v1:${normalizedScopePart(actorId)}:${normalizedScopePart(entityId)}`
}

function directMutationSlotKey(kind: DirectMutationKind, actorId: unknown): string {
  return `businessos_pending_${kind}_v1:${normalizedScopePart(actorId)}:active`
}

function isPreparedMutationBody(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof (value as { client_request_id?: unknown }).client_request_id === 'string'
    && String((value as { client_request_id: string }).client_request_id).trim().length > 0
}

/** Freeze at the JSON boundary used by apiFetch and sessionStorage. */
export function freezeDirectMutationBody<TBody extends Record<string, unknown>>(body: TBody): TBody {
  return JSON.parse(JSON.stringify(body)) as TBody
}

export function loadPendingDirectMutation<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  storage: SessionStore | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): PendingDirectMutation<TBody> | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(directMutationStorageKey(kind, actorId, entityId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingDirectMutation<TBody>
    if (
      parsed?.version !== 1
      || parsed.kind !== kind
      || parsed.actorId !== normalizedScopePart(actorId)
      || parsed.entityId !== normalizedScopePart(entityId)
      || !isPreparedMutationBody(parsed.body)
    ) return null
    return { ...parsed, body: freezeDirectMutationBody(parsed.body) }
  } catch {
    return null
  }
}

export function savePendingDirectMutation<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  body: TBody | null,
  storage: SessionStore | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): PendingDirectMutation<TBody> | null {
  const pending: PendingDirectMutation<TBody> | null = body ? {
    version: 1,
    kind,
    actorId: normalizedScopePart(actorId),
    entityId: normalizedScopePart(entityId),
    body: freezeDirectMutationBody(body),
  } : null
  if (!storage) return pending
  const key = directMutationStorageKey(kind, actorId, entityId)
  try {
    if (pending) storage.setItem(key, JSON.stringify(pending))
    else storage.removeItem(key)
  } catch { /* memory-only fallback */ }
  return pending
}

export function loadPendingDirectMutationSlot<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  storage: SessionStore | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): PendingDirectMutation<TBody> | null {
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(directMutationSlotKey(kind, actorId)) || 'null') as PendingDirectMutation<TBody> | null
    if (
      parsed?.version !== 1
      || parsed.kind !== kind
      || parsed.actorId !== normalizedScopePart(actorId)
      || !parsed.entityId
      || !isPreparedMutationBody(parsed.body)
    ) return null
    return { ...parsed, body: freezeDirectMutationBody(parsed.body) }
  } catch {
    return null
  }
}

export function savePendingDirectMutationSlot<TBody extends Record<string, unknown>>(
  kind: DirectMutationKind,
  actorId: unknown,
  entityId: unknown,
  body: TBody | null,
  storage: SessionStore | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): PendingDirectMutation<TBody> | null {
  const pending: PendingDirectMutation<TBody> | null = body ? {
    version: 1,
    kind,
    actorId: normalizedScopePart(actorId),
    entityId: normalizedScopePart(entityId),
    body: freezeDirectMutationBody(body),
  } : null
  if (!storage) return pending
  try {
    const key = directMutationSlotKey(kind, actorId)
    if (pending) storage.setItem(key, JSON.stringify(pending))
    else storage.removeItem(key)
  } catch { /* memory-only fallback */ }
  return pending
}

/** True only when a write may have reached the server without a readable result. */
export function directMutationOutcomeIsUnknown(error: unknown): boolean {
  const row = (error || {}) as { code?: unknown; status?: unknown; reason?: unknown; name?: unknown }
  const status = Number(row.status)
  if (Number.isFinite(status) && status > 0) return status >= 500
  const code = String(row.code || '').toLowerCase()
  if (code === 'loader_timeout' || code === 'request_timeout') return true
  if (code === 'write_requires_live_server') return String(row.reason || '') === 'server_unreachable'
  if (String(row.name || '') === 'AbortError') return false
  return true
}
