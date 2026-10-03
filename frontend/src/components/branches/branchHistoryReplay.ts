// Local replay uses the token captured with its expected server snapshot.
// The committed response becomes the expectation for the opposite replay.

export type BranchReplayRow = {
  location?: unknown
  phone?: unknown
  manager?: unknown
  notes?: unknown
  is_default?: unknown
  updated_at?: unknown
  edit_etag?: unknown
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
  return !!detail && (detail.conflict === true || detail.code === 'write_conflict' || detail.code === 'branch_edit_conflict')
}

export type BranchReplayWriteResult = { success?: boolean; error?: string; pending?: boolean; branch?: BranchReplayRow } | null | undefined

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

export async function replayBranchEdit(request: BranchReplayRequest): Promise<BranchReplayRow> {
  const current = await request.readBranch(request.id)
  const version = String(current?.updated_at ?? '').trim()
  const expectedEditEtag = typeof request.expected.edit_etag === 'string' ? request.expected.edit_etag : ''
  if (!current || !version || !expectedEditEtag || current.edit_etag !== expectedEditEtag
    || staleBranchReplayFields(current, request.expected).length) {
    throw new Error(request.refusal)
  }
  let result: BranchReplayWriteResult
  try {
    result = await request.writeBranch(request.id, { ...request.fields, expectedUpdatedAt: version, expectedEditEtag })
  } catch (error) {
    if (isWriteConflict(error)) throw Object.assign(new Error(request.refusal), error, { message: request.refusal, cause: error })
    throw error
  }
  if (result?.success === false) throw new Error(result.error || request.failure)
  if (result?.pending || !result?.branch || typeof result.branch.edit_etag !== 'string' || !result.branch.edit_etag) {
    throw new Error(request.refusal)
  }
  return result.branch
}
