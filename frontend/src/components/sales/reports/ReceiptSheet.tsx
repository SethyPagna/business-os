// ReceiptSheet -- the "receipt" report style (user, Part 581: "do receipt
// style for mobile"). A narrow ledger: one block per record (or one block
// per statement group), label on the left, amount on the right, tabular
// figures, dashed rules between blocks and a solid rule over totals -- the
// way a till receipt reads, which is what a phone user scans fastest. The
// same data feeds ReportTable's spreadsheet style; only the arrangement
// differs, so switching style never changes a figure.
import type { ReactNode } from 'react'

export type ReceiptLineKind = 'add' | 'sub' | 'total' | 'info' | 'muted'

export interface ReceiptLine {
  label: ReactNode
  value: ReactNode
  kind?: ReceiptLineKind
  /** Small trailing note under the value (e.g. the change vs previous period). */
  note?: ReactNode
  key?: string
}

export interface ReceiptBlock {
  key: string
  title?: ReactNode
  meta?: ReactNode
  lines: ReceiptLine[]
  onClick?: (el: HTMLElement) => void
  selected?: boolean
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
  total: 'border-t border-[var(--ui-ink-3)] pt-1 mt-1 font-semibold',
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
        centered
          ? 'mx-auto w-full max-w-[420px] rounded-[var(--ui-radius)] border border-[var(--ui-line)] bg-[var(--ui-surface)] px-2 py-1.5'
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
          : 'w-full max-w-[26rem] rounded-[var(--ui-radius)] border border-[var(--ui-line)] bg-[var(--ui-surface)] px-2 py-1.5 md:max-w-none md:grid md:grid-cols-2 md:gap-1.5 md:border-0 md:bg-transparent md:p-0 xl:grid-cols-3',
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
                {block.meta != null ? <div className="shrink-0 text-[11px] text-[var(--ui-ink-3)]">{block.meta}</div> : null}
              </div>
            ) : null}
            {block.lines.map((line, i) => (
              <div key={line.key || i} className={['flex items-baseline justify-between gap-[var(--ui-receipt-gap,0.75rem)]', LINE_CLASS[line.kind || 'add']].join(' ').trim()}>
                <span className="min-w-0 truncate">{signOf(line.kind === 'total' || line.kind === 'info' || line.kind === 'muted' ? undefined : line.kind)}{line.label}</span>
                <span className="shrink-0 text-right font-mono">
                  {line.value}
                  {line.note != null ? <span className="ml-1 font-sans text-[10px] text-[var(--ui-ink-3)]">{line.note}</span> : null}
                </span>
              </div>
            ))}
          </>
        )
        const cls = [
          index > 0 ? 'mt-1.5 border-t border-dashed border-[var(--ui-line-2)] pt-1.5' : '',
          !centered ? 'md:mt-0 md:rounded-[var(--ui-radius)] md:border md:border-solid md:border-[var(--ui-line)] md:bg-[var(--ui-surface)] md:p-1.5 md:mx-0' : '',
          clickable ? 'w-full cursor-pointer text-left hover:bg-[var(--ui-surface-2)] -mx-1 px-1 rounded-[var(--ui-radius-sm)]' : '',
          block.selected ? 'bg-[var(--ui-accent-soft)]' : '',
        ].join(' ').trim()
        return clickable ? (
          <button key={block.key} type="button" className={cls} onClick={(e) => block.onClick?.(e.currentTarget)}>
            {body}
          </button>
        ) : (
          <div key={block.key} className={cls}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
