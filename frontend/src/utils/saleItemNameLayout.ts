/**
 * Split a receipt-line name into at most two display rows without deleting or
 * rewriting any character. The caller can therefore keep the two rows inside
 * one horizontal scroller and still copy the exact stored product name.
 *
 * Short names stay on one row. Long names with whitespace break at the
 * whitespace run nearest the visual midpoint; an unbroken barcode-like name
 * remains one row and is reached through horizontal scrolling.
 */
export function balancedSaleItemNameLines(value: string, splitAfter = 32): readonly string[] {
  if (Array.from(value).length <= splitAfter) return [value]

  const boundaries = Array.from(value.matchAll(/\s+/gu))
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((index) => index > 0 && index < value.length)
  if (!boundaries.length) return [value]

  const midpoint = Array.from(value).length / 2
  const splitAt = boundaries.reduce((best, candidate) => {
    const candidateDistance = Math.abs(Array.from(value.slice(0, candidate)).length - midpoint)
    const bestDistance = Math.abs(Array.from(value.slice(0, best)).length - midpoint)
    return candidateDistance < bestDistance ? candidate : best
  })
  return [value.slice(0, splitAt), value.slice(splitAt)]
}

/**
 * The promotion named beside a line's cut, capped for display.
 *
 * product_discount_label is the merchant's own rule title (promotion_rules
 * .title, captured at sale time) and has no length limit of its own, while
 * neither surface that prints it has room for one: the sale detail puts it
 * inside a `whitespace-nowrap` price cell, where an over-long title pushes the
 * total column off a phone screen, and the receipt puts it beside the product
 * name, where it eats rows of 58/80 mm paper.
 *
 * 40 characters is the SAME cap the Telegram sale line already applies
 * (cloudflare/src/lib/telegram.ts, cleanLine(item.promotionLabel, 40)), so the
 * three surfaces name a promotion identically. Whitespace is collapsed because
 * a title typed across two lines must still print as one tag, and the cap
 * counts code points so it can never split a surrogate pair.
 */
export const PROMOTION_LABEL_MAX_CHARACTERS = 40

export function promotionLabelText(label: unknown): string {
  const characters = Array.from(String(label ?? '').replace(/\s+/gu, ' ').trim())
  return characters.slice(0, PROMOTION_LABEL_MAX_CHARACTERS).join('')
}

/** Keep compact number controls only as wide as their current editable text. */
export function saleEditorInputWidth(value: string, minimumCharacters = 5): string {
  // One character is reserved beyond the visible value/padding allowance for
  // the native number-input controls. Without it, Chromium's inner text box
  // is about 4px too narrow for realistic decimal quantities and prices even
  // though the outer input appears wide enough.
  return `${Math.max(minimumCharacters, Array.from(value).length + 4)}ch`
}
