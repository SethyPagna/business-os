import type { ContactDuplicateMatch, ContactDuplicateSeverity } from './contactDuplicates'

interface DuplicateFlagBannerProps {
  matches: ContactDuplicateMatch[]
  entityLabel: string
  onUseExisting?: (match: ContactDuplicateMatch) => void | Promise<void>
  t?: (key: string) => string | undefined
  // P4-2: suppliers only. A same-name match there is never a choice any more
  // (routes/contacts.ts resolves it straight to the existing record) -- this
  // swaps the "use existing / create a separate one" wording and the button
  // grid for a plain "this is the record you'll get" note. A phone_conflict
  // stays a real, unresolved conflict either way (a different name cannot
  // silently take over someone else's phone), so its banner is unchanged.
  autoResolves?: boolean
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

function messageFor(match: ContactDuplicateMatch, entityLabel: string, t: DuplicateFlagBannerProps['t'], autoResolves: boolean): string {
  if (match.severity === 'phone_conflict') {
    return tr(t, 'contact_duplicate_phone_conflict_message', `This phone number already belongs to "${match.name}". Use the existing record or enter a different phone number.`)
  }
  if (autoResolves) {
    return tr(t, 'contact_duplicate_will_use_existing', `This name matches an existing ${entityLabel}. Saving will use "${match.name}" instead of creating a new one.`)
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

export default function DuplicateFlagBanner({ matches, entityLabel, onUseExisting, t, autoResolves = false }: DuplicateFlagBannerProps) {
  if (!matches.length) return null
  const top = matches[0]
  // Auto-resolve is not a choice, so the "Use existing" button grid (which
  // implies picking between candidates) only renders for a real, unresolved
  // conflict -- currently only phone_conflict once autoResolves is set.
  const showChoices = onUseExisting && (!autoResolves || top.severity === 'phone_conflict')
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${SEVERITY_STYLE[top.severity]}`}>
      <p className="leading-relaxed">{messageFor(top, entityLabel, t, autoResolves)}</p>
      {showChoices ? (
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
