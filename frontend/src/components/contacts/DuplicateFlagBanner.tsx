import type { ContactDuplicateMatch, ContactDuplicateSeverity } from './contactDuplicates'

interface DuplicateFlagBannerProps {
  matches: ContactDuplicateMatch[]
  entityLabel: string
  onUseExisting?: (match: ContactDuplicateMatch) => void | Promise<void>
  t?: (key: string) => string | undefined
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

function messageFor(match: ContactDuplicateMatch, entityLabel: string, t?: DuplicateFlagBannerProps['t']): string {
  if (match.severity === 'phone_conflict') {
    return tr(t, 'contact_duplicate_phone_conflict_message', `This phone number already belongs to "${match.name}". Use the existing record or enter a different phone number.`)
  }
  if (match.severity === 'exact_match') {
    return tr(t, 'contact_duplicate_possible_message', `"${match.name}" already has this exact name and phone number. Use the existing record or create a separate one.`)
  }
  return `Another ${entityLabel} named "${match.name}" already exists${match.phone ? ` (${match.phone})` : ''}. Make sure this is a different person.`
}

function tr(t: DuplicateFlagBannerProps['t'], key: string, fallback: string): string {
  const value = t?.(key)
  return value && value !== key ? value : fallback
}

export default function DuplicateFlagBanner({ matches, entityLabel, onUseExisting, t }: DuplicateFlagBannerProps) {
  if (!matches.length) return null
  const top = matches[0]
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${SEVERITY_STYLE[top.severity]}`}>
      <p className="leading-relaxed">{messageFor(top, entityLabel, t)}</p>
      {onUseExisting ? (
        <div className="mt-2 flex flex-wrap gap-2" aria-label={tr(t, 'contact_duplicate_existing_choices', 'Existing records')}>
          {matches.map((match) => (
            <button
              key={match.id}
              type="button"
              onClick={() => { void onUseExisting(match) }}
              className="rounded-md border border-current/30 px-2 py-1 font-semibold hover:bg-white/50 dark:hover:bg-black/10"
            >
              {tr(t, 'contact_duplicate_use_existing', 'Use existing')}: {match.name || `#${match.id}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
