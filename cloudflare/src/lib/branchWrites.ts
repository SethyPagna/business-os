import { toDbBool } from './db'
import {
  canonicalBranchIdentityGuardStatement,
  CanonicalBranchIdentityError,
  prepareCanonicalBranchUpdate,
  type BranchIdentitySnapshot,
} from './canonicalBranchIdentity'

// The single definition of "how a branch row's editable fields are written",
// extracted from routes/branches.ts's PUT /:id so the server-side undo/redo
// applier (lib/undoAppliers.ts) replays a branch edit through the EXACT same
// SQL the live route uses instead of a drift-prone second copy. Only the field
// write is shared here -- the route keeps its own permission tier, optimistic-
// concurrency check, review-queue gate, audit and broadcast around this, and
// the applier composes its own audit/broadcast around it (an undo is an
// already-authorized direct action on an existing row, so it does not re-enter
// the review queue).

export interface BranchWriteFields {
  name?: unknown
  location?: unknown
  phone?: unknown
  manager?: unknown
  notes?: unknown
  is_default?: unknown
  is_active?: unknown
  role?: unknown
  canonical_key?: unknown
  successor_branch_id?: unknown
}

function branchNameSnapshotStatements(id: string | number): Array<{ sql: string; params?: Record<string, unknown> }> {
  return ['sales', 'inventory_movements', 'returns', 'stock_row_moves'].map(table => ({
    sql: `UPDATE ${table} SET branch_name=(SELECT name FROM branches WHERE id=@id)${table === 'sales' ? ', updated_at=CURRENT_TIMESTAMP' : ''}
          WHERE branch_id=@id AND COALESCE(branch_name,'')<>(SELECT name FROM branches WHERE id=@id)
          AND (TRIM(COALESCE(branch_name,''))='' OR LOWER(TRIM(branch_name))=(SELECT LOWER(TRIM(name)) FROM branches WHERE id=@id))`,
    params: { id },
  }))
}

// When a canonical row is made default, only the other canonical row is
// cleared; historical noncanonical rows are left untouched. The identity
// guard and update share one atomic batch with every caller.
// Returns the statements for a db.batch(); the caller owns the batch so it can
// bundle audit/broadcast side effects.
export function branchUpdateStatements(
  id: string | number,
  fields: BranchWriteFields,
  currentIdentity: BranchIdentitySnapshot,
  directory: readonly BranchIdentitySnapshot[] = [],
): Array<{ sql: string; params?: Record<string, unknown> }> {
  const identity = prepareCanonicalBranchUpdate(currentIdentity, fields, directory)
  const defaultFlag = toDbBool(fields.is_default, 0)
  if (!identity.is_active && defaultFlag) throw new CanonicalBranchIdentityError()
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = [
    canonicalBranchIdentityGuardStatement(currentIdentity, directory),
  ]
  if (defaultFlag) {
    statements.push({
      sql: `UPDATE branches SET is_default = 0
            WHERE id != @id AND ${canonicalActiveBranchSql(currentIdentity)}`,
      params: { id },
    })
  }
  statements.push({
    sql: `UPDATE branches SET name=@name, location=@location, phone=@phone, manager=@manager, notes=@notes,
          is_default=@is_default, is_active=@is_active, updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
    params: {
      name: identity.name,
      location: fields.location || null,
      phone: fields.phone || null,
      manager: fields.manager || null,
      notes: fields.notes || null,
      is_default: defaultFlag,
      is_active: identity.is_active,
      id,
    },
  })
  statements.push(...branchNameSnapshotStatements(id))
  return statements
}

// ---------------------------------------------------------------------------
// Undo/redo replay of a branch edit (lib/undoAppliers.ts 'branch.update').
//
// The live PUT /branches/:id refuses a stale edit with assertUpdatedAtMatch.
// A replay has no form version to compare, so it compares the row against the
// OTHER stored payload of the same history row instead: an undo may only run
// while the branch still holds exactly what the edit wrote (its redo payload),
// and a redo only while it still holds what the undo restored (its undo
// payload). Any field a later edit changed makes the replay refuse rather than
// silently overwrite that edit. The identity guard in branchUpdateStatements
// covers name and is_active; these helpers cover everything else it writes.
// ---------------------------------------------------------------------------

type BranchStatement = { sql: string; params?: Record<string, unknown> }

export const BRANCH_REPLAY_TEXT_FIELDS = ['location', 'phone', 'manager', 'notes'] as const
const BRANCH_REPLAY_FIELDS = ['name', ...BRANCH_REPLAY_TEXT_FIELDS, 'is_default', 'is_active'] as const

export interface BranchReplayRow extends BranchIdentitySnapshot {
  location?: unknown
  phone?: unknown
  manager?: unknown
  notes?: unknown
  is_default?: unknown
}

export const BRANCH_REPLAY_ROW_SQL =
  'SELECT * FROM branches WHERE id = ?'

// Canonical, active rows are the only ones that may hold the default flag
// (the same scope branchUpdateStatements clears within).
const CANONICAL_ACTIVE_BRANCH_SQL = `is_active = 1 AND lower(trim(name)) IN ('shop', 'warehouse')`

function canonicalActiveBranchSql(current: BranchIdentitySnapshot): string {
  return Object.prototype.hasOwnProperty.call(current, 'canonical_key')
    ? `is_active = 1 AND lower(trim(COALESCE(canonical_key, name))) IN ('shop', 'warehouse')`
    : CANONICAL_ACTIVE_BRANCH_SQL
}

// The value branchUpdateStatements stores for a text field (`value || null`),
// with a stored empty string read as the same "blank" as NULL.
function storedBranchText(value: unknown): string | null {
  return value ? String(value) : null
}

function has(fields: BranchWriteFields, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(fields, key)
}

/**
 * The restored fields whose current value no longer matches `expected` (the
 * state the recorded action left behind). A key absent from `expected` -- an
 * older snapshot -- is not compared.
 */
export function staleBranchReplayFields(current: BranchReplayRow, expected: BranchWriteFields): string[] {
  const stale: string[] = []
  for (const key of BRANCH_REPLAY_TEXT_FIELDS) {
    if (has(expected, key) && storedBranchText(current[key]) !== storedBranchText(expected[key])) stale.push(key)
  }
  if (has(expected, 'is_default') && toDbBool(current.is_default, 0) !== toDbBool(expected.is_default, 0)) stale.push('is_default')
  return stale
}

/**
 * In-batch twin of staleBranchReplayFields: aborts the whole batch (NOT NULL
 * on branches.name, the same mechanism as the identity guard) unless the row
 * still matches `expected` when the replay commits.
 */
export function branchReplayStateGuardStatement(id: string | number, expected: BranchWriteFields): BranchStatement {
  const params: Record<string, unknown> = { stale_id: id }
  const terms = ['id = @stale_id']
  for (const key of BRANCH_REPLAY_TEXT_FIELDS) {
    if (!has(expected, key)) continue
    terms.push(`NULLIF(${key}, '') IS @stale_${key}`)
    params[`stale_${key}`] = storedBranchText(expected[key])
  }
  if (has(expected, 'is_default')) {
    terms.push('COALESCE(is_default, 0) = @stale_is_default')
    params.stale_is_default = toDbBool(expected.is_default, 0)
  }
  return {
    sql: `INSERT INTO branches (name)
      SELECT NULL
      WHERE NOT EXISTS (SELECT 1 FROM branches WHERE ${terms.join(' AND ')})`,
    params,
  }
}

/**
 * The replay payload with every field it omits filled from the current row,
 * so an older snapshot that lacks a field leaves that column as it is instead
 * of blanking it (branchUpdateStatements writes every column).
 */
export function completeBranchReplayFields(fields: BranchWriteFields, current: BranchReplayRow): BranchWriteFields {
  const complete: BranchWriteFields = {}
  for (const key of BRANCH_REPLAY_FIELDS) {
    complete[key] = has(fields, key) ? fields[key] : current[key]
  }
  return complete
}

/** Whether replaying `fields` would take the default flag off a row that holds it. */
export function branchReplayDropsDefault(fields: BranchWriteFields, current: BranchReplayRow): boolean {
  return toDbBool(current.is_default, 0) === 1 && toDbBool(fields.is_default, 0) === 0
}

export const OTHER_CANONICAL_BRANCH_SQL =
  `SELECT id FROM branches WHERE id != ? AND ${CANONICAL_ACTIVE_BRANCH_SQL} ORDER BY id LIMIT 1`

export function otherCanonicalBranchSql(current: BranchIdentitySnapshot): string {
  return Object.prototype.hasOwnProperty.call(current, 'canonical_key')
    ? `SELECT id FROM branches WHERE id != ? AND ${canonicalActiveBranchSql(current)} ORDER BY id LIMIT 1`
    : OTHER_CANONICAL_BRANCH_SQL
}

/**
 * Appended after branchUpdateStatements in a replay so a replay that moves the
 * default flag can never leave zero or two default branches. Setting the flag
 * already clears the other canonical row; clearing it hands the flag back to
 * the other canonical row when none is left (the forward edit that made this
 * row default had taken it from there). The closing assertion aborts the batch
 * unless exactly one canonical, active branch is default. A replay that leaves
 * this row's flag as it is adds nothing: it neither causes nor repairs the
 * default elsewhere.
 */
export function branchReplayDefaultStatements(
  id: string | number,
  fields: BranchWriteFields,
  current: BranchReplayRow,
): BranchStatement[] {
  if (toDbBool(fields.is_default, 0) === toDbBool(current.is_default, 0)) return []
  const statements: BranchStatement[] = []
  const activeBranchSql = canonicalActiveBranchSql(current)
  if (!toDbBool(fields.is_default, 0)) {
    statements.push({
      sql: `UPDATE branches SET is_default = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT id FROM branches WHERE id != @id AND ${activeBranchSql} ORDER BY id LIMIT 1)
              AND NOT EXISTS (SELECT 1 FROM branches WHERE COALESCE(is_default, 0) = 1 AND ${activeBranchSql})`,
      params: { id },
    })
  }
  statements.push({
    sql: `INSERT INTO branches (name)
      SELECT NULL
      WHERE (SELECT COUNT(*) FROM branches WHERE COALESCE(is_default, 0) = 1 AND ${activeBranchSql}) <> 1`,
  })
  return statements
}
