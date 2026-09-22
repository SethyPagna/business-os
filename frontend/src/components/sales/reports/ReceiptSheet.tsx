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
  /**
   * Replaces the standard label/value ledger grid with a custom layout (the
   * Products report's compact two-column stat grid, Part reports-products:
   * "arrange as two columns, one row: sales, quantity, second row: line
   * sales, third row cogs, fourth row profit"). Title/meta above it are
   * unaffected -- only the body differs per surface.
   */
  body?: ReactNode
  onClick?: (el: HTMLElement) => void
  selected?: boolean
  /**
   * Set a memo block apart from arithmetic totals. Credit is already included
   * in revenue and profit, so its highlighted row is informational.
   */
  highlight?: boolean
  /**
   * This block SUMMARISES the sheet instead of carrying one record: the
   * totals footer ReportTable appends, or a statement group in the Overview.
   * It -- and only it -- takes the 600 weight, the same weight the excel
   * style's `<tfoot>` row carries, so the two styles agree on where the
   * emphasis sits.
   *
   * Record cards deliberately do NOT get it: a list of fifty cards each
   * closing on a bold line is the "text heavy... the boldness, weight made it
   * worse" the owner reported on Sep 22. One bold block per sheet is the
   * Overview's own rhythm, which the same owner called fine.
   */
  emphasis?: boolean
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
  // 'medium', not 'semibold': a total line closes EVERY card in a list view,
  // so semibold as the DEFAULT is bold repeated once per row (owner, Sep 22:
  // 'the boldness, weight made it worse'). The rule above the line and the
  // mono figure carry the hierarchy there. A block that is a summary rather
  // than a record (`ReceiptBlock.emphasis` -- the totals footer, an Overview
  // statement group) takes the 600 weight back; see the map below.
  total: 'pt-1 font-medium',
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
    // The measured box. `container-type: inline-size` (reports-surface.css)
    // makes it fill whatever width its host gives it -- the report frame, or
    // a 320px detail float -- and the sheet below answers THAT width.
    <div className="report-receipt-sheet" data-receipt-layout={centered ? 'statement' : 'cards'}>
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
        // `report-receipt-body` is what makes the multi-card layout answer to
        // the width it ACTUALLY has (a container query in
        // reports-surface.css) instead of the viewport's. The Tailwind
        // `md:grid md:grid-cols-2 xl:grid-cols-3` this replaces measured the
        // window, so the very same sheet drawn inside a 320px detail float on
        // a 1280px desktop laid its blocks out in THREE ~90px columns -- the
        // "opened details are unreadable / broken" the owner reported. The
        // sheet is now two columns only when the sheet itself is wide.
        'report-receipt-body',
        centered
          ? 'mx-auto w-full max-w-[420px]'
          // One tape while the sheet is narrow; once the sheet itself is wide
          // enough each block becomes its own card in a grid, so a wide screen
          // shows several receipts side by side instead of one full-width
          // column of mostly empty space. Both the grid and the lifting of the
          // 26rem cap are container queries now (see the class above).
          //
          // The tape is width-capped (26rem) rather than full-bleed: at
          // `justify-between` on a 900px-wide phone-landscape tape the label
          // sat at the far left and its number at the far right with a hand's
          // width of nothing between them (user, Part 586: "the fields and
          // value can be closer much closer").
          : 'w-full',
        className,
      ].join(' ').trim()}
    >
      {blocks.map((block, index) => {
        const clickable = typeof block.onClick === 'function'
        // The one bold cue, and where it lands. In a summary block the weight
        // goes on the title (in the totals footer the title IS the word
        // "Total") and on its arithmetic total lines; everywhere else the
        // LINE_CLASS medium above stands.
        const titleClass = block.emphasis ? 'detail-scroll-text font-semibold' : 'detail-scroll-text font-medium'
        const lineClass = (kind: ReceiptLineKind | undefined) =>
          kind === 'total' && block.emphasis ? 'pt-1 font-semibold' : LINE_CLASS[kind || 'add']
        const body = (
          <>
            {block.title != null || block.meta != null ? (
              <div className="flex items-baseline justify-between gap-2">
                {/* The block title is the record's NAME (a product, a
                    customer, a courier, a receipt number). Names are never
                    cut with an ellipsis on this project -- a long one scrolls
                    sideways inside its own box (`detail-scroll-text`). Weight
                    is `medium`, not `semibold`: in a list every card carries
                    one, and a page of bold titles is the "boldness, weight
                    made it worse" the owner reported. A summary block (the
                    totals footer, a statement group) is the exception -- see
                    `titleClass` above. */}
                {block.title != null ? <div className={titleClass}>{block.title}</div> : <span />}
                {block.meta != null ? <div className="shrink-0 text-[length:var(--ui-size-receipt-meta,11px)] text-[var(--ui-ink-3)]">{block.meta}</div> : null}
              </div>
            ) : null}
            {block.body != null ? (
              block.body
            ) : block.lines.length ? (
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
                  const cellClass = lineClass(kind)
                  return (
                    <Fragment key={line.key || i}>
                      {kind === 'total' ? <div className="col-span-2 mt-1 border-t border-[var(--ui-ink-3)]" /> : null}
                      <span className={['detail-scroll-text', cellClass].join(' ').trim()}>
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
          // Stacked tape: every block after the first takes a top margin.
          // In the container-query grid state reports-surface.css zeroes it
          // again, because the grid's own gap separates the cards there.
          index > 0 ? 'mt-1.5' : '',
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
    </div>
  )
}
