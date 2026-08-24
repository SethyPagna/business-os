export type SearchMode = 'AND' | 'OR'

type TranslateFn = (key: string) => string | undefined

type SearchModeToggleProps = {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
  t?: TranslateFn
  disabled?: boolean
  // Slightly bigger tap target with a fixed width matching the icon-only
  // "large" FilterMenu trigger next to it -- used on rows (like POS's)
  // where this sits beside the Filter button as a primary touch control.
  large?: boolean
}

// A single button that flips between AND and OR on click, instead of a
// two-option switch that always shows both labels side by side. One
// control at a fixed width means the search row never needs a second
// line to fit it -- search box, this toggle, and the Filter trigger all
// stay on one row at every screen size. Text-only (just the word "AND"
// or "OR" alternating) -- no swap icon, since the word itself already
// says what a click does and the two colors (blue/amber) already flag
// that it's a toggle.
//
// Shrunk from its previous h-8/h-9 sizing (h-7/h-8 now) so the barcode
// scanner button next to it -- the control people actually reach for
// mid-scan, and used far more often than flipping AND/OR -- can take a
// larger share of the row instead of matching this one tap-target for
// tap-target. See ScanSearchButton's default sizing for the other half
// of that trade.
export default function SearchModeToggle({
  mode,
  onChange,
  t = (key: string) => key,
  disabled = false,
  large = false,
}: SearchModeToggleProps) {
  const next: SearchMode = mode === 'AND' ? 'OR' : 'AND'
  const label = mode === 'AND' ? (t('and_filter') || 'AND') : (t('or_filter') || 'OR')
  const title = mode === 'AND'
    ? (t('search_mode_and_hint') || 'Matching ALL terms - click to match ANY term instead')
    : (t('search_mode_or_hint') || 'Matching ANY term - click to match ALL terms instead')

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      disabled={disabled}
      title={title}
      aria-label={`${t('search_mode') || 'Search mode'}: ${label}`}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border font-bold uppercase tracking-wide transition-colors disabled:opacity-40 ${
        large ? 'h-8 px-2.5 text-xs' : 'h-7 px-2 text-[11px]'
      } ${
        mode === 'AND'
          ? 'border-blue-700 bg-blue-600 text-white shadow-sm hover:bg-blue-700'
          : 'border-amber-600 bg-amber-500 text-white shadow-sm hover:bg-amber-600'
      }`}
    >
      <span>{label}</span>
    </button>
  )
}
