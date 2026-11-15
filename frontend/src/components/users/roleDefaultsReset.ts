import { PERMISSION_DEFS } from './permissionDefinitions.ts'
import { normalizePermissionState } from '../../utils/permissions.ts'
import type { PermissionValue } from '../../utils/permissions.ts'

// "Reset to ... defaults" is offered on the two seeded, non-admin roles only. Admin is rewritten by the Worker at
// startup, and a custom role has no seeded definition to return to. The caller adds the admin-only gate.
export type ResettableRoleCode = 'employee' | 'manager'

export function resettableRoleCode(role: { code?: unknown } | null | undefined): ResettableRoleCode | null {
  const code = String(role?.code ?? '').trim().toLowerCase()
  return code === 'employee' || code === 'manager' ? code : null
}

// A retired grant (permissionDefinitions.ts `retired`, plus the retired Sales action row) is not drawn in the editor and is not counted
// or cleared by it: its stored value is left exactly as it is, so a reset must not write the default over it either. The cost grants
// are the case: owner, 15 Nov 2026, cost is administrator only, and the stored grants are the way back if that ruling is reversed.
const RETIRED_ACTION_KEYS = ['sales:view_courier_cost']
export const RETIRED_PERMISSION_KEYS: readonly string[] = [
  ...PERMISSION_DEFS.filter((def) => def.retired).map((def) => def.key),
  ...RETIRED_ACTION_KEYS,
]

/**
 * The editor draft after "Reset to defaults": the seeded permissions for every drawn grant, and for each retired grant the value the
 * role holds now, or nothing if it holds none.
 */
export function resetRolePermissions(stored: unknown, defaults: unknown): Record<string, PermissionValue> {
  const held = normalizePermissionState(stored)
  const next = normalizePermissionState(defaults)
  for (const key of RETIRED_PERMISSION_KEYS) {
    if (Object.hasOwn(held, key)) next[key] = held[key]
    else delete next[key]
  }
  return next
}
