import { createElement, type ReactElement } from 'react'
import { draftAuthorityChangedText } from '../../utils/draftAuthority.ts'

// The one "the account or server changed" notice for a form whose frozen draft authority is gone
// (useFrozenDraftAuthority's `locked`). The caller decides when to show it; this only says it, once, the same way in
// the Expense, Branch and Product forms. Khmer lines need the room, hence leading-relaxed. A .ts file with
// createElement, like ConflictIcon.ts, so tests can import the real component without a JSX transform.
export default function DraftAuthorityNotice({ t, className = '' }: { t: (key: string) => string | undefined; className?: string }): ReactElement {
  return createElement('p', {
    role: 'alert',
    'data-draft-authority-changed': '',
    className: `text-sm leading-relaxed text-red-700 dark:text-red-300${className ? ` ${className}` : ''}`,
  }, draftAuthorityChangedText(t))
}
