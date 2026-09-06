import InfoHint from '../shared/InfoHint.tsx'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { identityHistoryEntries, type IdentityHistory } from './helpers/identityHistory.ts'

// N34 / lane "linkover", item 2 -- "a merge can be inspected", on every surface
// where the question is asked.
//
// Renders nothing at all when the row has no recorded folds and no keep-separate
// decisions, which is the overwhelmingly common case: an empty "no history" box
// on every product would be a line of chrome that tells the operator nothing.
//
// The lines come from identityHistoryEntries, in the server's order. This
// component decides how they LOOK; it never decides what they say or in which
// order, so the Conflicts float and the product form cannot show a row's history
// two different ways.

type TranslateFn = (key: string) => string | undefined

export default function IdentityHistoryPanel({
  history,
  t,
  className = '',
}: {
  history: IdentityHistory | null | undefined
  t: TranslateFn
  className?: string
}) {
  const entries = identityHistoryEntries(history)
  if (!entries.length) return null
  const title = t('identity_history_title') || 'Already decided'
  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/50 ${className}`}>
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{title}</span>
        <InfoHint
          label={title}
          text={t('identity_history_hint') || 'Merges are read from the undo record, so they stay visible for as long as they can be undone. Keep-separate decisions come from the audit log and age out with it.'}
        />
      </div>
      <ul className="space-y-0.5 text-[11px] leading-tight text-gray-600 dark:text-gray-300">
        {entries.map((entry) => (
          <li key={entry.key} className="break-words">
            {entry.kind === 'merged_from'
              ? (t('identity_history_merged_from') || 'Merged in: {name}').replace('{name}', entry.name)
              : entry.kind === 'merged_into'
                ? (t('identity_history_merged_into') || 'Merged into: {name}').replace('{name}', entry.name)
                : (t('identity_history_kept_separate') || 'Kept separate from #{ids}')
                  .replace('{ids}', entry.ids.join(', #') || '?')}
            <span className="text-gray-400 dark:text-gray-500">
              {' · '}{fmtDateTime24(entry.at)}{entry.by ? ` · ${entry.by}` : ''}
            </span>
            {entry.kind !== 'kept_separate' && entry.reversed ? (
              <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {t('identity_history_reversed') || 'undone'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
