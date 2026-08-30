import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb } from './db'
import { audit } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { branchUpdateStatements } from './branchWrites'

// Server-side undo/redo appliers (K1). The action_history store has always
// held an undo_payload / redo_payload per recorded action, but historically
// the CLIENT replayed them from a live in-memory closure -- so reversibility
// died on page reload (utils/actionHistory.ts's own comment explains why a
// generic closure cannot be serialized). This registry lets the WORKER replay
// a payload instead, whenever the payload names an applier registered here, so
// an admin/user can undo or redo an action that outlives their browser tab.
//
// The contract is intentionally additive: only a payload carrying a known
// `applier` string is executed server-side; anything else falls through to the
// pre-existing status-flip-and-return-payload behavior, so every action that
// does not opt in is untouched. Each applier replays a payload through the SAME
// write path the live route uses (see branchUpdateStatements) rather than a
// second copy of the SQL, and composes its own audit + broadcast -- an undo is
// an already-authorized direct action on an existing row, so it deliberately
// does not re-enter the review queue.
//
// Scope of this first slice: branch field edits (`branch.update`). Create/
// delete reversal (which has to reconcile a changing row id across the undo/
// redo cycle) and the other action_history scopes are the roadmap in
// progress.md's K1 -- each is added here as its consumer starts emitting a
// declarative payload.

export interface UndoApplierContext {
  env: Env
  user: SessionUser | null
  direction: 'undo' | 'redo'
}

export type UndoApplier = (payload: Record<string, unknown>, ctx: UndoApplierContext) => Promise<void>

const APPLIERS: Record<string, UndoApplier> = {
  // Payload shape: { applier: 'branch.update', id, fields: { name, location,
  // phone, manager, notes, is_default, is_active } }. The undo_payload carries
  // the PRE-edit field values and the redo_payload the POST-edit values, so the
  // one applier serves both directions -- the direction only decides which
  // stored payload the route hands in.
  'branch.update': async (payload, ctx) => {
    const db = getDb(ctx.env)
    const id = Number(payload.id || 0)
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('This action cannot be replayed: its saved details are missing a branch id.')
    }
    const existing = await db.prepare('SELECT id FROM branches WHERE id = ?').get<{ id: number }>([id])
    if (!existing) {
      throw new Error('The branch this action changed no longer exists, so it cannot be reversed.')
    }
    const fields = payload.fields && typeof payload.fields === 'object'
      ? (payload.fields as Record<string, unknown>)
      : {}
    await db.batch(branchUpdateStatements(id, fields))
    await audit(
      ctx.env,
      ctx.user?.id ?? null,
      ctx.user?.name ?? null,
      ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
      'branch',
      id,
      { via: 'undo_applier', applier: 'branch.update' },
    )
    await broadcast(ctx.env, 'branches', { action: 'update', id })
  },
}

// Returns the applier a payload opts into, or null when the payload names no
// registered applier (the fall-through-to-client-replay case).
export function resolveUndoApplier(payload: Record<string, unknown> | null | undefined): { name: string; run: UndoApplier } | null {
  if (!payload || typeof payload !== 'object') return null
  const name = typeof payload.applier === 'string' ? payload.applier : ''
  const run = name ? APPLIERS[name] : undefined
  return run ? { name, run } : null
}

// Exposed for tests: the set of applier names the Worker can execute today.
export function registeredUndoAppliers(): string[] {
  return Object.keys(APPLIERS)
}
