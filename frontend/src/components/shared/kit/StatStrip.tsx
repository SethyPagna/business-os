import type { ComponentProps } from 'react'
import StatsStrip from '../StatsStrip.tsx'

export type StatStripProps = ComponentProps<typeof StatsStrip>
export type { StatCardDef, StatDetail } from '../StatsStrip.tsx'

// StatStrip -- an ADAPTER over the existing `shared/StatsStrip.tsx`, per
// the brief ("not a rewrite"). It forwards every prop unchanged and adds
// only the kit's own typography tokens to the outer wrapper -- StatsStrip
// keeps its own internal markup, tone colours (emerald/amber/red/blue) and
// layout untouched, so no already-shipped page-level behaviour changes.
//
// Two of the brief's literal instructions for this adapter ("compact
// cards, no ballooning" and "in-card scroll for overflow") were checked
// against the current, already-shipped StatsStrip.tsx and found to
// describe the OPPOSITE of a documented, user-directed design decision
// already implemented there: StatsStrip's cards row is a deliberate
// `flex-wrap` grid (2-up on phones, widening with the viewport) rather
// than a fixed-height scroller -- see StatsStrip.tsx's own comment
// ("cards WRAP instead of scrolling sideways ... 'should not do scroll in
// one row, can do 2 stats per row for smaller screens' (user, Aug 31)").
// Forcing a scroll container here would fight that shipped, user-mandated
// behaviour and would require editing StatsStrip.tsx's internal markup,
// which contradicts "adapter, not a rewrite." Per the brief-conflicts-
// with-code rule, this adapter does NOT impose scroll/height clamping;
// it stays a safe, additive pass-through. Recorded for the coordinator in
// the report.
export default function StatStrip(props: StatStripProps) {
  return (
    <div className="font-[family-name:var(--ui-font-body)] text-[length:var(--ui-size-body)] text-[var(--ui-ink)]">
      <StatsStrip {...props} />
    </div>
  )
}
