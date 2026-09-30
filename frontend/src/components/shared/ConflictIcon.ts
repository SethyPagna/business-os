// The one conflict icon (owner, 30 Sep 2026: "the conflict should use the !
// and triangle icon, make it consistent icon for other conflicts page as
// well"). Every conflict surface imports it from here, so no surface can drift
// back to copy or git-merge; tests/conflictIconParity.test.ts pins that.
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'

export const ConflictIcon = AlertTriangle
export const CONFLICT_ICON_CLASS = 'text-amber-600 dark:text-amber-400'

export default ConflictIcon
