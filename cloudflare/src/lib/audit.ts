import { getDb } from './db'
import type { Env } from '../index'

// Ported from backend/src/helpers.ts's audit(). Deliberately swallows its
// own errors (matching the original's comment: "Audit failures must never
// crash the main request") -- an audit log write failing should never be
// the reason a branch/product/sale save fails for the person using the app.
export async function audit(
  env: Env,
  userId: number | null,
  userName: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = null,
): Promise<void> {
  try {
    const detailsStr = details != null
      ? (typeof details === 'object' ? JSON.stringify(details) : String(details))
      : null
    const db = getDb(env)
    await db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value)
      VALUES (@user_id, @user_name, @action, @entity, @entity_id, @details, @table_name, @record_id, @new_value)
    `).run({
      user_id: userId,
      user_name: userName,
      action,
      entity,
      entity_id: entityId,
      details: detailsStr,
      table_name: entity,
      record_id: entityId,
      new_value: detailsStr,
    })
  } catch (_) {
    // Swallow -- see comment above.
  }
}
