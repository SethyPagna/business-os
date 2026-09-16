import Minus from 'lucide-react/dist/esm/icons/minus.js'

// S4-20, second half: "keep the minimize control and improve it."
//
// It is kept, and it is now ONE control rather than a glyph re-typed in each
// modal header. What was wrong with the copies:
//
//   * they disagreed on size -- 32px in the stock receiver, 44px in the
//     product form. 32px is under the comfortable touch target, and this
//     button sits directly beside the ✕: an undersized minimize next to a
//     close is a mis-tap that looks like lost work;
//   * one pair of labels carried Khmer fallbacks and the other did not, so
//     a Khmer till read "Minimize" in English;
//   * the glyph was a text "−", which does not match the ✕ beside it at any
//     font size and renders differently per platform.
//
// What it deliberately does NOT do: go anywhere near the close guard.
// Minimizing PRESERVES the work -- utils/minimizedWork.ts parks it as a chip
// and utils/workDrafts.ts keeps its content -- so raising "Discard changes?"
// here would be asking to throw away exactly what the operator just asked to
// keep. `onMinimize` is passed straight through; a future edit that routes it
// through requestClose is a bug, not a tidy-up.
export default function MinimizeButton({
  onMinimize,
  disabled = false,
  tr,
}: {
  onMinimize: () => void
  disabled?: boolean
  /** The host's translator, so this stays free of any context dependency. */
  tr: (key: string, fallbackEn: string, fallbackKm?: string) => string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) onMinimize() }}
      aria-label={tr('minimize', 'Minimize', 'បង្រួម')}
      title={tr('minimize_hint', 'Minimize — continue later from the chip', 'បង្រួម — បន្តពេលក្រោយពីស្លាក')}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-700"
    >
      <Minus className="h-4 w-4" />
    </button>
  )
}
