// Undo / Redo of a branch edit from Branches.tsx's own history closures
// (FX-undo2, refuter R-undo C7, 27 Sep 2026).
//
// utils/actionHistory.ts pushes a history entry at once and learns its server
// row id only when createActionHistory answers. Until then -- or for good, if
// that request failed -- Undo and Redo run the page's closures instead of
// POST /api/action-history/:id/undo|redo. The server applier ('branch.update'
// in cloudflare/src/lib/undoAppliers.ts) refuses a replay once the branch no
// longer holds what the recorded action left behind, but the closures PUT the
// old snapshot with no version, and PUT /branches/:id checks a version only
// when one is sent (assertUpdatedAtMatch), so a later edit was overwritten.
//
// The closures now make the applier's check themselves: read the branch,
// refuse unless every field the applier compares still holds what the action
// left behind -- the edit's values for an Undo, the restored values for a
// Redo -- and send the version just read as expectedUpdatedAt, so an edit that
// lands between that read and the write is refused by the route. Both
// refusals reach the user in the page language, as the server's own coded
// refusal does (api/actionHistoryTransport.ts).

export type BranchReplayRow = {
  location?: unknown
  phone?: unknown
  manager?: unknown
  notes?: unknown
  is_default?: unknown
  updated_at?: unknown
}

// The fields staleBranchReplayFields (cloudflare/src/lib/branchWrites.ts)
// compares: BRANCH_REPLAY_TEXT_FIELDS and the default flag. Name and active
// state are the canonical identity, which PUT /branches/:id itself refuses to
// change. tests/branchHistoryReplay.test.ts pins this list to the Worker's.
export const BRANCH_REPLAY_TEXT_FIELDS = ['location', 'phone', 'manager', 'notes'] as const

// What branchUpdateStatements stores for a text field (`value || null`).
function storedBranchText(value: unknown): string | null {
  return value ? String(value) : null
}

// toDbBool(value, 0) in cloudflare/src/lib/db.ts.
function storedBranchFlag(value: unknown): 0 | 1 {
  if (value == null || value === '') return 0
  if (typeof value === 'boolean' || typeof value === 'number') return value ? 1 : 0
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 1 : 0
}

const has = (row: BranchReplayRow, key: string): boolean => Object.prototype.hasOwnProperty.call(row, key)

/** The fields whose current value no longer matches `expected`; a field `expected` lacks is not compared. */
export function staleBranchReplayFields(current: BranchReplayRow, expected: BranchReplayRow): string[] {
  const stale: string[] = []
  for (const key of BRANCH_REPLAY_TEXT_FIELDS) {
    if (has(expected, key) && storedBranchText(current[key]) !== storedBranchText(expected[key])) stale.push(key)
  }
  if (has(expected, 'is_default') && storedBranchFlag(current.is_default) !== storedBranchFlag(expected.is_default)) {
    stale.push('is_default')
  }
  return stale
}

// isWriteConflictError in api/http.ts: the route's 409 for a version that no
// longer matches the row.
function isWriteConflict(error: unknown): boolean {
  const detail = error && typeof error === 'object' ? error as { conflict?: unknown; code?: unknown } : null
  return !!detail && (detail.conflict === true || detail.code === 'write_conflict')
}

export type BranchReplayWriteResult = { success?: boolean; error?: string } | null | undefined

export type BranchReplayRequest = {
  id: string | number
  /** The body to PUT: buildBranchPayload of the snapshot being restored. */
  fields: Record<string, unknown>
  /** What the recorded action left behind: the edit's snapshot for an Undo, the restored one for a Redo. */
  expected: BranchReplayRow
  readBranch: (id: string | number) => Promise<BranchReplayRow | null | undefined>
  writeBranch: (id: string | number, body: Record<string, unknown>) => Promise<BranchReplayWriteResult>
  /** The refusal in the page language (undo_refused_record_changed / redo_refused_record_changed). */
  refusal: string
  /** The message for any other failed write that carries none of its own. */
  failure: string
}

export async function replayBranchEdit(request: BranchReplayRequest): Promise<void> {
  const current = await request.readBranch(request.id)
  const version = String(current?.updated_at ?? '').trim()
  // No row, no version to hold the write to, or a field a later edit changed:
  // nothing is sent.
  if (!current || !version || staleBranchReplayFields(current, request.expected).length) {
    throw new Error(request.refusal)
  }
  let result: BranchReplayWriteResult
  try {
    result = await request.writeBranch(request.id, { ...request.fields, expectedUpdatedAt: version })
  } catch (error) {
    if (isWriteConflict(error)) throw new Error(request.refusal)
    throw error
  }
  if (result?.success === false) throw new Error(result.error || request.failure)
}
