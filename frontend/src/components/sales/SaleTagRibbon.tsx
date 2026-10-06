import { saleTags, type SaleTagSource } from '../../utils/saleTags.ts'

// The corner ribbon every sale card / row / header wears for its TAG (the
// return state today, "Awaiting Delivery" and other managed tags later). The
// chip beside it stays the payment state -- see utils/saleTags.ts.
//
// THE FOUR GUARANTEES, each one a class below and each asserted by
// tests/saleTagRibbon.test.ts:
//
//   1. OVERLAY, NEVER REFLOW. `absolute` + its own `overflow-hidden` box that
//      is a fixed 33px square at the host's top-left. An absolutely positioned
//      box takes no space, so the host's height, padding and text wrapping are
//      the same with or without it (measured in e2e/sale-corner-tag.spec.ts).
//      The host only needs to be `relative`; it needs no overflow clip of its
//      own, so a popover inside the host is never cut off.
//   2. NEVER IN THE WAY. `pointer-events-none`: a tap on the ribbon is a tap on
//      the card under it, so open-detail, long-press select and the receipt
//      copy button all work exactly as before.
//   3. BELOW EVERYTHING. `z-0` is the floor of the app's scale. Sticky bars are
//      z-30, the Notification dropdown 1010, the Modal layers 1050/1070 and
//      the toast layer 1100, so the detail float, a menu, a toast or the
//      minimized-draft chip always paints over it and the ribbon cannot show
//      through. No new layer number was invented.
//   4. THE RECEIPT ID STAYS READABLE. The band is 11px thick and centred on the
//      diagonal x + y = 25, so its far edge is at x + y = 33. A receipt id sits
//      12px in from the card edge with its first glyph top at about y = 15, so
//      the first digit starts at x + y = 29: the band touches only the empty
//      top-left tip of that glyph. A wider band (a longer word) would cover the
//      id, so the ribbon takes the SHORT ribbon wording, not the full status
//      name; the full name is the accessible label.
//
// Width numbers: 33 = 25 + 11 * 0.72 (the band's half thickness along an axis).

type TranslateFn = (key: string) => string | undefined

type SaleTagRibbonProps = {
  sale: SaleTagSource | null | undefined
  t?: TranslateFn
}

function translated(t: TranslateFn | undefined, key: string, fallback: string): string {
  const value = t?.(key)
  return value && value !== key ? value : fallback
}

// The pack texts carry a decorative arrow ("↩️ Partial Return"); a name read by
// a screen reader or shown in a title does not need it.
const DECORATION_PREFIX = /^[⏳🚚↩️\s]+/u

export default function SaleTagRibbon({ sale, t }: SaleTagRibbonProps) {
  const tags = saleTags(sale)
  if (!tags.length) return null
  const [primary, ...more] = tags
  const names = tags.map((tag) => translated(t, tag.labelKey, tag.fallback).replace(DECORATION_PREFIX, '').trim())
  const ribbon = translated(t, primary.ribbonKey, primary.ribbonFallback)
  return (
    <span
      data-sale-tag-ribbon={primary.id}
      role="img"
      aria-label={names.join(', ')}
      className="pointer-events-none absolute left-0 top-0 z-0 h-[33px] w-[33px] select-none overflow-hidden [border-top-left-radius:inherit]"
    >
      <span
        aria-hidden="true"
        className={`absolute left-[12.5px] top-[12.5px] flex h-[11px] w-[100px] -translate-x-1/2 -translate-y-1/2 -rotate-45 items-center justify-center whitespace-nowrap text-[7px] font-bold leading-none text-white shadow-sm ${primary.tone}`}
      >
        {ribbon}{more.length ? ` +${more.length}` : ''}
      </span>
    </span>
  )
}
