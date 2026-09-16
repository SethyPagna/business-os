// N13 -- the ONE rule for "who did this" on every history surface.
//
// Before this module every writer decided for itself which of the session
// user's two names to snapshot into a *_name column, and they disagreed three
// ways: `user.name` (full name) in inventory/products/branches/batches and in
// returns' main insert, `user.name || user.username` in returns' replacement
// sale and in reviewQueue/telegram, and -- in sales.ts -- nothing from the
// session at all: `cashier_name: body.cashier_name`, whatever the client sent.
// The result was one ledger showing "Za Sethy" on a transfer row and "za" on
// the sale two rows below it, and a POST /api/sales that would happily store
// any string a caller put in the body.
//
// The account id is the source of truth; the *_name columns are only a
// denormalized snapshot of it (see userIdentity.ts's USER_NAME_SNAPSHOTS, whose
// rename cascade writes the USERNAME into every one of them). A snapshot that
// starts life as a full name is therefore wrong the moment anyone renames the
// account: the cascade rewrites it to the username and the row silently
// changes shape. Writing the username at creation time is what makes the
// cascade a no-op instead of a rewrite.
//
// Two invariants, both enforced here rather than at 40 call sites:
//   1. the value is the account USERNAME, never the full name;
//   2. it is read from the authenticated session (or resolved from users.id
//      server-side), never from the request body.

// Structurally typed so this helper does not drag the whole SessionUser type
// (and therefore auth.ts's D1 imports) into pure test compiles. Every caller
// passes a real SessionUser | null | undefined.
export type ActorLike = { id?: unknown; username?: unknown; name?: unknown } | null | undefined

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// The username of the acting account, or null when there is no session.
// Deliberately NO fallback to `name`: users.username is NOT NULL (migration
// 0001_init.sql:661), so an empty username means "no account", and a full name
// in an actor column is the exact defect this module exists to remove.
export function actorSnapshot(user: ActorLike): string | null {
  return trimmed(user?.username) || null
}

// The actor's numeric id, for the id/name pair that the rename cascade joins on.
export function actorId(user: ActorLike): number | null {
  const raw = user?.id
  const id = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

// Server-side resolution for writers that only hold a user id (audit_logs is
// written from 130+ call sites that pass a name positionally; resolving from
// the id there fixes all of them at once instead of editing every caller).
export const ACTOR_USERNAME_SQL = 'SELECT username FROM users WHERE id = @user_id'

// Given the row ACTOR_USERNAME_SQL returned (or undefined when the account has
// since been deleted), the username to store. The caller-supplied value is a
// fallback for the deleted-account case only -- it never wins over the account
// row, which is what makes a spoofed or full-name argument inert.
export function resolveActorUsername(
  row: { username?: unknown } | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return trimmed(row?.username) || trimmed(fallback) || null
}
