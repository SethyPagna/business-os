import { PERMISSION_DEFS } from './permissionDefinitions.ts'
import { actionsForKey } from '../../utils/permissionActions.ts'

type Translate = (key: string, fallback: string) => string

// A section key reads as its label; a per-action override such as `sales:amend` reads as
// "Sales: <action label>". A key neither table knows is null, so a caller shows it raw or hides it on purpose.
export function rolePermissionLabel(key: string, tr: Translate): string | null {
  const section = PERMISSION_DEFS.find((item) => item.key === key)
  if (section) return tr(section.tKey, section.label)
  const [parentKey, actionKey] = key.split(':')
  const parent = PERMISSION_DEFS.find((item) => item.key === parentKey)
  const action = actionKey ? actionsForKey(parentKey).find((item) => item.key === actionKey) : undefined
  if (!parent || !action) return null
  return `${tr(parent.tKey, parent.label)}: ${tr(action.tKey, action.label)}`
}

// One level vocabulary for the editor, the save review and the user detail: None, View, Review, Full.
export function levelWord(level: 'none' | 'view' | 'review' | 'full', tr: Translate): string {
  if (level === 'none') return tr('none', 'None')
  if (level === 'view') return tr('view', 'View')
  if (level === 'review') return tr('review_required', 'Review')
  return tr('label_full_access', 'Full')
}
