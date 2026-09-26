// The body the Users page sends to PUT /api/users/:id, for a save and for
// the undo / redo of one (U-profile3, refuter X8, 27 Sep 2026).
//
// A username change carries an explicit choice, made in the review dialog:
// 'carry' also rewrites the linked live records, 'record_only' renames this
// account alone. Undo and redo used to rebuild the body with a hard-coded
// `__rename_cascade: 'carry'`, so undoing a "rename this account only" edit
// rewrote every linked record -- the very thing the user had said not to do.
// The history entry now replays the scope the edit was made with, and a body
// that does not rename anything carries no scope at all.
export type UserRenameScope = 'carry' | 'record_only'

type EntityId = number | string

export type UserWritePayload = Record<string, unknown> & {
  name: string
  username: string
  phone: string
  email: string
  avatar_path: string
  role_id: EntityId | null
  is_active: boolean | number
  __rename_cascade?: UserRenameScope
}

export interface UserWriteAccount {
  name?: string | null
  username?: string | null
  phone?: string | null
  email?: string | null
  avatar_path?: string | null
  role_id?: EntityId | null
  is_active?: boolean | number | null
}

export function buildUserWritePayload(
  account: UserWriteAccount,
  actor: { id?: EntityId | null; name?: string | null } | null | undefined,
  renameScope?: UserRenameScope,
): UserWritePayload {
  return {
    name: String(account.name ?? '').trim(),
    username: String(account.username ?? '').trim(),
    phone: String(account.phone ?? '').trim(),
    email: String(account.email ?? '').trim(),
    avatar_path: String(account.avatar_path ?? '').trim(),
    role_id: account.role_id ?? null,
    is_active: account.is_active ?? 1,
    userId: actor?.id,
    userName: actor?.name,
    ...(renameScope ? { __rename_cascade: renameScope } : {}),
  }
}

// The scope an undo or redo of an edit replays: the one the edit was made
// with, and only when that edit changed the username.
export function userEditReplayScope(
  before: { username?: string | null },
  after: { username?: string | null },
  chosen: UserRenameScope | undefined,
): UserRenameScope | undefined {
  const renamed = String(before.username ?? '').trim() !== String(after.username ?? '').trim()
  return renamed ? chosen : undefined
}
