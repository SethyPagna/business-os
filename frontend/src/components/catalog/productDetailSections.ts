// Parses the existing single `description` field on a product into the
// labeled sections the public-portal Details flyout displays, rather than
// adding new database columns for each -- there is no such schema today
// (grepped cloudflare's migrations and the products import template: only
// one free-text `description` column exists), and adding one means a real
// migration plus import-template/product-form changes across the whole
// app, not something to build blind without a live DB to verify against.
// Recognizing labels already typed into the description text is the
// safe, additive path: any existing product with a plain description
// still renders exactly as before (see hasStructuredSections below), and
// anyone who *does* write "Features: ..." etc. into the description gets
// the bulleted flyout automatically, no data-model change required.
//
// Label set extended (this session) for the Customer Portal import-column
// wiring request: "Product" (matches by name -- not a description label,
// handled entirely by the import engine's existing row-match logic, not
// here), "Introduction", "Official Product Name", "Category"/"Brand"
// (existing product columns, not description labels either), "Features &
// Benefits", "Who is it for?", and "Ingredients" (already existed). This
// is a genuinely different label set than the original four
// (features/benefits/ingredients/caution) -- both sets are recognized
// below rather than one replacing the other, so an existing product
// description written in the old format still parses exactly as it did
// before this change (see the parseProductDescription tests covering the
// old "Features:"/"Benefits:" pair).
//
// "Introduction" is deliberately not its own bulleted section: it's the
// labeled form of the same leading paragraph `intro` already represents
// for an unlabeled description, so its content is folded into `intro`
// (appended after any unlabeled leading text, on the rare chance both are
// present) rather than shown as a second, redundant block. "Official
// Product Name" is also not a bulleted section -- it's a single line, so
// it comes back as its own `officialName` string instead of a `sections`
// entry, for a caller (ProductDetailFlyout.tsx) to place next to the
// product's short name however it wants.
//
// The two global "Caution" / "Need More Details" defaults from the same
// request are NOT part of this file -- per the request itself ("set once
// in Customer Portal, wire to every product"), those are a single
// portal-wide setting, not something parsed per-product out of each
// product's own description text. See CatalogEditorSurface.tsx's portal
// defaults section and ProductDetailFlyout.tsx's `cautionDefault`/
// `needMoreDetailsDefault` props for that half.
//
// Recognized labels, case-insensitive, each optionally followed by "?"
// then a colon or dash, expected to start its own line. Any text before
// the first recognized label is the intro paragraph. Within a section,
// lines are used as separate bullets when there's more than one; a
// single-line section that already contains bullet characters
// (-, *, •) is split on those; otherwise it renders as one plain
// paragraph rather than guessing where to break a sentence.

export type ProductDetailSectionKey = 'features' | 'benefits' | 'ingredients' | 'caution' | 'features_benefits' | 'who_for'

export type ProductDetailSection = {
  key: ProductDetailSectionKey
  items: string[]
}

export type ParsedProductDescription = {
  intro: string
  officialName: string
  sections: ProductDetailSection[]
  hasStructuredSections: boolean
}

// label text -> the field it fills. 'introduction' and 'official_name'
// are handled specially in parseProductDescription (folded into
// `intro`/`officialName` instead of the `sections` array) -- every other
// value here is a real ProductDetailSectionKey pushed straight into
// `sections`, same as before this change.
const LABEL_DEFS: { label: string; key: ProductDetailSectionKey | 'introduction' | 'official_name' }[] = [
  { label: 'features & benefits', key: 'features_benefits' },
  { label: 'features and benefits', key: 'features_benefits' },
  { label: 'who is it for', key: 'who_for' },
  { label: 'official product name', key: 'official_name' },
  { label: 'introduction', key: 'introduction' },
  { label: 'ingredients', key: 'ingredients' },
  { label: 'caution', key: 'caution' },
  { label: 'features', key: 'features' },
  { label: 'benefits', key: 'benefits' },
]

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeLabelText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

const LABEL_LOOKUP = new Map(LABEL_DEFS.map((def) => [normalizeLabelText(def.label), def.key]))

// Longest-label-first isn't strictly required (regex alternation
// backtracks to a shorter alternative when the longer one can't complete
// the overall match, e.g. a plain "Features:" still matches the
// "features" alternative even with "features & benefits" listed first),
// but keeps the pattern's intent obvious and avoids relying on that
// backtracking behavior.
const labelAlternatives = LABEL_DEFS
  .slice()
  .sort((a, b) => b.label.length - a.label.length)
  .map((def) => escapeForRegex(def.label).replace(/\\ /g, '\\s+'))
  .join('|')

// Matches a label at the start of a line, e.g. "Features:", "Caution -",
// or "Who is it for?:" on its own line. The optional `\??` accounts for
// labels phrased as a question ("Who is it for?"). The (?:^|\n)
// alternative (not /m's ^) is deliberate: we need the *index* of the
// match including any leading newline, so the slice logic below can cut
// it cleanly out of the surrounding text.
const LABEL_PATTERN = new RegExp(`(^|\\n)\\s*(${labelAlternatives})\\s*\\??\\s*[:\\-]\\s*`, 'gi')

function splitIntoBullets(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const byLine = trimmed.split(/\r?\n+/).map((line) => line.replace(/^[\s•*-]+/, '').trim()).filter(Boolean)
  if (byLine.length > 1) return byLine
  // Single line -- only split further if it already contains explicit
  // bullet separators; otherwise leave it as one paragraph-style item so
  // we're never guessing where a sentence should break.
  const bySeparator = trimmed.split(/\s*[•*]\s+|\s+-\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter(Boolean)
  return bySeparator.length > 1 ? bySeparator : [trimmed]
}

export function parseProductDescription(description: string | null | undefined): ParsedProductDescription {
  const text = String(description || '').trim()
  if (!text) return { intro: '', officialName: '', sections: [], hasStructuredSections: false }

  const matches = Array.from(text.matchAll(LABEL_PATTERN))
  if (matches.length === 0) {
    return { intro: text, officialName: '', sections: [], hasStructuredSections: false }
  }

  const leadingIntro = text.slice(0, matches[0].index).trim()
  const introParts: string[] = leadingIntro ? [leadingIntro] : []
  let officialName = ''
  const sections: ProductDetailSection[] = []

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const key = LABEL_LOOKUP.get(normalizeLabelText(match[2]))
    if (!key) continue
    const start = match.index + match[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    const raw = text.slice(start, end)

    if (key === 'introduction') {
      const value = raw.trim()
      if (value) introParts.push(value)
      continue
    }
    if (key === 'official_name') {
      officialName = raw.trim()
      continue
    }

    const items = splitIntoBullets(raw)
    if (items.length) sections.push({ key, items })
  }

  return { intro: introParts.join('\n\n'), officialName, sections, hasStructuredSections: sections.length > 0 }
}
