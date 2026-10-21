import { PERMISSION_DEFS } from './permissionDefinitions.ts'
import { actionsForKey } from '../../utils/permissionActions.ts'
import { normalizePermissionState } from '../../utils/permissions.ts'

type Translate = (key: string, fallback: string) => string

// The Roles list shows one tag per granted key. A section key reads as its label;
// a per-action override such as `sales:amend` reads as "Sales: <action label>".
// A key neither table knows is hidden rather than shown as raw text.
export function rolePermissionLabel(key: string, tr: Translate): string | null {
  const section = PERMISSION_DEFS.find((item) => item.key === key)
  if (section) return tr(section.tKey, section.label)
  const [parentKey, actionKey] = key.split(':')
  const parent = PERMISSION_DEFS.find((item) => item.key === parentKey)
  const action = actionKey ? actionsForKey(parentKey).find((item) => item.key === actionKey) : undefined
  if (!parent || !action) return null
  return `${tr(parent.tKey, parent.label)}: ${tr(action.tKey, action.label)}`
}

export type PermissionEntryTier = 'full' | 'review' | 'view' | 'off'
export type PermissionEntry = { key: string; label: string; tier: PermissionEntryTier }

// One word per tier, the same vocabulary the role editor uses; a plain grant needs none.
export function permissionTierWord(tier: PermissionEntryTier, tr: Translate): string {
  if (tier === 'review') return tr('review_required', 'Review')
  if (tier === 'view') return tr('view', 'View')
  if (tier === 'off') return tr('off', 'Off')
  return ''
}

// Every labelled entry of a stored permission map, split into what is granted (with its
// tier) and what is explicitly switched off. A `false` is a decision, not an absence: it
// narrows a tier or an inherited default, so it is listed rather than dropped. A key
// neither table can name is left out, never printed raw.
export function describePermissionMap(raw: unknown, tr: Translate): { all: boolean; granted: PermissionEntry[]; off: PermissionEntry[] } {
  const map = normalizePermissionState(raw)
  const granted: PermissionEntry[] = []
  const off: PermissionEntry[] = []
  for (const [key, value] of Object.entries(map)) {
    if (key === 'all') continue
    const label = rolePermissionLabel(key, tr)
    if (label === null) continue
    if (value === false) off.push({ key, label, tier: 'off' })
    else granted.push({ key, label, tier: value === 'review' ? 'review' : value === 'view' ? 'view' : 'full' })
  }
  return { all: map.all === true, granted, off }
}
