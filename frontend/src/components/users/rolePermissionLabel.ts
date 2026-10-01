import { PERMISSION_DEFS } from './permissionDefinitions.ts'
import { actionsForKey } from '../../utils/permissionActions.ts'

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
