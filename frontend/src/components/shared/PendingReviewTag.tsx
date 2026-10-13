import Hourglass from 'lucide-react/dist/esm/icons/hourglass.js'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import {
  useIsPendingReview,
  usePendingReviewCount,
  type PendingReviewId,
} from '../../utils/pendingReviewTargets.ts'

// The mini "waiting for review" tag (owner, 13 Oct 2026): "do a mini small tag to
// show the row needs review. minimize without taking used spaces or breaking UI.
// utilize empty space can be the empty margin."
//
// So the tag takes NO space. It is absolutely positioned inside a container its
// caller already made `relative`, and it is placed in a gutter the row already has
// (a table cell's start padding, a card's start padding), so the row, the name
// cell and every column keep the box they had before the tag existed. An hourglass
// drawn at 10px in that gutter is narrower than the gutter (the glyph spans ~58% of
// its 24-unit box), so it does not touch the text beside it either.
//
// `pointer-events-none`: a tap on the tag falls through to the row, so the tag can
// never steal the click that opens the product or the card. The accessible name
// lives on role="img" (aria-label, read by a screen reader); `title` carries the same
// words for the platform, though a box that takes no pointer events cannot show a
// hover tooltip, which is the price of never stealing a tap.
//
// Where it goes (the caller passes the offset; the container is `relative`):
//   Products table row     image cell, top-left   (children keep the empty cell)
//   Products card          card, top-left gutter
//   Inventory row / card   first cell / card, top-left gutter
//   Expenses row / card    time cell / card, top-left gutter
//   Branch card            card, top-left gutter
//   Reasons window         a 10px slot beside the title
// Sales, returns, contacts and stock sessions never queue, so they get no tag.

const useApp = useAppHook as unknown as () => { t: (key: string) => string }

/** The tag's own box. Position is the caller's: it adds `left-*` / `top-*`. */
export const PENDING_REVIEW_TAG_CLASS = 'pointer-events-none absolute h-2.5 w-2.5 text-amber-600 dark:text-amber-400'
/**
 * The Add button's count badge: a 10px corner dot that lives wholly inside the button's
 * own 12px end padding. Inside the button because the toolbar strip around it is
 * overflow-x-auto (a badge poking out would be clipped on top and add a scrollbar on the
 * right); inside the PADDING because the button is only as wide as its icon and label, so
 * a bigger badge sits on the last letter (measured in tests/pendingReviewTagLayout.test.ts).
 */
export const PENDING_REVIEW_BADGE_CLASS = 'pointer-events-none absolute right-px top-px flex h-2.5 min-w-[0.625rem] items-center justify-center rounded-full bg-amber-400 px-px text-[8px] font-bold leading-none text-amber-950'

function useLabel(): string {
  const { t } = useApp()
  const value = t('pending_review_tag')
  return value && value !== 'pending_review_tag' ? value : 'Waiting for review'
}

// Split from the smart tag below on purpose: the outer component is mounted once
// per row and reads only the store, so a language or notification change does not
// re-render hundreds of them. Only a row that IS waiting mounts this and reads
// the app context for its label.
function PendingReviewGlyph({ className }: { className: string }) {
  const label = useLabel()
  return (
    <span role="img" aria-label={label} title={label} className={`${PENDING_REVIEW_TAG_CLASS} ${className}`}>
      <Hourglass aria-hidden="true" className="block h-2.5 w-2.5" strokeWidth={2.25} />
    </span>
  )
}

type PendingReviewTagProps = {
  section: string
  entityType: string
  /** Every record this row stands for (a merged display row stands for several). */
  ids: readonly PendingReviewId[]
  /** Offset inside the caller's `relative` container, e.g. `left-0 top-1`. */
  className?: string
}

/** Renders nothing unless one of `ids` has an open review request. Never fetches. */
export default function PendingReviewTag({ section, entityType, ids, className = '' }: PendingReviewTagProps) {
  const waiting = useIsPendingReview(section, entityType, ids)
  return waiting ? <PendingReviewGlyph className={className} /> : null
}

function PendingReviewCountGlyph({ count }: { count: number }) {
  const label = `${useLabel()}: ${count}`
  return (
    <span role="img" aria-label={label} title={label} className={PENDING_REVIEW_BADGE_CLASS}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

/**
 * A count of requests that point at no record yet (product creates waiting for
 * approval), for the corner of the button that creates them. Renders nothing at 0.
 */
export function PendingReviewCountBadge({ section, entityType }: { section: string; entityType: string }) {
  const count = usePendingReviewCount(section, entityType)
  return count > 0 ? <PendingReviewCountGlyph count={count} /> : null
}
