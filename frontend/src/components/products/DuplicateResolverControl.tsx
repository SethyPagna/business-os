import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'

type Tr = (key: string, fallback: string) => string

// Inline exact-duplicate resolver (user spec item #3). Shown on a product
// list row that the server sweep flags as an EXACT duplicate (same real
// barcode + same name as another product). It REPLACES the row's normal
// click-to-detail "Manage/Product" affordance -- for a known duplicate the
// only sane next step is to resolve it, not to open and edit yet another
// copy.
//
// Two actions, both already backed server-side (routes/products.ts):
//   - Keep this  -> merge the other duplicate(s) INTO this record; their
//                   stock, lots and images carry over, old sales stay valid.
//   - Keep both  -> dismiss the cluster: "these are genuinely different
//                   items", so the sweep stops flagging them. This is the
//                   false-positive escape hatch (the backend itself notes an
//                   EDP/EDT pair or two shades can legitimately share one
//                   barcode + name), so the row is never permanently stripped
//                   of its normal actions with no way out.
//
// Every pointer event is stopped from bubbling: the row underneath binds
// long-press (mousedown/touchstart) select handlers and its own onClick, so
// without this a tap on "Keep this" would also start selecting the row.
export default function DuplicateResolverControl({
  tr,
  memberCount,
  busy = false,
  disabled = false,
  onKeepThis,
  onKeepBoth,
}: {
  tr: Tr
  /** Total records in this exact-duplicate group, including this row. */
  memberCount: number
  busy?: boolean
  /** No merge permission -- show the badge for context, hide the actions. */
  disabled?: boolean
  onKeepThis: () => void
  onKeepBoth: () => void
}) {
  const otherCount = Math.max(1, memberCount - 1)
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  const badgeTitle = tr(
    'product_duplicate_row_hint',
    'Same barcode and name as another product. Resolve it here — the usual edit/manage actions are hidden until then.',
  )
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1"
      onClick={stop}
      onMouseDown={stop}
      onTouchStart={stop}
    >
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        title={badgeTitle}
      >
        <Copy className="h-3 w-3" />
        {tr('product_duplicate_badge', 'Duplicate')}
      </span>
      {disabled ? null : (
        <>
          <button
            type="button"
            onClick={(event) => { stop(event); if (!busy) onKeepThis() }}
            disabled={busy}
            title={tr('duplicate_keep_this_hint', 'Keep this record and merge the other duplicate(s) into it')}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
            {tr('duplicate_keep_this', 'Keep this')}
            <span className="opacity-80">+{otherCount}</span>
          </button>
          <button
            type="button"
            onClick={(event) => { stop(event); if (!busy) onKeepBoth() }}
            disabled={busy}
            title={tr('duplicate_keep_both_hint', 'These are different items — stop flagging them as duplicates')}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <EyeOff className="h-3 w-3" />
            {tr('duplicate_keep_both', 'Keep both')}
          </button>
        </>
      )}
    </div>
  )
}
