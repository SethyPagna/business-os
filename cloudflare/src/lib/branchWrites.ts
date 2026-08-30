import { toDbBool } from './db'

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
}

// Mirrors the route's own statement shape exactly: when the row is being made
// the default, every other row's is_default is cleared first, then the single
// UPDATE writes the editable columns. Returns the statements for a db.batch();
// the caller owns the batch so it can bundle audit/broadcast side effects.
export function branchUpdateStatements(id: string | number, fields: BranchWriteFields): Array<{ sql: string; params?: Record<string, unknown> }> {
  const defaultFlag = toDbBool(fields.is_default, 0)
  const activeFlag = toDbBool(fields.is_active, 1)
  const statements: Array<{ sql: string; params?: Record<string, unknown> }> = []
  if (defaultFlag) statements.push({ sql: 'UPDATE branches SET is_default = 0' })
  statements.push({
    sql: `UPDATE branches SET name=@name, location=@location, phone=@phone, manager=@manager, notes=@notes,
          is_default=@is_default, is_active=@is_active, updated_at=CURRENT_TIMESTAMP WHERE id=@id`,
    params: {
      name: fields.name,
      location: fields.location || null,
      phone: fields.phone || null,
      manager: fields.manager || null,
      notes: fields.notes || null,
      is_default: defaultFlag,
      is_active: activeFlag,
      id,
    },
  })
  return statements
}
