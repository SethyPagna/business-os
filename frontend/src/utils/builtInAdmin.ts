import type { PermissionUser } from './permissions.ts'

// The built-in default admin account: the one login that may restore a backup or reset business data (the Worker
// enforces the same rule in lib/destructiveStepUp.ts, so this only decides what the screen offers).
export function isBuiltInAdmin(user: PermissionUser): boolean {
  return String(user?.username || '').trim().toLowerCase() === 'admin'
    && String(user?.role_code || '').trim().toLowerCase() === 'admin'
}
