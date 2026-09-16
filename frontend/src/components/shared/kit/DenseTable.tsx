import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import type { ReactNode } from 'react'

export type DenseTableProps = {
  /** Full `<thead>`/`<tbody>` markup, owned entirely by the caller --
   *  DenseTable supplies the scroll frame, sticky header, row height and
   *  zebra striping via CSS on its own `<table>` wrapper; it never touches
   *  row/column data, sorting or selection state. */
  children: ReactNode
  /** The caller's own `<ColumnChooser .../>` element, rendered in a small
   *  strip above the table, right-aligned. */
  columnChooser?: ReactNode
  /** Called with a row's key when that row's `DenseTable.ExpandCell` is
   *  clicked -- the caller opens a `Fold` (or whatever it likes) from
   *  this callback; DenseTable itself holds no expand/open state. */
  expandRow?: (rowKey: string) => void
  /** Columns hug their content instead of being stretched across the full
   *  width of the frame. `w-full` on a table with few columns pushes each
   *  header away from its own values until a label and its number sit at
   *  opposite ends of the screen (user, Part 586: "the fields and value can
   *  be closer much closer"). With `fit`, the table is only as wide as its
   *  content and the horizontal scroller still handles the overflow case. */
  fit?: boolean
  className?: string
}

// DenseTable -- structural wrapper the Gate 2A audit's `DenseTable`
// primitive describes: an `overflow-x:auto` scroller (never the page
// itself -- `pageScrollRoots.test.ts` pins `.page-scroll` as the one
// scroll root; every horizontally-scrolling table gets its OWN scroller
// nested inside it, this one), a hairline frame, a sticky `<thead>` at
// `--z-sticky` (scoped to this scroller, so it never competes with a
// page-level sticky row), 32px rows and zebra striping via
// `--ui-surface-2` -- applied to the caller's own table markup through
// Tailwind's descendant-selector arbitrary variants rather than DenseTable
// generating rows itself, since it must not own data/sorting/selection.
export default function DenseTable({ children, columnChooser, fit = false, className = '' }: DenseTableProps) {
  return (
    <div className={className}>
      {columnChooser ? <div className="mb-1 flex justify-end">{columnChooser}</div> : null}
      <div className="overflow-x-auto rounded-[var(--ui-radius)] border border-[var(--ui-line)]">
        <table
          className={[
            // Cell padding is a token so a surface can tune its own density
            // without forking DenseTable (reports-surface.css sets 6px; the
            // 12px fallback preserves the previous look for any other caller).
            fit ? 'w-auto min-w-max' : 'w-full min-w-max',
            'border-collapse text-[length:var(--ui-size-body)] text-[var(--ui-ink)]',
            '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[var(--z-sticky)] [&_thead]:bg-[var(--ui-surface)]',
            '[&_thead_th]:border-b [&_thead_th]:border-[var(--ui-line)] [&_thead_th]:px-[var(--ui-cell-px,12px)] [&_thead_th]:text-left [&_thead_th]:text-[length:var(--ui-size-meta)] [&_thead_th]:font-medium [&_thead_th]:text-[var(--ui-ink-2)]',
            '[&_tbody_tr]:h-[var(--ui-row-h)] [&_tbody_tr:nth-child(even)]:bg-[var(--ui-surface-2)]',
            '[&_tbody_td]:px-[var(--ui-cell-px,12px)] [&_tbody_td]:py-[var(--ui-cell-py,0px)] [&_tbody_td]:border-b [&_tbody_td]:border-[var(--ui-line)]',
          ].join(' ')}
        >
          {children}
        </table>
      </div>
    </div>
  )
}

// DenseTable.ExpandCell -- the "expandRow chevron column that calls back
// for Fold" the brief describes: the caller places this as a `<td>` inside
// its own `<tr>` and passes the SAME `expandRow` callback it gave
// `DenseTable`, plus that row's own key. DenseTable does not inject this
// cell automatically (it never sees the caller's row data), so this is
// exported for the caller to place explicitly.
export function DenseTableExpandCell({ rowKey, expandRow, open = false }: { rowKey: string; expandRow?: (rowKey: string) => void; open?: boolean }) {
  return (
    <td className="w-8 px-1 text-center">
      <button
        type="button"
        onClick={() => expandRow?.(rowKey)}
        aria-expanded={open}
        aria-label={open ? 'Collapse row' : 'Expand row'}
        className="flex h-6 w-6 items-center justify-center rounded-[var(--ui-radius-sm)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-surface-2)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
    </td>
  )
}
