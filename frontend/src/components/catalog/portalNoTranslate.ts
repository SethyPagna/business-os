// Owner-marked "never machine-translate this" spans in storefront copy.
//
// A visitor may still run the browser's page translator on the storefront.
// Most of the page should translate, but some phrases in the owner's own
// About text must reach the visitor exactly as written: a brand line, a shop
// slogan, a street name, a product line spelled the owner's way. The owner
// marks those by wrapping them in double square brackets:
//
//   "Welcome to [[Leang Cosmetics]], home of [[Leang Glow]] serums."
//
// The brackets never reach the page; the marked text renders inside a
// translate="no" span, which browser page translators leave untouched. Text
// with no markers comes back as one translatable segment, so an About story
// written before this existed renders exactly as it did. An unmatched "[[" is
// kept as literal text rather than guessed at.
export type NoTranslateSegment = { text: string; noTranslate: boolean }

const MARKER_PATTERN = /\[\[([\s\S]+?)\]\]/g

export function splitNoTranslateSegments(value: unknown): NoTranslateSegment[] {
  const text = String(value ?? '')
  if (!text) return []
  const segments: NoTranslateSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ text: text.slice(cursor, start), noTranslate: false })
    const marked = match[1].trim()
    if (marked) segments.push({ text: marked, noTranslate: true })
    cursor = start + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), noTranslate: false })
  return segments
}

/** The same text with its markers removed -- for alt text, titles and other attributes. */
export function stripNoTranslateMarkers(value: unknown): string {
  return splitNoTranslateSegments(value).map((segment) => segment.text).join('')
}
