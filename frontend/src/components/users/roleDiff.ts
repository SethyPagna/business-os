import { PERMISSION_DEFS, type PermissionSensitivity } from './permissionDefinitions.ts'
import { rolePermissionLabel } from './rolePermissionLabel.ts'
import { normalizePermissionState, type PermissionValue } from '../../utils/permissions.ts'

type Translate = (key: string, fallback: string) => string

export type RoleValueWord = 'on' | 'off' | 'review' | 'view' | 'unset'

export type RolePermissionChange = {
  key: string
  label: string
  sensitivity: PermissionSensitivity
  before: RoleValueWord
  after: RoleValueWord
}

const wordOf = (value: PermissionValue | undefined): RoleValueWord => (
  value === undefined ? 'unset' : value === 'review' ? 'review' : value === 'view' ? 'view' : value ? 'on' : 'off'
)

/** A `section:action` switch carries its section's sensitivity; an unknown key is treated as standard. */
function sensitivityOf(key: string): PermissionSensitivity {
  const def = PERMISSION_DEFS.find((item) => item.key === key) ?? PERMISSION_DEFS.find((item) => item.key === key.split(':')[0])
  return def?.sensitivity ?? 'normal'
}

/** The word shown for a stored value: the same vocabulary the editor uses; ABSENT is "no opinion", not Off. */
export function roleValueLabel(word: RoleValueWord, tr: Translate): string {
  if (word === 'on') return tr('perm_value_on', 'On')
  if (word === 'off') return tr('off', 'Off')
  if (word === 'review') return tr('review_required', 'Review')
  if (word === 'view') return tr('view', 'View')
  return tr('perm_value_not_set', 'Not set')
}

/**
 * Every key whose stored value differs between two permission maps, in the editor's own order (catalogue
 * sections first, then their actions, then anything the catalogue cannot name). An unknown key is listed
 * under its raw name rather than dropped: the admin approves exactly what will be written.
 */
export function diffRolePermissions(before: unknown, after: unknown, tr: Translate): RolePermissionChange[] {
  const a = normalizePermissionState(before)
  const b = normalizePermissionState(after)
  const order = new Map<string, number>()
  PERMISSION_DEFS.forEach((def, index) => order.set(def.key, index * 1000))
  const rank = (key: string): number => order.get(key) ?? (order.get(key.split(':')[0]) ?? 1e9) + 1
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
  const changes: RolePermissionChange[] = []
  for (const key of keys) {
    if (a[key] === b[key]) continue
    changes.push({
      key,
      label: rolePermissionLabel(key, tr) ?? key,
      sensitivity: sensitivityOf(key),
      before: wordOf(a[key]),
      after: wordOf(b[key]),
    })
  }
  return changes
}
