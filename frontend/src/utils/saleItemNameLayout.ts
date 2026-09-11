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

/** Keep compact number controls only as wide as their current editable text. */
export function saleEditorInputWidth(value: string, minimumCharacters = 5): string {
  // One character is reserved beyond the visible value/padding allowance for
  // the native number-input controls. Without it, Chromium's inner text box
  // is about 4px too narrow for realistic decimal quantities and prices even
  // though the outer input appears wide enough.
  return `${Math.max(minimumCharacters, Array.from(value).length + 4)}ch`
}
