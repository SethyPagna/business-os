import type { ContactDuplicateMatch, ContactDuplicateSeverity } from './contactDuplicates'

interface DuplicateFlagBannerProps {
  matches: ContactDuplicateMatch[]
  entityLabel: string
  onViewExisting?: (id: number) => void
}

// One banner style per severity -- red for the hard "can't save" case,
// amber for "almost certainly the same contact", blue for "just a
// heads-up, probably fine". Matches classify results worst-first (see
// contactDuplicates.ts), so only the single worst match is ever shown --
// piling up every match at once is exactly the "text heavy, confusing"
// outcome this was asked to avoid.
const SEVERITY_STYLE: Record<ContactDuplicateSeverity, string> = {
  phone_conflict: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300',
  exact_match: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
  name_only: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300',
}

function messageFor(match: ContactDuplicateMatch, entityLabel: string): string {
  if (match.severity === 'phone_conflict') {
    return `This phone number already belongs to "${match.name}". Each phone number can only be used by one ${entityLabel} -- use a different number, or edit that record instead.`
  }
  if (match.severity === 'exact_match') {
    return `"${match.name}" already has this exact name and phone number. Saving will create a second, separate record.`
  }
  return `Another ${entityLabel} named "${match.name}" already exists${match.phone ? ` (${match.phone})` : ''}. Make sure this is a different person.`
}

export default function DuplicateFlagBanner({ matches, entityLabel, onViewExisting }: DuplicateFlagBannerProps) {
  if (!matches.length) return null
  const top = matches[0]
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${SEVERITY_STYLE[top.severity]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 leading-relaxed">{messageFor(top, entityLabel)}</p>
        {onViewExisting && top.id ? (
          <button
            type="button"
            onClick={() => onViewExisting(top.id)}
            className="shrink-0 whitespace-nowrap font-semibold underline underline-offset-2"
          >
            View
          </button>
        ) : null}
      </div>
    </div>
  )
}
