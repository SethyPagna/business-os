// Optimistic concurrency control, ported from backend/src/conflictControl.ts.
// Every PUT/DELETE in the Docker backend that can be edited from two
// devices at once uses this exact pattern: the client sends back the
// updated_at it last saw: if the row has changed since, reject with 409
// instead of silently overwriting someone else's edit. Pure logic, no
// native dependencies -- this is a faithful, unmodified port, and shared
// infrastructure every future route port needs, not something specific to
// branches.

export type ConflictReason = 'updated' | 'deleted'

export class WriteConflictError extends Error {
  entity: string
  currentRecord: Record<string, unknown> | null
  expectedUpdatedAt: string | null
  reason: ConflictReason
  status: number

  constructor(entity: string, currentRecord: Record<string, unknown> | null, expectedUpdatedAt: unknown, reason: ConflictReason = 'updated') {
    super(reason === 'deleted'
      ? `This ${entity} was removed on another device. Refresh and try again.`
      : `This ${entity} changed on another device. Refresh and try again.`)
    this.name = 'WriteConflictError'
    this.entity = entity
    this.currentRecord = currentRecord || null
    this.expectedUpdatedAt = normalizeUpdatedAt(expectedUpdatedAt)
    this.reason = reason
    this.status = 409
  }
}

export function normalizeUpdatedAt(value: unknown): string | null {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function getExpectedUpdatedAt(payload: Record<string, unknown> = {}): string | null {
  return normalizeUpdatedAt(
    payload.expectedUpdatedAt ?? payload.expected_updated_at ?? payload.updated_at ?? payload.updatedAt,
  )
}

export function assertUpdatedAtMatch(entity: string, currentRecord: Record<string, unknown> | null | undefined, expectedUpdatedAt: unknown): void {
  const expected = normalizeUpdatedAt(expectedUpdatedAt)
  if (!expected) return
  if (!currentRecord) {
    throw new WriteConflictError(entity, null, expected, 'deleted')
  }
  const actual = normalizeUpdatedAt(currentRecord.updated_at)
  if (!actual || actual !== expected) {
    throw new WriteConflictError(entity, currentRecord, expected, 'updated')
  }
}

export function writeConflictResponse(error: WriteConflictError) {
  return {
    body: {
      success: false,
      error: error.message,
      code: 'write_conflict',
      conflict: true,
      entity: error.entity || null,
      reason: error.reason || 'updated',
      expectedUpdatedAt: error.expectedUpdatedAt || null,
      current: error.currentRecord || null,
      actualUpdatedAt: normalizeUpdatedAt(error.currentRecord?.updated_at),
    },
    status: (error.status || 409) as 409,
  }
}
