// searchMatch.ts (frontend copy)
//
// P2-2 (Gate 2B audit): this file's header used to open with "(Worker/
// backend copy)" and a paragraph describing SQL-facing helpers
// (foldDiacriticsSql, foldJoinersSql, normalizedHaystackSql, plus the
// DIACRITIC_SQL_PAIRS/JOINER_SQL_CHARS tables and sqlLiteral they leaned
// on) -- the actual header of cloudflare/src/lib/searchMatch.ts, seemingly
// pasted over this file's own header by mistake at some point. Confirmed
// those SQL-string-building exports had zero call sites anywhere in
// frontend/src -- they build raw SQL fragments, a concept with no meaning
// in a browser bundle that only ever talks to the Worker over its REST
// API, never to D1/SQLite directly -- so removed here along with the
// mislabeled header, rather than left as unreachable exports pretending
// to be load-bearing.
//
// Client-side counterpart of cloudflare/src/lib/searchMatch.ts -- same
// normalization/fuzzy-matching behavior (typos, joiner variants, conjoined
// vs. split words, word-order independence, diacritics, brand-shorthand
// aliases) for the functions genuinely shared between the two runtimes
// (normalizeSearchText, compactSearchText, tokenizeSearchWords,
// matchesSearchTermGroups, fuzzyTextMatches, runFuzzyFallbackMatch, and
// friends), duplicated here rather than imported because the frontend and
// the Cloudflare Worker are two separate TypeScript projects/bundlers with
// no shared package between them today. If a real shared package is ever
// set up, these two files should be collapsed into one. See
// frontend/tests/searchMatchParity.test.ts for the test that pins the two
// copies' shared functions behaving identically.
//
// Shared free-text matching used everywhere a person types into a product
// search box (Products, Inventory, POS, the public portal, and the portal
// editor's own preview search). Before this module, every one of those
// pages did its own `haystack.includes(term)` substring check, which meant
// a search only ever worked if the person typed an exact, correctly-spelled,
// correctly-ordered substring of the stored text. That silently failed for
// very common real-world input:
//   - typos ("consealer" for "concealer")
//   - joiner/punctuation variants ("Cover + Concealer" vs "Cover+Concealer"
//     vs "Cover  Concealer")
//   - conjoined vs. split words ("9-piece" vs "9 piece" vs "9piece",
//     "BS Mall" vs "BS-Mall" vs "BSMall")
//   - words typed in a different order than they're stored
//     ("Concealer Cover" not matching a product literally named
//     "Cover Concealer")
//   - accented/diacritic characters typed with or without their accents
//     (a search for "creme" should still find "Crème")
//   - brand shorthand that isn't a spelling variant at all, just an
//     abbreviation ("RT" for "Real Techniques")
//
// This module fixes all of the above in one place so every page behaves
// the same way. It is intentionally dependency-free (no DOM/browser APIs).

// Characters that don't decompose via Unicode NFD (so `foldDiacritics`
// below wouldn't catch them on its own): ligatures, strokes, and a few
// other Latin-Extended letters common in brand/ingredient names.
const LIGATURE_FOLD_MAP: Record<string, string> = {
  'æ': 'ae', 'Æ': 'AE',
  'œ': 'oe', 'Œ': 'OE',
  'ø': 'o', 'Ø': 'O',
  'ß': 'ss',
  'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D',
  'þ': 'th', 'Þ': 'Th',
}

// Strips accents/diacritics of every kind the person might type or not
// type: acute (á), grave (à), circumflex (â), umlaut/diaeresis (ä), tilde
// (ã, ñ, õ), rings (å), cedillas/hooks (ç, ş, ţ), plus the ligatures/
// strokes above that Unicode's own decomposition doesn't cover.
export function foldDiacritics(value: string): string {
  let out = ''
  for (const char of value) out += LIGATURE_FOLD_MAP[char] ?? char
  // NFD splits a precomposed accented letter (e.g. "é") into the base
  // letter ("e") plus a separate combining-mark codepoint; stripping the
  // U+0300-U+036F combining-diacritical-marks block then removes every
  // acute/grave/circumflex/umlaut/tilde/ring/cedilla in one pass.
  return out.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Lowercases, folds diacritics, and treats every common "joiner" character
// (&, +, /, _, ., -) as a plain space so "Cover+Concealer", "Cover &
// Concealer", and "Cover - Concealer" all normalize the same way. Any other
// punctuation is dropped rather than treated as a word boundary, keeping
// e.g. "e.l.f." from silently becoming "e l f " with stray gaps.
//
// The final "drop anything that isn't a letter/digit" pass used to be
// `[^a-z0-9\s]` -- ASCII-only. Real, confirmed bug that shipped from that:
// it silently deleted every non-Latin character, not just punctuation --
// so typing a Khmer word (this catalog has many bilingual Khmer/English
// product names) normalized to an EMPTY string, which meant the search box
// could never find that word at all even though the row itself plainly
// contains it. Same bug, same fix, as this file's cloudflare counterpart
// (cloudflare/src/lib/searchMatch.ts). `\p{L}` (Unicode "Letter", every
// script -- Khmer, CJK, Cyrillic, Thai, Arabic, etc.) and `\p{N}` (Unicode
// "Number") replace the old ASCII-only class so any language's letters and
// digits survive; punctuation/symbols in any script still get folded to a
// space exactly as before. Requires the `u` (unicode) regex flag for
// `\p{...}` property escapes to be recognized.
export function normalizeSearchText(value: unknown): string {
  const base = foldDiacritics(String(value ?? ''))
    .toLowerCase()
    .replace(/[&+/_.-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return base
  // Shade/SKU codes (e.g. "O8Y" printed on a product, typed back as "08Y")
  // use a capital letter-O and digit-0 near-interchangeably. Fold letter-O
  // to digit-0 within any token that also contains a real digit, so both
  // spellings normalize to the same canonical form -- scoped to
  // digit-bearing tokens only so a pure-letter word like "Concealer" is
  // never touched. Same bug, same fix, as this file's cloudflare
  // counterpart (cloudflare/src/lib/searchMatch.ts).
  return base
    .split(' ')
    .map((word) => (/[0-9]/.test(word) ? word.replace(/o/g, '0') : word))
    .join(' ')
}

// Standalone version of the O-to-0 shade-code fold above, exposed for
// callers that need the OTHER spelling of an already-normalized word.
// Returns null when there's nothing to swap (no digit at all, or a digit
// present but no o/0 lookalike character in it).
export function swapCodeLookalikeChar(word: string): string | null {
  if (!/[0-9]/.test(word)) return null
  if (/o/.test(word)) return word.replace(/o/g, '0')
  if (/0/.test(word)) return word.replace(/0/g, 'o')
  return null
}

// The "joined" form of normalizeSearchText with every space removed too --
// this is what makes "SK-II", "Sk II", and "SKII" compare equal, along with
// "BS Mall"/"BS-Mall"/"BSMall" and "9-piece"/"9 piece"/"9piece".
export function compactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, '')
}

function tokenizeNormalized(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

// Splits and normalizes a raw search box value into individual words the
// same way normalizeSearchText/compactSearchText do (diacritic-folded,
// joiners treated as spaces, lowercased) -- this is what routes/products.ts
// and friends now use instead of their old `raw.toLowerCase().split(/\s+/)`,
// which never folded diacritics or joiner punctuation, so e.g. "creme" and
// "crème", or "cover+concealer" typed against a "Cover + Concealer" row,
// never matched even though both sides plainly mean the same thing.
export function tokenizeSearchWords(raw: unknown, maxWords = 8): string[] {
  return tokenizeNormalized(normalizeSearchText(raw)).slice(0, maxWords)
}

// Every alias form (including the word itself) for a single normalized
// search word -- exported so callers can generate one LIKE per alias.
export function expandAliasCandidates(compactWord: string): string[] {
  return aliasCandidates(compactWord)
}

// Curated abbreviation/shorthand pairs that aren't spelling variants (so
// neither substring nor edit-distance matching would ever connect them) --
// just an alias a shopper or staff member commonly types instead of the
// full brand name. Extend this list as real-world misses come in; each
// entry is a group of compact (space/punctuation-free) forms that should
// all be treated as referring to the same thing.
const ALIAS_GROUPS: string[][] = [
  ['rt', 'realtechniques'],
  ['nyx', 'nyxprofessionalmakeup'],
  ['bh', 'bhcosmetics'],
  ['ofra', 'ofracosmetics'],
]

const ALIAS_LOOKUP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>()
  for (const group of ALIAS_GROUPS) {
    for (const entry of group) map.set(entry, group)
  }
  return map
})()

function aliasCandidates(compactToken: string): string[] {
  return ALIAS_LOOKUP.get(compactToken) || [compactToken]
}

// Bounded Levenshtein (edit) distance -- returns `limit + 1` as soon as it's
// certain the real distance exceeds `limit`, so a wildly different pair of
// words (e.g. comparing "concealer" against "sku") bails out in O(min
// length) instead of computing the full O(n*m) table for no reason.
function boundedLevenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0
  const lenDiff = Math.abs(a.length - b.length)
  if (lenDiff > limit) return limit + 1
  let previousRow = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previousRow[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = new Array(b.length + 1)
    currentRow[0] = i
    let rowMin = currentRow[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currentRow[j] = Math.min(
        previousRow[j] + 1,
        currentRow[j - 1] + 1,
        previousRow[j - 1] + cost,
      )
      if (currentRow[j] < rowMin) rowMin = currentRow[j]
    }
    if (rowMin > limit) return limit + 1
    previousRow = currentRow
  }
  return previousRow[b.length]
}

// How many typo'd characters we tolerate scales with word length -- a
// 2-3 letter word (e.g. "spf", "oil") allows zero typos (anything looser
// starts matching unrelated short words), a short-to-medium word allows
// one, and a longer word allows two.
function typoBudgetForLength(length: number): number {
  if (length <= 3) return 0
  if (length <= 7) return 1
  return 2
}

// True if a single query word plausibly refers to a single haystack word:
// an exact match, a prefix/substring either direction (covers partial
// typing and simple pluralization), or a small bounded edit distance
// (covers genuine typos/transpositions).
function wordsFuzzyMatch(queryWord: string, haystackWord: string): boolean {
  if (!queryWord || !haystackWord) return false
  if (queryWord === haystackWord) return true
  if (haystackWord.includes(queryWord) || queryWord.includes(haystackWord)) return true
  const budget = Math.min(typoBudgetForLength(queryWord.length), typoBudgetForLength(haystackWord.length))
  if (budget > 0 && boundedLevenshtein(queryWord, haystackWord, budget) <= budget) return true
  // Partial typing WITH a typo in the typed portion -- kept in sync with
  // the backend copy (cloudflare/src/lib/searchMatch.ts's own comment on
  // this exact block has the full "Elixe" reasoning). queryWord shorter
  // than haystackWord only; compared against haystackWord's own
  // same-length prefix instead of the full word, budget scaled to
  // queryWord's own length.
  if (queryWord.length < haystackWord.length) {
    const prefixBudget = typoBudgetForLength(queryWord.length)
    if (prefixBudget > 0) {
      const prefix = haystackWord.slice(0, queryWord.length)
      if (boundedLevenshtein(queryWord, prefix, prefixBudget) <= prefixBudget) return true
    }
  }
  return false
}

interface HaystackIndex {
  tokens: string[]
  compact: string
}

// Pre-normalizes one record's searchable text once, so re-checking it
// against multiple search-term groups (AND/OR mode) doesn't redo the same
// normalization work per group.
export function buildHaystackIndex(...fields: unknown[]): HaystackIndex {
  const normalized = normalizeSearchText(fields.filter((field) => field !== null && field !== undefined).join(' '))
  return {
    tokens: tokenizeNormalized(normalized),
    compact: normalized.replace(/\s+/g, ''),
  }
}

// A single typed word ("query word") is considered present in the record if
// its compact form appears anywhere in the record's compact text (handles
// joiner/spacing/diacritic variants and words that span a joiner, like
// "9piece") OR it fuzzy-matches any individual word in the record (handles
// typos and simple word-order independence), tried against every alias of
// that word too.
function queryWordMatchesHaystack(queryWord: string, index: HaystackIndex): boolean {
  const candidates = aliasCandidates(queryWord)
  for (const candidate of candidates) {
    if (!candidate) continue
    if (index.compact.includes(candidate)) return true
    if (index.tokens.some((haystackWord) => wordsFuzzyMatch(candidate, haystackWord))) return true
  }
  return false
}

// One comma-separated search term ("Cover Concealer") matches a record if
// every word in it is present somewhere in the record, in any order --
// this is what lets "Concealer Cover" find a product literally named
// "Cover Concealer".
function termMatchesHaystack(term: string, index: HaystackIndex): boolean {
  const words = tokenizeNormalized(normalizeSearchText(term))
  if (!words.length) return true
  return words.every((word) => queryWordMatchesHaystack(word, index))
}

// Drop-in replacement for the old `terms.every/some(t => haystack.includes(t))`
// pattern used across Products/Inventory/POS/portal search. `terms` is the
// same comma-separated group list `buildProductSearchTerms` already
// produces (each entry may itself be multiple words) -- this just makes the
// per-term/per-word comparison typo- and order-tolerant instead of a
// literal substring check, and folds AND/OR mode in the same way the old
// code did.
export function matchesSearchTermGroups(
  haystack: unknown,
  terms: readonly string[],
  mode: 'AND' | 'OR' | string = 'AND',
): boolean {
  const groups = (terms || []).map((term) => String(term || '').trim()).filter(Boolean)
  if (!groups.length) return true
  const index = buildHaystackIndex(haystack)
  const results = groups.map((term) => termMatchesHaystack(term, index))
  return mode === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

// Convenience one-shot version for call sites that don't already have a
// pre-built term list (e.g. a single free-text field like a notification
// or a filter-menu option label).
export function fuzzyTextMatches(haystack: unknown, rawQuery: unknown): boolean {
  const query = String(rawQuery ?? '').trim()
  if (!query) return true
  return termMatchesHaystack(query, buildHaystackIndex(haystack))
}

// --- JS fallback pass for genuine typos ---------------------------------
//
// Even on the server's own SQL-folded search (which handles "diacritics/
// joiners don't matter" -- see cloudflare/src/lib/searchMatch.ts's
// normalizedHaystackSql for how, a backend-only concern with no equivalent
// here), a plain SQL LIKE can't express "this is a misspelling of that
// word" (that's wordsFuzzyMatch's bounded-Levenshtein pass earlier in this
// file). A typed "consealer" against a stored "concealer" is zero SQL LIKE
// hits no matter how it's folded, even though a human recognizes the match
// instantly.
//
// This was planned since the fuzzy-search rollout (part 66) but never
// actually wired into any route -- routes/products.ts imported
// fuzzyTextMatches and never called it, a real "looks-wired-but-isn't" gap
// (Track A's exact bug class), found and fixed in an earlier session. Every
// server-paginated search route (products.ts, inventory.ts, portal.ts,
// branches.ts) now calls the backend copy of this same function the same
// way: only when the strict SQL-folded search finds literally zero rows
// for a non-empty query, against a bounded candidate list the caller has
// already narrowed by every *other* filter (branch/stock/category/etc,
// still via SQL) -- so the common case (a correctly- or near-correctly-
// typed search) never pays this cost, and a worst-case miss only ever
// fuzzy-matches a bounded slice of the catalog, never the whole table.
// This frontend copy of runFuzzyFallbackMatch has no current call site of
// its own (every page below calls matchesSearchTermGroups directly, to
// re-filter the page it already fetched) -- kept for parity with the
// backend copy and because it's the same one-line wrapper either way.
export interface FuzzyFallbackCandidate<TId extends number | string = number> {
  id: TId
  haystack: string
}

export function runFuzzyFallbackMatch<TId extends number | string = number>(
  candidates: ReadonlyArray<FuzzyFallbackCandidate<TId>>,
  searchTerms: readonly string[],
  mode: 'AND' | 'OR' | string = 'AND',
): TId[] {
  const matched: TId[] = []
  for (const candidate of candidates) {
    if (matchesSearchTermGroups(candidate.haystack, searchTerms, mode)) matched.push(candidate.id)
  }
  return matched
}
