// The one matching rule behind every "type or select" catalog field
// (Category, Brand, Unit, Supplier, and the create-form Name lookup).
//
// Root cause this module exists for (owner report, 2026-09-06: "categories
// still does not show the available options when i write"): each field grew
// its OWN inline matcher inside the component that rendered it, and they
// disagreed on the one case that matters most -- an EMPTY query.
// ProductForm's supplier field computed
//     const supplierMatches = form.supplier ? supplierList.filter(...) : []
// so focusing the field with nothing typed produced zero rows and no
// dropdown at all: the operator had to guess a first letter before the app
// would admit it knew any suppliers. The Category/Brand/Unit matcher next to
// it did the opposite (empty query => every option). One rule, one
// implementation: an empty query means "show me everything", because that is
// exactly the moment the operator does not know what exists.
//
// Kept JSX-free and dependency-free so `node tests/suggestionMatching.test.ts`
// can exercise the real logic instead of a copy of it.

export type SuggestionOption = {
  /** The text that lands in the input when this row is picked. */
  value: string
  /** Stable React key / dom id fragment. Defaults to the lowercased value. */
  key?: string
  /** Secondary line shown under the value (barcode, brand, company...). */
  meta?: string
  /** Renders a check mark: this row is the currently linked record. */
  selected?: boolean
  /** Opaque payload handed back to onChange so a pick can carry an id. */
  payload?: unknown
}

export type SuggestionFilterMode = 'substring' | 'none'

export type BuildSuggestionMatchesOptions = {
  /**
   * 'substring' (default) filters client-side on the typed text.
   * 'none' is for lists the SERVER already narrowed -- the create-form Name
   * lookup searches by name AND barcode, so re-filtering its rows against
   * the typed name would silently drop every barcode hit.
   */
  filter?: SuggestionFilterMode
  limit?: number
}

const DEFAULT_LIMIT = 50

/**
 * Trim, drop blanks, and de-duplicate case-insensitively (first spelling
 * wins). Imported catalog data carries "Ariana" and "ARIANA" as two rows;
 * a plain Set would show both and they look identical on screen.
 */
export function normalizeSuggestionOptions(
  options: ReadonlyArray<string | SuggestionOption | null | undefined> = [],
): SuggestionOption[] {
  const seen = new Set<string>()
  const unique: SuggestionOption[] = []
  for (const raw of options || []) {
    if (raw === null || raw === undefined) continue
    const option: SuggestionOption = typeof raw === 'string' ? { value: raw } : raw
    const value = String(option?.value ?? '').trim()
    if (!value) continue
    const dedupeKey = String(option?.key ?? value).toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    unique.push({
      value,
      key: option.key ? String(option.key) : value.toLowerCase(),
      meta: option.meta ? String(option.meta) : undefined,
      selected: option.selected === true,
      payload: option.payload,
    })
  }
  return unique
}

/**
 * The rows a suggestion field should show for the currently typed text.
 * An empty/whitespace query returns every option -- see the header note.
 */
export function buildSuggestionMatches(
  options: ReadonlyArray<string | SuggestionOption | null | undefined> = [],
  query = '',
  { filter = 'substring', limit = DEFAULT_LIMIT }: BuildSuggestionMatchesOptions = {},
): SuggestionOption[] {
  const normalizedQuery = String(query ?? '').trim().toLowerCase()
  const unique = normalizeSuggestionOptions(options)
  const matched = (filter === 'none' || !normalizedQuery)
    ? unique
    : unique.filter((option) => (
      option.value.toLowerCase().includes(normalizedQuery)
      || String(option.meta || '').toLowerCase().includes(normalizedQuery)
    ))
  return limit > 0 ? matched.slice(0, limit) : matched
}

/**
 * Keyboard cursor movement inside an open list. -1 means "nothing
 * highlighted"; ArrowDown from there lands on the first row, ArrowUp on the
 * last, and both ends wrap so a long list is reachable from either side.
 */
export function nextSuggestionIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return ((current + delta) % count + count) % count
}
