// The fixed set of description sections an import is allowed to bring in.
//
// Real supplier CSVs carry a `description` cell that is itself structured --
// the user's own file embeds labelled blocks like:
//
//     "Official Product Name": Abercrombie & Fitch Authentic
//     "Introduction":
//     "Features & Benefits":
//     ...
//
// The rule is that ONLY the five labels below are accepted. Any other
// `"Something":` block is ignored outright rather than imported: an
// unrecognised heading is almost always a supplier's own column that means
// nothing to this catalog, and letting it through would silently pollute
// every product page with vendor boilerplate that no display surface knows
// how to render.
//
// A description carrying just ONE recognised label is perfectly valid -- the
// labels are a whitelist, not a required schema, so nothing is rejected for
// being incomplete.
//
// `Caution` is deliberately NOT accepted here even though the portal renders
// a Caution block: that text is a portal-wide default authored in the
// Customer Portal editor, not a per-product import field. Same for
// "Need More Details". Accepting them from a CSV would let a supplier's
// wording silently override the shop's own.
//
// Output is re-serialised in one canonical order and label spelling, so
// frontend/src/components/catalog/productDetailSections.ts's
// parseProductDescription reads back exactly what it expects regardless of
// how the source file happened to spell or order things.

/** Canonical section order for the rebuilt description. */
const SECTION_ORDER = ['official_name', 'introduction', 'features_benefits', 'who_for', 'ingredients'] as const

export type ImportDescriptionSectionKey = typeof SECTION_ORDER[number]

// Accepted spellings for each section, normalised (lowercased, punctuation
// tolerated, internal whitespace collapsed). Several are listed because
// export tools vary: some strip the ampersand, some strip the question mark.
const LABEL_ALIASES: Record<ImportDescriptionSectionKey, string[]> = {
  official_name: ['official product name'],
  introduction: ['introduction'],
  features_benefits: ['features & benefits', 'features and benefits', 'features benefits'],
  who_for: ['who is it for', 'who is this for'],
  ingredients: ['ingredients'],
}

/** How each accepted section is written back out. */
const CANONICAL_LABEL: Record<ImportDescriptionSectionKey, string> = {
  official_name: 'Official Product Name',
  introduction: 'Introduction',
  features_benefits: 'Features & Benefits',
  who_for: 'Who is it for?',
  ingredients: 'Ingredients',
}

const ALIAS_LOOKUP = new Map<string, ImportDescriptionSectionKey>()
for (const key of SECTION_ORDER) {
  for (const alias of LABEL_ALIASES[key]) ALIAS_LOOKUP.set(alias, key)
}

// Labels that are dropped for a DIFFERENT reason than the rest: the app
// already holds this data in a real column, and every display surface wires
// it in from there.
//
// The portal's product detail renders Category and Brand from the
// `categories`/`brands` columns and the shop's name from `products.name`.
// Importing a supplier's prose copy of the same thing would store the value
// twice, let the two drift apart, and cost description bytes on every row of
// an 8,700-row file for text nothing reads.
//
// Kept separate from the unrecognised bucket so `ignored` stays meaningful:
// an unrecognised label is something the operator may want to look at, while
// these are expected and correct to drop. Reporting them as "ignored" would
// make the signal useless on exactly the file this rule exists for.
const AUTO_WIRED_LABELS = new Set([
  'brand', 'brands',
  'category', 'categories',
  "shop's product name", 'shops product name', 'shop product name', 'shop name',
  'product name',
])

/**
 * Reduces a label to its comparable form: strips surrounding quotes, a
 * trailing question mark, and any non-alphanumeric noise, then collapses
 * whitespace and lowercases. `"Who is it for?"` and `WHO IS IT FOR` both
 * become `who is it for`.
 */
function normalizeLabel(raw: string): string {
  return raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\?/g, ' ')
    .replace(/[^a-z0-9&\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// A heading line: optional quotes around a label, then a colon. Anchored to
// the start of a line so a colon inside prose ("Note: apply twice") is not
// mistaken for a section break.
const HEADING_LINE = /^[ \t]*["']?([^"':\n]{1,80}?)["']?[ \t]*:[ \t]*(.*)$/

export type SanitizedDescription = {
  /** The rebuilt description, or '' when nothing recognised survived. */
  text: string
  /** Section keys that were kept, in canonical order. */
  kept: ImportDescriptionSectionKey[]
  /** Raw labels that were recognised as headings but are not on the whitelist. */
  ignored: string[]
  /**
   * Labels dropped because the app already stores that value in a real
   * column and wires it in (Brand, Category, Shop's Product Name). Reported
   * separately from `ignored` because these are expected, not suspicious.
   */
  autoWired: string[]
}

/**
 * Keeps only whitelisted sections from an imported description.
 *
 * Text appearing BEFORE the first heading is preserved as the intro
 * paragraph -- a plain, unlabelled description is therefore passed through
 * untouched, which matters because most catalogs have exactly that and
 * nothing should change for them.
 */
export function sanitizeImportedDescription(raw: unknown): SanitizedDescription {
  const source = String(raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!source) return { text: '', kept: [], ignored: [], autoWired: [] }

  const lines = source.split('\n')
  const collected = new Map<ImportDescriptionSectionKey, string[]>()
  const ignored: string[] = []
  const autoWired: string[] = []
  const leading: string[] = []

  // null while still in the pre-heading intro; a key while inside an accepted
  // section; 'skip' while inside a section we are discarding.
  let current: ImportDescriptionSectionKey | 'skip' | null = null

  for (const line of lines) {
    const match = line.match(HEADING_LINE)
    if (match) {
      const label = normalizeLabel(match[1])
      const key = ALIAS_LOOKUP.get(label)
      const inlineValue = match[2].trim()
      if (key) {
        current = key
        if (!collected.has(key)) collected.set(key, [])
        if (inlineValue) collected.get(key)!.push(inlineValue)
      } else {
        // Unrecognised heading: drop it AND everything under it, until the
        // next heading. This is the "system auto ignores, doesn't import"
        // rule -- a supplier's own block must not leak through as loose text
        // just because it had no label we understood.
        current = 'skip'
        const original = match[1].trim()
        if (AUTO_WIRED_LABELS.has(label)) {
          if (original && !autoWired.includes(original)) autoWired.push(original)
        } else if (original && !ignored.includes(original)) {
          ignored.push(original)
        }
      }
      continue
    }
    if (current === null) leading.push(line)
    else if (current !== 'skip') collected.get(current)!.push(line)
  }

  const introText = leading.join('\n').trim()
  // Unlabelled leading text folds into Introduction, which is where the
  // portal renders it. If the file ALSO carried an explicit Introduction
  // block, the labelled one goes first and the loose text follows it rather
  // than either being dropped.
  if (introText) {
    const existing = collected.get('introduction') || []
    collected.set('introduction', [...existing, introText])
  }

  const parts: string[] = []
  const kept: ImportDescriptionSectionKey[] = []
  for (const key of SECTION_ORDER) {
    const body = (collected.get(key) || []).join('\n').trim()
    if (!body) continue
    kept.push(key)
    // Introduction is emitted UNLABELLED and first, matching
    // buildDescriptionFromColumns and parseProductDescription: leading
    // unlabelled text is read back as the intro, so labelling it would make
    // a one-paragraph description render with a redundant heading.
    parts.push(key === 'introduction' ? body : `${CANONICAL_LABEL[key]}:\n${body}`)
  }

  // Introduction, when present, belongs at the top.
  const introIndex = kept.indexOf('introduction')
  if (introIndex > 0) {
    const [introPart] = parts.splice(introIndex, 1)
    parts.unshift(introPart)
    kept.splice(introIndex, 1)
    kept.unshift('introduction')
  }

  return { text: parts.join('\n\n'), kept, ignored, autoWired }
}
