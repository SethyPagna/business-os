import type { D1Compat } from './db'
import { isAdminControlUser } from './permissions'

// The last-administrator guard (FX-sec2, 27 Sep 2026).
//
// Administrator control comes from the admin role or an effective `all` grant
// (lib/permissions.ts isAdminControlUser), never from the username. So a role
// change, a permission change, a deactivation or deletion, or an edit to a
// custom role the remaining administrators hold could leave NO active account
// with administrator control -- and nothing in the app could repair that,
// because every user and role route requires administrator control (the
// refuter's probe: the sole owner moved to Employee, then 403 on everything).
//
// Every writer of those fields (routes/users.ts PUT /users/:id, PUT
// /roles/:id) passes its proposed change through planAdminControlWrite():
//   - a change that would leave zero ACTIVE, non-deleted administrators is
//     refused before anything is written: 409 `code: 'last_admin_required'`;
//   - otherwise the writer appends the returned `guard` to its own D1 batch,
//     AFTER its write. Inside that same transaction it re-checks that one
//     administrator this plan counted (the witness) still has exactly the
//     status, role and grants the plan saw, so two administrators demoting
//     each other at the same moment cannot both succeed. A failed re-check
//     aborts the whole batch through the json('...') idiom lib/productWrites.ts
//     uses; isAdminControlGuardAbort() recognises it.

export const LAST_ADMIN_REQUIRED_CODE = 'last_admin_required'
export const LAST_ADMIN_REQUIRED_ERROR = 'This change would leave no active administrator. Give another active user the admin role first. No changes were saved.'

export function lastAdminRequiredBody() {
  return { success: false as const, error: LAST_ADMIN_REQUIRED_ERROR, code: LAST_ADMIN_REQUIRED_CODE }
}

export function isAdminControlGuardAbort(error: unknown): boolean {
  return /malformed JSON|last_admin_required/i.test(error instanceof Error ? error.message : String(error))
}

// Values are passed exactly as the writer binds them, so the witness re-check
// compares against what the batch really stores.
export type AdminControlChange =
  | { user: { id: number | string; roleId: unknown; permissions: string; active: boolean } }
  | { role: { id: number | string; permissions: string } }

type AdminRow = {
  id: number
  role_id: unknown
  permissions: string | null
  role_code: string | null
  role_permissions: string | null
}

export type AdminControlPlan =
  | { refusal: ReturnType<typeof lastAdminRequiredBody> }
  | { guard: { sql: string; params: Record<string, unknown> } }

const WITNESS_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM users w LEFT JOIN roles wr ON wr.id = w.role_id
  WHERE w.id = @id AND w.is_active = 1 AND w.deleted_at IS NULL
    AND w.role_id IS @role_id AND w.permissions IS @permissions
    AND wr.code IS @role_code AND wr.permissions IS @role_permissions
) THEN 1 ELSE json('${LAST_ADMIN_REQUIRED_CODE}') END`

export async function planAdminControlWrite(db: D1Compat, change: AdminControlChange): Promise<AdminControlPlan> {
  // Only ACTIVE, non-deleted accounts can sign in and act (lib/auth.ts).
  const rows = await db.prepare(`
    SELECT u.id, u.role_id, u.permissions, r.code AS role_code, r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.is_active = 1 AND u.deleted_at IS NULL
  `).all<AdminRow>()
  let after: AdminRow[]
  let affected: (row: AdminRow) => boolean
  if ('user' in change) {
    const next = change.user
    affected = (row) => Number(row.id) === Number(next.id)
    after = rows.filter((row) => !affected(row))
    if (next.active) {
      const role = next.roleId == null ? undefined : await db.prepare('SELECT code, permissions FROM roles WHERE id = @id')
        .get<{ code: string | null; permissions: string | null }>({ id: next.roleId })
      after.push({ id: Number(next.id), role_id: next.roleId, permissions: next.permissions, role_code: role?.code ?? null, role_permissions: role?.permissions ?? null })
    }
  } else {
    const next = change.role
    affected = (row) => row.role_id != null && Number(row.role_id) === Number(next.id)
    after = rows.map((row) => (affected(row) ? { ...row, role_permissions: next.permissions } : row))
  }
  // The same rule as every admin gate (isAdminControlUser), never the name.
  const admins = after.filter((row) => isAdminControlUser(row))
  if (!admins.length) return { refusal: lastAdminRequiredBody() }
  // Prefer an administrator this write does not touch.
  const witness = admins.find((row) => !affected(row)) ?? admins[0]
  return {
    guard: {
      sql: WITNESS_SQL,
      params: {
        id: witness.id,
        role_id: witness.role_id ?? null,
        permissions: witness.permissions ?? null,
        role_code: witness.role_code ?? null,
        role_permissions: witness.role_permissions ?? null,
      },
    },
  }
}
