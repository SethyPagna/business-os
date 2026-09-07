// ReceiptSheet -- the "receipt" report style (user, Part 581: "do receipt
// style for mobile"). A narrow ledger: one block per record (or one block
// per statement group), label on the left, amount on the right, tabular
// figures, dashed rules between blocks and a solid rule over totals -- the
// way a till receipt reads, which is what a phone user scans fastest. The
// same data feeds ReportTable's spreadsheet style; only the arrangement
// differs, so switching style never changes a figure.
import { Fragment, type ReactNode } from 'react'

export type ReceiptLineKind = 'add' | 'sub' | 'total' | 'info' | 'muted'

export interface ReceiptLine {
  label: ReactNode
  value: ReactNode
  kind?: ReceiptLineKind
  /** Small trailing note under the value (e.g. the change vs previous period). */
  note?: ReactNode
  key?: string
  tone?: 'positive' | 'negative'
}

export interface ReceiptBlock {
  key: string
  title?: ReactNode
  meta?: ReactNode
  lines: ReceiptLine[]
  onClick?: (el: HTMLElement) => void
  selected?: boolean
  /**
   * Set a memo block apart from arithmetic totals. Credit is already included
   * in revenue and profit, so its highlighted row is informational.
   */
  highlight?: boolean
}

export interface ReceiptSheetProps {
  blocks: ReceiptBlock[]
  /** Center a receipt-width column on wide viewports (statement use). */
  centered?: boolean
  className?: string
}

const LINE_CLASS: Record<ReceiptLineKind, string> = {
  add: '',
  sub: 'text-[var(--ui-ink-2)]',
  // The rule-over-totals border/margin moved to a spanning divider cell (see
  // the grid below) so it can cross both grid columns; this keeps only the
  // text treatment that belongs on each cell.
  total: 'pt-1 font-semibold',
  info: 'text-[var(--ui-ink-2)]',
  muted: 'text-[var(--ui-ink-3)]',
}

function signOf(kind: ReceiptLineKind | undefined): string {
  if (kind === 'sub') return '− '
  if (kind === 'add') return '+ '
  return ''
}

export default function ReceiptSheet({ blocks, centered = false, className = '' }: ReceiptSheetProps) {
  return (
    <div
      className={[
        // `font-mono` used to sit on the CONTAINER, which put every Khmer
        // label into a monospace stack that has no Khmer coverage -- the
        // browser then fell back per-glyph, at a different metric, inside a
        // `truncate` box. Mono now rides the VALUE span only (where it earns
        // its keep by aligning digits); labels keep the app font.
        'text-[length:var(--ui-size-body,12px)] leading-[var(--ui-receipt-lh,16px)] text-[var(--ui-ink)] [font-variant-numeric:tabular-nums]',
        // BOTH branches are LAYOUT ONLY -- no border, no background, no inset.
        //
        // Every block below is a `.report-segment` (bordered on all four sides
        // at every width) and the whole sheet already renders inside
        // ReportFrame, which is itself a `.report-segment`. A frame on this
        // wrapper as well would draw THREE nested rectangles around one list,
        // and its `px-2 py-1.5` was the most expensive padding in the layout:
        // at 375px it took the receipt content from 359px to 301px. The owner
        // asked for line borders on every segment and for the report to stay
        // compact; the lines come from the frame and the cards, and the space
        // this wrapper was spending goes back to the content.
        centered
          ? 'mx-auto w-full max-w-[420px]'
          // One tape below 768px; from 768px each block becomes its own card in a
          // grid so a wide screen shows several receipts side by side instead of
          // one full-width column of mostly empty space.
          //
          // The tape is width-capped (26rem) rather than full-bleed: at
          // `justify-between` on a 900px-wide phone-landscape tape the label
          // sat at the far left and its number at the far right with a hand's
          // width of nothing between them (user, Part 586: "the fields and
          // value can be closer much closer"). The cap is lifted at md, where
          // the grid already bounds each card.
          : 'w-full max-w-[26rem] md:max-w-none md:grid md:grid-cols-2 md:gap-1.5 xl:grid-cols-3',
        className,
      ].join(' ').trim()}
    >
      {blocks.map((block, index) => {
        const clickable = typeof block.onClick === 'function'
        const body = (
          <>
            {block.title != null || block.meta != null ? (
              <div className="flex items-baseline justify-between gap-2">
                {block.title != null ? <div className="min-w-0 truncate font-semibold">{block.title}</div> : <span />}
                {block.meta != null ? <div className="shrink-0 text-[length:var(--ui-size-receipt-meta,11px)] text-[var(--ui-ink-3)]">{block.meta}</div> : null}
              </div>
            ) : null}
            {block.lines.length ? (
              // The label/value row: ONE grid per block, not one flex row per
              // line. `justify-between` used to hand every line all the free
              // space in the box, so a label and its value could sit 300-450px
              // apart on a wide statement or card (root cause of "the fields
              // and value can be closer", user Part 586, still live on
              // >=1024 screens). A grid's label column tracks the WIDEST
              // label in the block and the value column starts right after
              // it with a fixed minimum gap -- adjacent on every width, and
              // the value column can never wrap into the label column
              // because it is its own track.
              //
              // REPAIR (verifier, Sep 6): both tracks were `max-content`, so
              // on a block wider than label+gap+value (the 420px centered
              // statement card, the 900px wide-card grid) the grid itself
              // never grows past its content -- the pair sits flush left and
              // the value ends up FAR from the block's right edge, the
              // opposite of "label left, value right". The label track is
              // `minmax(0,1fr)` instead: it still starts at the widest
              // label's width but now absorbs the block's slack, so the
              // value (still its own `max-content` track, still never wraps
              // into the label) lands at the right edge with only the
              // minimum gap before it.
              <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-baseline gap-x-[var(--ui-receipt-gap,0.75rem)]">
                {block.lines.map((line, i) => {
                  const kind = line.kind
                  const cellClass = LINE_CLASS[kind || 'add']
                  return (
                    <Fragment key={line.key || i}>
                      {kind === 'total' ? <div className="col-span-2 mt-1 border-t border-[var(--ui-ink-3)]" /> : null}
                      <span className={['min-w-0 truncate', cellClass].join(' ').trim()}>
                        {signOf(kind === 'total' || kind === 'info' || kind === 'muted' ? undefined : kind)}{line.label}
                      </span>
                      <span className={[
                        'shrink-0 text-right font-mono',
                        cellClass,
                        line.tone === 'positive' ? 'text-green-700 dark:text-green-400' : '',
                        line.tone === 'negative' ? 'text-red-600 dark:text-red-400' : '',
                      ].join(' ').trim()}>
                        {line.value}
                      </span>
                      {line.note != null ? (
                        // The note gets its OWN row under the pair, never the
                        // value cell: inside the cell its full text was the
                        // value track's max-content, so one "not available --
                        // no courier cost recorded on 253 deliveries" pushed
                        // every other label in the block down to an ellipsis
                        // (verifier, Sep 6, measured 313px -> 86px label track
                        // in the 420px statement). `w-0 min-w-full` makes the
                        // spanning row contribute nothing to track sizing and
                        // then fill the pair's width, so it wraps under them.
                        <span className="col-span-2 w-0 min-w-full whitespace-normal pl-3 font-sans text-[length:var(--ui-size-note,10px)] leading-snug text-[var(--ui-ink-3)]">{line.note}</span>
                      ) : null}
                    </Fragment>
                  )
                })}
              </div>
            ) : null}
          </>
        )
        // Every block is a segment in its own right, bordered on all four
        // sides at EVERY width -- the shared .report-segment class, not the
        // old "dashed top rule below md, a real card only from md up" split.
        // The owner's line borders have to be visible on the phone too.
        const cls = [
          'report-segment',
          // Below md the sheet is one stacked tape (the grid's own gap takes
          // over from md up, where blocks sit side by side); the centered
          // statement never becomes a grid, so it keeps stacking.
          index > 0 ? (centered ? 'mt-1.5' : 'mt-1.5 md:mt-0') : '',
          clickable ? 'w-full cursor-pointer text-left hover:bg-[var(--ui-surface-2)]' : '',
        ].join(' ').trim()
        // Selected / highlighted are DATA ATTRIBUTES, not background
        // utilities. A `bg-[var(--ui-warn-soft)]` utility and `.report-segment`
        // are both 0-1-0, and this component's stylesheet is a lazily loaded
        // chunk that lands after the utility sheet -- so the segment's own
        // background would paint over the tint. The tint on the
        // awaiting-payment block is load-bearing (S4R3-6): it is what stops a
        // memo figure being read as another arithmetic term. The matching
        // 0-2-0 rules live in reports-surface.css beside .report-segment.
        //
        // (Padding, not line-height, is still what buys the tinted box its
        // separation: a Khmer cluster's ink runs ~1.6em and a box that hugs
        // the Latin metric shears its tops and tails. The segment supplies
        // that padding for every block, tinted or not.)
        const stateProps = {
          'data-segment-selected': block.selected ? 'true' : undefined,
          'data-segment-highlight': block.highlight ? 'true' : undefined,
        }
        return clickable ? (
          <button key={block.key} type="button" className={cls} {...stateProps} onClick={(e) => block.onClick?.(e.currentTarget)}>
            {body}
          </button>
        ) : (
          <div key={block.key} className={cls} {...stateProps}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
