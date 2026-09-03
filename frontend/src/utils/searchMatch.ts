// searchMatch.ts (Worker/backend copy)
//
// Server-side counterpart of frontend/src/utils/searchMatch.ts -- same
// normalization/fuzzy-matching behavior (typos, joiner variants, conjoined
// vs. split words, word-order independence, diacritics, brand-shorthand
// aliases), duplicated here rather than imported because the frontend and
// the Cloudflare Worker are two separate TypeScript projects/bundlers with
// no shared package between them today. If a real shared package is ever
// set up, these two files should be collapsed into one.
//
// This copy adds SQL-facing helpers (foldDiacriticsSql, foldJoinersSql,
// normalizedHaystackSql, tokenizeSearchWords, expandAliasCandidates) so
// routes/products.ts and friends can build a WHERE clause that's tolerant
// of joiners/diacritics directly in SQL (see those functions' own comments
// for why), and keeps fuzzyTextMatches/matchesSearchTermGroups as the JS
// fallback pass for genuine typos, which SQL LIKE can never express.
//
// Original frontend header, still accurate for the shared logic below:
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
  if (budget <= 0) return false
  return boundedLevenshtein(queryWord, haystackWord, budget) <= budget
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

// --- SQL-facing helpers -----------------------------------------------
//
// D1/SQLite's LIKE is a literal, byte-for-byte comparison -- it has no
// concept of "these two characters mean the same letter" the way our JS
// normalizeSearchText does. To make the *server's own* search (the one
// that actually determines paginated results, not just the client's
// re-filter of the current page) diacritic- and joiner-tolerant without a
// database migration or a new normalized column, these helpers wrap a SQL
// text expression in a chain of REPLACE() calls that performs the exact
// same folding in SQL that normalizeSearchText performs in JS. Both sides
// of the eventual `<folded column> LIKE <folded/normalized param>`
// comparison end up in the same normalized alphabet, so a stored value of
// "Crème" matches a typed "creme", and a stored "Cover + Concealer"
// matches a typed "cover concealer" or "cover+concealer" either way.
//
// Deliberately NOT attempted in SQL: genuine typo/edit-distance tolerance.
// SQLite has no built-in fuzzy-match operator, and emulating Levenshtein in
// pure SQL per-row would be both slow and unreadable. That case is instead
// handled by a JS fallback pass (see routes/products.ts's
// runFuzzyFallbackSearch) that only runs when the strict, SQL-folded search
// above finds zero results for a non-empty query -- the common case (a
// correctly- or near-correctly-typed search) never pays that cost.

const DIACRITIC_SQL_PAIRS: Array<[string, string]> = [
  ['á', 'a'], ['Á', 'a'], ['à', 'a'], ['À', 'a'], ['â', 'a'], ['Â', 'a'], ['ä', 'a'], ['Ä', 'a'], ['ã', 'a'], ['Ã', 'a'], ['å', 'a'], ['Å', 'a'],
  ['é', 'e'], ['É', 'e'], ['è', 'e'], ['È', 'e'], ['ê', 'e'], ['Ê', 'e'], ['ë', 'e'], ['Ë', 'e'],
  ['í', 'i'], ['Í', 'i'], ['ì', 'i'], ['Ì', 'i'], ['î', 'i'], ['Î', 'i'], ['ï', 'i'], ['Ï', 'i'],
  ['ó', 'o'], ['Ó', 'o'], ['ò', 'o'], ['Ò', 'o'], ['ô', 'o'], ['Ô', 'o'], ['ö', 'o'], ['Ö', 'o'], ['õ', 'o'], ['Õ', 'o'], ['ø', 'o'], ['Ø', 'o'],
  ['ú', 'u'], ['Ú', 'u'], ['ù', 'u'], ['Ù', 'u'], ['û', 'u'], ['Û', 'u'], ['ü', 'u'], ['Ü', 'u'],
  ['ý', 'y'], ['Ý', 'y'], ['ÿ', 'y'], ['Ÿ', 'y'],
  ['ñ', 'n'], ['Ñ', 'n'], ['ç', 'c'], ['Ç', 'c'], ['ş', 's'], ['Ş', 's'], ['ţ', 't'], ['Ţ', 't'],
  ['æ', 'ae'], ['Æ', 'ae'], ['œ', 'oe'], ['Œ', 'oe'], ['ß', 'ss'], ['ł', 'l'], ['Ł', 'l'], ['đ', 'd'], ['Đ', 'd'], ['þ', 'th'], ['Þ', 'th'],
]

const JOINER_SQL_CHARS = ['+', '&', '/', '_', '.', '-']

function sqlLiteral(char: string): string {
  return char.replace(/'/g, "''")
}

// Wraps `expr` (a column reference or any SQL text expression) in nested
// REPLACE() calls that fold every accented character in DIACRITIC_SQL_PAIRS
// to its plain-ASCII base letter, mirroring foldDiacritics above.
export function foldDiacriticsSql(expr: string): string {
  let out = expr
  for (const [accented, base] of DIACRITIC_SQL_PAIRS) {
    out = `REPLACE(${out}, '${sqlLiteral(accented)}', '${base}')`
  }
  return out
}

// Wraps `expr` in nested REPLACE() calls turning every joiner character
// into a space, mirroring normalizeSearchText's joiner handling.
export function foldJoinersSql(expr: string): string {
  let out = expr
  for (const joiner of JOINER_SQL_CHARS) {
    out = `REPLACE(${out}, '${sqlLiteral(joiner)}', ' ')`
  }
  return out
}

// Full pipeline: fold diacritics (case-sensitive pairs, so this must run
// before lower()), fold joiners, then lower() for plain ASCII casing.
// Apply this to both the column expression AND the bound search parameter
// (tokenizeSearchWords already normalizes the parameter side in JS) so the
// comparison happens in the same normalized alphabet on both sides.
export function normalizedHaystackSql(expr: string): string {
  return `lower(${foldJoinersSql(foldDiacriticsSql(expr))})`
}

// --- JS fallback pass for genuine typos ---------------------------------
//
// SQL LIKE, even folded through normalizedHaystackSql above, is still a
// literal substring comparison -- it can express "diacritics/joiners don't
// matter" but not "this is a misspelling of that word" (that's
// wordsFuzzyMatch's bounded-Levenshtein pass earlier in this file, which
// SQL has no equivalent of and this file's own header comment always said
// would run as a fallback -- see routes/products.ts's now-corrected
// splitSearchTerms comment). A typed "consealer" against a stored
// "concealer" is zero SQL LIKE hits no matter how it's folded, even though
// a human recognizes the match instantly.
//
// This was planned since the fuzzy-search rollout (part 66) but never
// actually wired into any route -- routes/products.ts imported
// fuzzyTextMatches and never called it, a real "looks-wired-but-isn't" gap
// (Track A's exact bug class), found and fixed this session. Every
// server-paginated search route (products.ts, inventory.ts, portal.ts)
// now calls this the same way: only when the strict SQL-folded search
// finds literally zero rows for a non-empty query, against a bounded
// candidate list the caller has already narrowed by every *other* filter
// (branch/stock/category/etc, still via SQL) -- so the common case (a
// correctly- or near-correctly-typed search) never pays this cost, and a
// worst-case miss only ever fuzzy-matches a bounded slice of the catalog,
// never the whole table.
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

// --- barcode identity: GTIN-14 / EAN-13 leading-zero folding ------------
//
// Mirror of the block at the end of cloudflare/src/lib/searchMatch.ts --
// read that copy for the full reasoning (a production catalog that stores
// ~3000 barcodes twice: once as a 14-character GTIN-14 with a leading zero,
// once as the bare EAN-13 a scanner emits). Kept byte-for-byte equivalent
// so a client-side re-filter can never drop a row the server matched, or
// keep one the server would not.
//
// The rule: compare the leading-zero-stripped form of both sides; ignore
// spaces and hyphens; a code shorter than MIN_REAL_BARCODE_LENGTH or made
// only of zeros is NOT a real barcode (238 production rows share the
// literal placeholder "0").
export const MIN_REAL_BARCODE_LENGTH = 4

export function normalizeBarcodeKey(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '')
  if (raw.length < MIN_REAL_BARCODE_LENGTH) return ''
  const stripped = raw.replace(/^0+/, '')
  return stripped
}

export function barcodeKeysMatch(left: unknown, right: unknown): boolean {
  const key = normalizeBarcodeKey(left)
  return key !== '' && key === normalizeBarcodeKey(right)
}

// The barcode key a typed/scanned search-box value stands for, or '' when
// the text isn't a lone code (a multi-word query stays a normal search).
export function searchTermBarcodeKey(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text || /[\s,]/.test(text)) return ''
  return normalizeBarcodeKey(text)
}

// Client-side counterpart of the server's exact-barcode-first ordering: a
// row whose barcode IS the scanned code sorts ahead of rows that merely
// contain the digits somewhere. Never used to auto-select -- every picker
// in this app requires the operator to click the row (scan fills the search
// box, the list narrows, the person chooses).
export function sortExactBarcodeFirst<T extends { barcode?: unknown }>(rows: readonly T[], rawQuery: unknown): T[] {
  const key = searchTermBarcodeKey(rawQuery)
  if (!key) return rows.slice()
  return rows
    .map((row, index) => ({ row, index, exact: normalizeBarcodeKey(row?.barcode) === key ? 0 : 1 }))
    .sort((a, b) => (a.exact - b.exact) || (a.index - b.index))
    .map((entry) => entry.row)
}
