import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'

type Translate = (key: string, fallbackEn?: string, fallbackKm?: string) => string

/**
 * Pinned footer (spec 3.6): back (after the first step), the Items count and
 * total stacked small, and one wide primary: Next / Next / Complete Session.
 */
export default function StockSessionFooter({ tr, onBack, itemsCount, total, primaryLabel, onPrimary, primaryDisabled, primaryTitle, saving }: {
  tr: Translate
  onBack?: () => void
  itemsCount: number
  /** Formatted Items total, or null when it is not shown (not Add, or no cost view). */
  total: string | null
  primaryLabel: string
  onPrimary: () => void
  primaryDisabled: boolean
  primaryTitle?: string
  saving: boolean
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-t border-gray-200 px-3 py-2.5 sm:px-4 dark:border-gray-700">
      {onBack ? (
        <button type="button" onClick={onBack} disabled={saving} aria-label={tr('back', 'Back')} title={tr('back', 'Back')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : null}
      <div className="min-w-[4.5rem] shrink-0 text-xs leading-tight tabular-nums text-gray-600 dark:text-gray-300">
        <div>{tr('items', 'Items')} <span className="font-semibold">{itemsCount}</span></div>
        {total != null ? <div className="font-semibold text-gray-900 dark:text-gray-100">{total}</div> : null}
      </div>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled || saving}
        title={primaryTitle}
        className="btn-primary flex h-11 min-w-0 flex-1 items-center justify-center gap-2 text-sm disabled:opacity-50"
      >
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{tr('saving_label', 'Saving…')}</> : primaryLabel}
      </button>
    </div>
  )
}
