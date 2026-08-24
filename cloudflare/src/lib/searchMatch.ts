// searchMatch.ts (Worker/backend copy)
//
// Server-side counterpart of frontend/src/utils/searchMatch.ts -- same
// normalization behavior (joiner variants, conjoined vs. split words,
// diacritics, brand-shorthand aliases), duplicated here rather than
// imported because the frontend and the Cloudflare Worker are two
// separate TypeScript projects/bundlers with no shared package between
// them today. If a real shared package is ever set up, these two files
// should be collapsed into one.
//
// Product catalog search in the ADMIN app (routes/products.ts,
// inventory.ts's product filters -- and POS, which calls the same
// products.ts route, not a separate path) runs through the `products_fts`
// FTS5 virtual table (migrations/0018_products_fts.sql) via
// buildFtsMatchExpression below, plus `products_fts_code`
// (migrations/0019_products_fts_code.sql, tokenize='trigram') via
// buildTrigramMatchExpression for barcode/sku substring matching that
// plain prefix matching can't do -- see that function's own comment for
// why both tables exist. See those migrations' own comments for why FTS5:
// SQLite's inverted index makes a MATCH query proportional to the number
// of matching tokens instead of a full table scan, and FTS5's
// `unicode61 remove_diacritics 2` tokenizer folds accents and treats
// joiner punctuation as token boundaries on its own, so this file no
// longer needs to hand-roll that folding in SQL for those two routes.
// tokenizeSearchWords/tokenizeSearchTermGroups/expandAliasCandidates
// (JS-side normalization of the *typed query*, not the stored column) are
// still used to build both MATCH expressions.
//
// routes/portal.ts (the public storefront) is NOT on products_fts --
// confirmed by reading the route, not assumed; an earlier version of this
// comment claimed otherwise and was wrong. It's a deliberate, narrower
// design (scoped to name/brand/category only -- the storefront was never
// meant to expose sku/barcode/supplier/description/unit search, so the
// barcode-substring problem buildTrigramMatchExpression fixes doesn't
// apply there), still using foldDiacriticsSql/foldJoinersSql/
// normalizedHaystackSql below for its per-row REPLACE()-chain LIKE
// comparison. That's a real, separate opportunity (same full-table-scan
// cost profile 0018's own comment describes) if the public search path
// ever needs the same performance work -- not done here, flagged in
// progress.md rather than silently left as-is. Those three helpers are
// also still used by inventory.ts's movement-log search (a much smaller,
// less latency-sensitive table with no catalog-scale concerns). The old
// JS Levenshtein-based typo-tolerant fallback (fuzzyTextMatches/
// matchesSearchTermGroups' word-fuzzy-match path, runFuzzyFallbackMatch)
// is no longer called from products.ts/inventory.ts -- it was an
// expensive full-candidate-fetch-plus-JS-loop pass that only ever fired
// on a zero-result strict search, and FTS5 prefix+trigram matching
// already handles the overwhelming majority of real partial-typing/
// reordering/barcode-fragment cases far more cheaply. portal.ts still
// calls runFuzzyFallbackMatch (it isn't on FTS5). matchesSearchTermGroups/
// fuzzyTextMatches are also kept for genuine in-memory re-filtering of an
// already-fetched page (no DB cost either way) -- see Inventory.tsx/
// POS.tsx on the frontend.
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
// product names, e.g. a product literally named with Khmer script for
// "tray"/"serum") normalized to an EMPTY string, which meant the search box
// could never find that word at all even though the row itself plainly
// contains it. Confirmed the FTS5 index has no trouble matching Khmer text
// (unicode61's tokenizer already treats it as ordinary word characters);
// the bug was entirely this JS-side stripping of the *typed query* before
// it ever reached tokenizeSearchWords/buildFtsMatchExpression/
// buildHybridMatchClause/buildLikeAliasClause -- every one of those callers
// was silently searching for "" against a non-empty Khmer query. Same bug,
// same fix, in this file's frontend counterpart
// (frontend/src/utils/searchMatch.ts). `\p{L}` (Unicode "Letter", every
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
  // use a capital letter-O and digit-0 near-interchangeably -- staff and
  // customers type whichever one the packaging looks like it has. Fold
  // letter-O to digit-0 within any token that ALSO contains a real digit,
  // so both spellings normalize to the same canonical form and compare
  // equal everywhere normalizeSearchText's output is used (this function
  // runs on both the typed query and the stored/haystack text, so a single
  // one-directional fold here is enough for both directions to match --
  // no separate "which one did they type" tracking needed). Deliberately
  // scoped to digit-bearing tokens only: a pure-letter word like
  // "Concealer" must never become "c0ncealer" just because it contains the
  // letter O. swapCodeLookalikeChar below does the same fold as a
  // standalone, bidirectional helper for callers that need it (e.g. SQL/
  // FTS-facing alias expansion, which can't just re-run this function on
  // already-indexed text).
  return base
    .split(' ')
    .map((word) => (/[0-9]/.test(word) ? word.replace(/o/g, '0') : word))
    .join(' ')
}

// Standalone version of the O-to-0 shade-code fold normalizeSearchText
// applies internally, exposed for callers that need to generate the OTHER
// spelling of an already-normalized, already-lowercased word (e.g. to add
// both "o8y" and "08y" as alias candidates for a SQL/FTS query, where the
// indexed text was never round-tripped through normalizeSearchText).
// Returns null when there's nothing to swap: no digit at all (never widen
// a plain word into looking like a code), or a digit present but neither
// lookalike character in it (e.g. "12y" has a digit but no o/0 to swap).
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

// Splits a raw search-box value into comma-separated GROUPS, each itself a
// list of words (via tokenizeSearchWords). Comma is the ONLY group
// separator; a space inside a group is ordinary word-spacing, not a
// boundary between groups -- this is what makes the AND/OR toggle mean
// "match every group" vs "match any group", not "match every word" vs
// "match any word". Was previously conflated: routes/products.ts,
// inventory.ts, and the client-side searchMatch.ts fallback used to split
// commas the same as any other punctuation (normalizeSearchText strips
// non-alphanumeric characters, including commas, down to plain spaces),
// so "mac lipstick, essence tint" and "mac lipstick essence tint" produced
// the exact same flat 4-word list server-side, and toggling AND/OR just
// changed "all 4 words somewhere" vs "any 1 word anywhere" instead of
// "both phrases" vs "either phrase" -- silently different from what the
// frontend's own buildProductSearchTerms/matchesSearchTermGroups (utils/
// searchTerms.ts, utils/searchMatch.ts) already did for client-side
// re-filtering, and different from what a comma-separated search box
// implies. This is the shared building block both the SQL WHERE-builder
// (routes/products.ts, inventory.ts) and the JS fuzzy fallback now use so
// the two stay in agreement.
export function tokenizeSearchTermGroups(raw: unknown, maxGroups = 6, maxWordsPerGroup = 8): string[][] {
  const rawStr = String(raw ?? '')
  const groups: string[][] = []
  for (const part of rawStr.split(',')) {
    const words = tokenizeSearchWords(part, maxWordsPerGroup)
    if (words.length) groups.push(words)
  }
  return groups.slice(0, maxGroups)
}

// Every alias form (including the word itself) for a single normalized
// search word -- exported so callers can generate one LIKE per alias.
export function expandAliasCandidates(compactWord: string): string[] {
  return aliasCandidates(compactWord)
}

// FTS5-specific counterpart of expandAliasCandidates -- returns each
// candidate as its OWN word array instead of one compact/joined string.
// Real, confirmed bug this fixes (found while adding routes/portal.ts's
// column-SET FTS5 filter and its own new alias-resolution test -- not
// something that test introduced, a latent gap in buildFtsMatchExpression/
// buildHybridMatchClause that predates it and was never caught because
// this codebase's own products-FTS test never actually exercised alias
// resolution): ALIAS_GROUPS' multi-word target forms (e.g. 'realtechniques'
// for "Real Techniques", 'bhcosmetics' for "BH Cosmetics") are compact,
// joined strings -- correct for the JS-side compact-string `.includes()`
// matching aliasCandidates/queryWordMatchesHaystack do, but FTS5's
// unicode61 tokenizer splits "Real Techniques" into TWO separate tokens
// ("real", "techniques"), and a prefix query for the single 14-character
// token "realtechniques*" can never match either of those two shorter
// tokens -- confirmed against real FTS5 (better-sqlite3): searching "rt"
// against a brand of "Real Techniques" silently returned zero rows via
// buildFtsMatchExpression, even though the exact same alias already
// worked correctly via the JS/compact-string path (client-side re-filter,
// and portal.ts before this session's FTS5 move). The old per-row LIKE
// implementations buildFtsMatchExpression/buildHybridMatchClause replaced
// never had this problem because LIKE '%realtechniques%' is a true
// substring match, unaffected by token boundaries in the stored text.
// Fix: ALIAS_GROUPS now stores each form as { compact, words } --
// `expandAliasCandidates` (JS-facing, LIKE-facing) keeps returning the
// existing flat compact-string list (no behavior change there, no caller
// of that path was broken), while this function returns the same
// candidates as word arrays so an FTS caller can AND together one prefix
// term per word ("real* AND techniques*") instead of one
// never-matching compact prefix ("realtechniques*").
export function expandAliasCandidatesForFts(compactWord: string): string[][] {
  return aliasForms(compactWord).map((form) => form.words)
}

// Curated abbreviation/shorthand pairs that aren't spelling variants (so
// neither substring nor edit-distance matching would ever connect them) --
// just an alias a shopper or staff member commonly types instead of the
// full brand name. Extend this list as real-world misses come in; each
// entry is a group of forms that should all be treated as referring to the
// same thing. `words` is that form's actual word breakdown (used by the
// FTS path above); `compact` (words.join('')) is what the JS/LIKE paths
// key off of and must stay exactly the space-free join of `words` -- kept
// as an explicit field rather than derived inline so ALIAS_LOOKUP below
// doesn't need to recompute it per lookup.
interface AliasForm { compact: string; words: string[] }
function form(words: string[]): AliasForm {
  return { compact: words.join(''), words }
}
const ALIAS_GROUPS: AliasForm[][] = [
  [form(['rt']), form(['real', 'techniques'])],
  [form(['nyx']), form(['nyx', 'professional', 'makeup'])],
  [form(['bh']), form(['bh', 'cosmetics'])],
  [form(['ofra']), form(['ofra', 'cosmetics'])],
]

const ALIAS_LOOKUP: Map<string, AliasForm[]> = (() => {
  const map = new Map<string, AliasForm[]>()
  for (const group of ALIAS_GROUPS) {
    for (const entry of group) map.set(entry.compact, group)
  }
  return map
})()

function aliasForms(compactToken: string): AliasForm[] {
  return ALIAS_LOOKUP.get(compactToken) || [form([compactToken])]
}

function aliasCandidates(compactToken: string): string[] {
  return aliasForms(compactToken).map((f) => f.compact)
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
//
// `alreadyNormalized` (default false): pass true when `expr` already
// references a column that was normalized ONCE at write time (see
// products.ts/importEngine.ts's PRODUCT_SEARCH_COMPACT_COLUMNS write-path
// hooks, using this file's own normalizeSearchText/compactSearchText JS
// functions) instead of a raw column that still needs folding at query
// time. Real, confirmed production incident this exists to fix: for a
// short, common query (reported case: "ana", 3 letters, single word)
// products.ts's brand-compact fallback alone wraps a raw `p.brand`
// reference in the full DIACRITIC_SQL_PAIRS chain -- 70 nested REPLACE()
// calls, one level of expression-tree depth EACH -- plus 6 more from
// foldJoinersSql, ~78 levels before this clause is even combined with
// anything else. Once that's OR'd alongside the query's other search
// clauses and AND'd with the route's other active filters (the normal
// shape of a real Products/Inventory list request), the combined
// expression tree exceeded D1's own enforced depth-100 limit and the
// whole request failed with `D1_ERROR: Expression tree is too large
// (maximum depth 100): SQLITE_ERROR` -- confirmed by hand-counting the
// nesting produced for exactly this brand-compact call site, the only
// clause in the whole request that runs the REPLACE chain for a 3-letter
// single-word query (ftsMatch/trigramMatch are plain FTS5 MATCH strings,
// no REPLACE nesting at all). Folding name/brand/unit ONCE at write time
// into stored *_normalized/*_compact columns (migrations/0037_product_
// search_compact_columns.sql) and reading that column directly at query
// time (alreadyNormalized=true skips the REPLACE chain entirely, just
// `lower(COALESCE(expr,''))`) removes those ~78 levels from every search
// request instead of trying to trim the DIACRITIC_SQL_PAIRS list (which
// would silently reintroduce the "creme"/"crème" class of bug this file's
// own header already fixed once). Callers against columns with no
// precomputed counterpart (e.g. a correlated sales/returns EXISTS
// subquery column) keep passing alreadyNormalized=false unchanged --
// zero behavior change for every path that isn't the products name/brand/
// unit search columns.
export function normalizedHaystackSql(expr: string, alreadyNormalized = false): string {
  if (alreadyNormalized) return `lower(COALESCE(${expr}, ''))`
  return `lower(${foldJoinersSql(foldDiacriticsSql(expr))})`
}

// Same pipeline as normalizedHaystackSql, plus a final space-strip --
// the SQL-side counterpart of compactSearchText above. Needed for a real,
// confirmed gap normalizedHaystackSql alone can't close: a brand stored
// with internal separator punctuation between single letters (e.g.
// "e.l.f.", "N.Y.X.") folds those separators to spaces, not nothing --
// "e.l.f." becomes "e l f", a plain LIKE '%elf%' against THAT never
// matches (there are spaces between the letters). compactSearchText's own
// header comment already documents this exact class of problem for the
// JS-side compact path ("SK-II"/"Sk II"/"SKII", "BS Mall"/"BS-Mall"/
// "BSMall") -- this brings the SQL-facing side to the same behavior,
// rather than leaving SQL-side brand matching one step behind the
// client-side re-filter that already handles it correctly.
// `alreadyNormalized`: see normalizedHaystackSql's own comment above --
// same meaning, same expression-tree-depth motivation. When true, `expr`
// is expected to already be a stored *_compact column (no spaces, already
// folded/lowercased), so this just wraps it defensively -- no REPLACE
// chain, no extra space-strip (already stripped at write time).
export function compactHaystackSql(expr: string, alreadyNormalized = false): string {
  if (alreadyNormalized) return `lower(COALESCE(${expr}, ''))`
  return `REPLACE(${normalizedHaystackSql(expr)}, ' ', '')`
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

// --- FTS5 query building (products_fts) ---------------------------------
//
// Builds an FTS5 MATCH expression from the same comma-grouped word lists
// tokenizeSearchTermGroups produces. Every word becomes a prefix term
// (`word*`) so partial typing matches immediately without waiting for a
// full word (FTS5's own tokenizer already handles typed-with-or-without-
// joiners and typed-with-or-without-diacritics on both sides, since the
// stored column went through the same tokenizer when it was indexed).
// Within a group every word is required (AND); the AND/OR toggle governs
// how groups combine, matching tokenizeSearchTermGroups' own contract.
// `column`, when given, scopes every term to a subset of products_fts's
// columns via FTS5's own column-filter syntax: a single string uses
// `col:term` (the existing titleOnly=name-only search option); an array
// of column names uses FTS5's `{col1 col2 ...}:term` column-SET filter
// instead -- confirmed against real FTS5 (better-sqlite3) that this
// correctly restricts a MATCH to just that set of columns, including for
// AND-of-two-words groups and OR-of-groups, and that bm25() ranking still
// works normally on a column-filtered MATCH. Added for routes/portal.ts's
// public storefront search, which is deliberately scoped to
// name/brand/category only (never sku/barcode/supplier/description/unit)
// -- see that route's own comment for why. Confirming this syntax exists
// and behaves correctly is what made moving portal.ts off its old
// per-row REPLACE()-chain LIKE full-table-scan onto the same FTS5 index
// products.ts/inventory.ts already use possible without a new virtual
// table or migration.
//
// Words are already alphanumeric-only by the time they reach here
// (tokenizeSearchWords strips everything else), so no quoting/escaping
// is needed to keep them out of FTS5's own query-syntax characters.
export function buildFtsMatchExpression(groups: readonly string[][], mode: 'AND' | 'OR' | string = 'AND', column?: string | readonly string[]): string | undefined {
  if (!groups.length) return undefined
  const colPrefix = Array.isArray(column) ? `{${column.join(' ')}}:` : (column ? `${column}:` : '')
  const groupExprs = groups.map((words) => {
    const wordExprs = words.map((word) => {
      // Each alias candidate is its own word array now (see
      // expandAliasCandidatesForFts's own comment for why a multi-word
      // alias target can't be one compact prefix term) -- AND the
      // per-word prefixes together within a candidate, OR across
      // candidates, same precedence the old flat version had.
      const candidateForms = expandAliasCandidatesForFts(word)
      const candidateExprs = candidateForms.map((formWords) => {
        const prefixed = formWords.map((w) => `${w}*`)
        return prefixed.length > 1 ? `(${prefixed.join(' AND ')})` : prefixed[0]
      })
      const combined = candidateExprs.length > 1 ? `(${candidateExprs.join(' OR ')})` : candidateExprs[0]
      return colPrefix ? `${colPrefix}${combined}` : combined
    })
    return wordExprs.length > 1 ? `(${wordExprs.join(' AND ')})` : wordExprs[0]
  })
  if (groupExprs.length === 1) return groupExprs[0]
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupExprs.map((expr) => `(${expr})`).join(joiner)
}

// Column order MUST match products_fts's declared column order
// (migrations/0018_products_fts.sql): name, sku, barcode, brand,
// category, supplier, description, unit. Weights mirror the old
// hand-written CASE-based match-rank priority (barcode/sku ranks above a
// free-text name match, which ranks above brand/category, which ranks
// above supplier/description/unit) by giving those columns more weight
// in FTS5's built-in bm25() relevance function -- a match in a
// higher-weighted column pulls the row's score more negative (bm25 is
// "more negative = more relevant"), so ORDER BY this ASC surfaces it
// first, same intent as the old CASE ladder with none of its own
// per-row SQL.
export const PRODUCTS_FTS_BM25_SQL = 'bm25(products_fts, 10, 10, 10, 4, 3, 1, 1, 1)'

// Column subset the typed free-text product search box (Products.tsx,
// POS.tsx, Inventory.tsx's products tab, and the public portal storefront)
// actually scopes its MATCH to, replacing the previous unscoped call (which
// searched all 8 products_fts columns, including supplier/description/unit)
// for the everyday "type a product name/code" case those four surfaces all
// share. Real, reported gap this closes: supplier is an internal vendor
// name a shopper/cashier never types looking for a PRODUCT, and a long
// free-text description field can contain almost any word, so both were
// silently widening result sets with matches nobody typing into a product
// search box was looking for -- exactly the "search bar doesn't need
// supplier, description, unit" scope progress.md's Part 106 item asked for,
// and a smaller MATCH column set is also strictly cheaper for FTS5 to
// evaluate (fewer postings lists to intersect per query), which matters on
// a CPU-metered Cloudflare Workers free-tier plan under concurrent
// multi-user load.
//
// 'unit' is the one column deliberately KEPT in scope, not dropped along
// with supplier/description -- traced a real, live dependency before
// removing it: Products.tsx's handleLookupReviewSelection sets the visible
// search box text to a unit's name when someone reviews "which products
// use this unit" from ManageUnitsModal (no dedicated unit-filter chip/
// state exists the way brandFilter/catFilter do for brand and category),
// so a unit-scoped MATCH is exactly what that already-shipped feature
// needs to keep working. Silently dropping 'unit' here would have broken
// that workflow with no error, just an always-empty result page -- flagged
// in progress.md as a real follow-up (give unit review its own exact-match
// filter param instead of piggybacking on free-text search, the same way
// brand/category already have one) rather than guessed at and shipped with
// a regression.
//
// barcode/sku are NOT dropped -- explicitly named by the person as the
// second-most-used search dimension after name, and already carry their
// own trigram substring fallback (products_fts_code) for exactly this
// scope, unaffected by this column list (that table only ever indexes
// barcode+sku regardless of this constant).
export const PRODUCT_SEARCH_COLUMNS = ['name', 'sku', 'barcode', 'brand', 'category', 'unit'] as const

// --- barcode/SKU substring fallback (products_fts_code, trigram) --------
//
// Real bug, confirmed against actual SQLite (better-sqlite3, which bundles
// the same FTS5 build D1 runs on): products_fts above uses a PREFIX-only
// match (`word*`) via the unicode61 tokenizer. Prefix matching only ever
// matches from the START of a token. A barcode like "6923644012345" is one
// single token (no spaces/punctuation for unicode61 to split on), so typing
// "012" -- which appears in the MIDDLE of that token -- never matches, even
// though a person scanning/typing a fragment of a barcode expects substring
// matching, not prefix-only. (A word deep inside a multi-word field, e.g.
// "617" in "MAC Matte Lipstick 617 Rebel", is NOT affected -- that's its
// own separate token and prefix-matches fine. Confirmed both ways with a
// real FTS5 query before writing this comment, not assumed.)
//
// This is exactly the reported case ("typing 012 matching name+barcode+
// brand" not resolving) -- but only for the barcode/sku half of it; the
// name/brand half already worked. Fix: a second, SEPARATE FTS5 virtual
// table over just (barcode, sku) using tokenize='trigram' instead of
// unicode61. Trigram indexes every overlapping 3-character sequence, so a
// plain (non-prefixed) MATCH against it is a true substring search --
// confirmed "012" now finds "6923644012345" via this table. Scoped to just
// barcode+sku (not all 8 columns) because trigram indexes are only worth
// the extra storage/write cost where substring search actually matters --
// free-text fields like name/description are already well served by
// word-prefix matching and don't need character-level indexing.
// See migrations/0019_products_fts_code.sql for the table + sync triggers,
// mirroring 0018_products_fts.sql's own pattern exactly.
//
// Known, deliberate limitation: this table's MATCH is combined with the
// main products_fts MATCH via SQL OR (see routes/products.ts,
// inventory.ts), not merged word-by-word. That correctly fixes the
// reported case -- a single barcode-fragment term, or any one comma-
// separated group that's entirely a barcode/sku fragment -- because OR
// only ever ADDS matches, never hides ones the primary path already found.
// It does NOT (yet) handle a single group that mixes a name word with a
// barcode fragment word where each half can only be satisfied by a
// different one of the two tables (e.g. one comma-group containing both
// "mac" and "012" as separate words, where "mac" only matches via
// products_fts and "012" only matches via products_fts_code) -- AND'ing
// across two independent FTS5 tables inside one group needs a per-word
// EXISTS-based rewrite of buildSearchFilters, not attempted here. Flagged
// in progress.md rather than silently left incomplete.
//
// Trigram tokens require 3+ characters -- a 1-2 character word can never
// match via this table (SQLite generates no trigrams for it at all; a
// short-enough MATCH query is simply guaranteed zero rows, not an error --
// confirmed). buildTrigramMatchExpression drops any group containing a
// word shorter than 3 characters entirely (the whole group, not just the
// short word) rather than silently changing that group's AND semantics by
// only checking its other words.
export function buildTrigramMatchExpression(groups: readonly string[][], mode: 'AND' | 'OR' | string = 'AND'): string | undefined {
  const eligibleGroups = groups.filter((words) => words.length > 0 && words.every((word) => word.length >= 3))
  if (!eligibleGroups.length) return undefined
  const groupExprs = eligibleGroups.map((words) => (words.length > 1 ? `(${words.join(' AND ')})` : words[0]))
  if (groupExprs.length === 1) return groupExprs[0]
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupExprs.map((expr) => `(${expr})`).join(joiner)
}

// --- mixed name+barcode group fallback (per-word hybrid) -----------------
//
// Closes the "known, deliberate limitation" buildTrigramMatchExpression's
// own comment above flags: buildFtsMatchExpression and
// buildTrigramMatchExpression each build ONE complete match expression
// against ONE table, covering every word in every group. That correctly
// handles a group that's entirely free-text (all words satisfied via
// products_fts) or entirely a barcode/sku fragment (all words satisfied
// via products_fts_code) -- routes/products.ts and inventory.ts OR those
// two whole-query expressions together, and OR only ever ADDS matches. But
// neither expression alone can satisfy a single AND-group that MIXES a
// free-text word with a barcode-fragment word (e.g. ["mac","012"], where
// "mac" is a real brand/name prefix match in products_fts but not a
// literal prefix of anything in the FTS5 sense, and "012" is a substring
// of a barcode -- 6923644012345 -- but not a real word in any free-text
// column): products_fts's own "mac* AND 012*" AND-of-both-words-in-the-
// SAME-table requires "012" to be some column's token PREFIX, which it
// isn't (confirmed against real FTS5 in scripts/test-search-fts-pure.cjs);
// products_fts_code's own AND likewise requires "mac" to be a trigram
// substring of that row's barcode/sku, which it isn't either. Both
// whole-table expressions correctly evaluate to "no match" for that row on
// that group, and OR-ing two "no match"es is still "no match" -- not a
// bug in either function, just a gap neither can close alone.
//
// Fix: build each word's two candidate expressions (FTS prefix, trigram
// substring) SEPARATELY instead of merging them into one table-wide
// expression, so the caller can AND "(word matches via fts OR word
// matches via trigram)" per word -- letting one word in a group resolve
// via products_fts while a different word in the SAME group resolves via
// products_fts_code, which the two whole-table functions above can't
// express on their own. Returns undefined for any group of 1 word (already
// fully covered by the OR of buildFtsMatchExpression/
// buildTrigramMatchExpression's own top-level results -- so this
// intentionally skips the by-far-most-common single-word search
// case rather than duplicating that already-correct, cheaper path with an
// extra per-word subquery).
//
// Unlike the two functions above (which return a bare MATCH operand
// string the caller embeds directly), this returns SQL text with embedded
// `p.id IN (SELECT rowid FROM ... MATCH @param)` subqueries plus the bound
// params for them -- assembling that needs one uniquely-named parameter
// per word, which only the caller (owner of the query's shared `params`
// object) can allocate without colliding with @ftsQuery/@codeQuery or
// across repeated calls; `paramPrefix` keeps multiple call sites (or, in
// principle, multiple calls within one route) from colliding with each
// other.
export interface HybridMatchResult {
  sql: string
  params: Record<string, string>
}

export function buildHybridMatchClause(
  groups: readonly string[][],
  mode: 'AND' | 'OR' | string,
  paramPrefix: string,
  column?: string | readonly string[],
): HybridMatchResult | undefined {
  if (!groups.some((words) => words.length > 1)) return undefined
  const colPrefix = Array.isArray(column) ? `{${column.join(' ')}}:` : (column ? `${column}:` : '')
  const params: Record<string, string> = {}
  const groupExprs = groups.map((words, groupIndex) => {
    const wordExprs = words.map((word, wordIndex) => {
      const candidateForms = expandAliasCandidatesForFts(word)
      const ftsParam = `${paramPrefix}_${groupIndex}_${wordIndex}_fts`
      // Same per-word-AND-per-candidate-OR shape as buildFtsMatchExpression
      // now uses, just assembled as a MATCH query string here instead of
      // a bare expression (this function embeds it inside an IN-subquery
      // param, not the caller's own top-level MATCH). `column`, when
      // given, applies the same FTS5 column-SET filter
      // buildFtsMatchExpression's own `column` param does, and the same
      // way: every OR'd candidate is parenthesized into ONE combined
      // expression first, then colPrefix is prepended ONCE to that whole
      // parenthesized group (confirmed against real FTS5 that
      // `{col1 col2}:(a* OR b*)` scopes every disjunct inside the
      // parens, not just the first) -- added so a caller that scopes its
      // primary MATCH to a column subset (e.g. products.ts/inventory.ts's
      // PRODUCT_SEARCH_COLUMNS below) doesn't leave this hybrid fallback
      // able to match a column the primary path can't, which would make
      // the two paths silently disagree about what's searchable for a
      // mixed-word group.
      const candidateExprs = candidateForms
        .map((formWords) => (formWords.length > 1 ? `(${formWords.map((w) => `${w}*`).join(' AND ')})` : `${formWords[0]}*`))
      const combinedFts = candidateExprs.length > 1 ? `(${candidateExprs.join(' OR ')})` : candidateExprs[0]
      params[ftsParam] = colPrefix ? `${colPrefix}${combinedFts}` : combinedFts
      const ftsClause = `p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @${ftsParam})`
      // Third branch alongside the FTS/trigram pair above: a compact
      // (space-stripped) substring check against brand alone, same
      // mechanism buildCompactBrandMatchClause below uses standalone for
      // the single-word case. Needed here too for a MIXED group (e.g.
      // ["elf","blush"], brand word + free-text word) -- neither the FTS
      // branch (single-letter-token brands like "e.l.f." can't be
      // prefix-matched, see compactHaystackSql's own comment) nor the
      // trigram branch (barcode/sku only) can resolve the brand word on
      // their own, and this function's whole purpose is letting each word
      // in a group resolve via whichever branch actually works for it.
      const brandClause = word.length >= 2
        ? buildCompactColumnMatchClause(word, 'p.brand_compact', params, `${paramPrefix}_${groupIndex}_${wordIndex}_brand`, true)
        : undefined
      if (word.length < 3) return brandClause ? `(${ftsClause} OR ${brandClause})` : `(${ftsClause})`
      const triParam = `${paramPrefix}_${groupIndex}_${wordIndex}_tri`
      params[triParam] = word
      const triClause = `p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @${triParam})`
      return brandClause ? `(${ftsClause} OR ${triClause} OR ${brandClause})` : `(${ftsClause} OR ${triClause})`
    })
    return wordExprs.length > 1 ? `(${wordExprs.join(' AND ')})` : wordExprs[0]
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  const sql = groupExprs.length > 1 ? groupExprs.map((expr) => `(${expr})`).join(joiner) : groupExprs[0]
  return { sql: `(${sql})`, params }
}

// --- Alias-aware LIKE clause building (routes/sales.ts, routes/returns.ts) --
//
// Sales/returns search spans columns on the sale/return row itself PLUS a
// correlated EXISTS subquery into sale_items/return_items (joined to
// products for barcode/brand, since neither line-item table stores those
// directly) -- a shape buildFtsMatchExpression/buildHybridMatchClause
// above don't fit (both assume one FTS5 virtual table over one base
// table). Both tables are far smaller/lower-churn than the product
// catalog (see migrations/0018/0020's own comments on why FTS5 was worth
// it there), and sales/returns are financial records this app should
// change the write path of as little as possible -- so this deliberately
// stays on LIKE rather than adding a third FTS5 migration with
// cross-table sync triggers, just fixed to share the same comma-groups/
// alias-candidate building blocks the FTS5 paths use instead of the old
// flat space-split-only version, and to actually reach barcode/brand
// instead of stopping at product_name/sku. Flagged in progress.md as a
// real, deliberate scope boundary (not an oversight) -- if sales/returns
// search ever needs FTS5-grade speed at real transaction-history scale,
// that's a dedicated migration, not a LIKE tweak.
//
// buildLikeAliasClause below builds ONE word's clause against a set of
// column expressions all reachable from the SAME row context (a plain
// column list for the base table, or column expressions inside a
// correlated EXISTS subquery) -- callers combine multiple calls (one set
// of flat columns, one EXISTS subquery) via SQL OR per word, then AND
// words within a comma-group, then AND/OR groups per
// tokenizeSearchTermGroups' own contract -- the same three-level
// structure buildFtsMatchExpression uses, just assembled by hand in the
// calling route instead of one function, since the flat-vs-EXISTS split
// is specific to each route's own schema.
//
// Real bug this avoids reintroducing: a naive single-compact-string LIKE
// candidate (e.g. 'realtechniques' for the "RT" alias) can never match a
// column value like "Real Techniques" -- normalizedHaystackSql folds
// diacritics/joiners into spaces but does not strip spaces, so the
// column's normalized form keeps the space between "real" and
// "techniques" while a flat compact-string LIKE candidate has none. This
// is the exact same bug Part 108 found and fixed for the FTS5 path
// (buildFtsMatchExpression) via expandAliasCandidatesForFts's per-word
// arrays -- confirmed by hand-tracing (not assumed) that the pre-existing
// LIKE-based inventory.ts movement-log search (expandAliasCandidates,
// the flat-compact-string sibling of the Fts version) has this exact same
// latent gap for a typed short-form alias, just never caught because no
// test exercised it. This function applies the identical fix used for
// FTS5: each alias candidate is ANDed together word-by-word (each word
// checked with its own LIKE, allowed to match in any of the given
// columns), OR'd across candidate forms -- matching
// buildFtsMatchExpression's AND-within-candidate/OR-across-candidates
// precedence exactly.
// --- compact-brand substring fallback (products.ts, inventory.ts, portal.ts) --
//
// Real, confirmed gap (reproduced against real FTS5, not assumed): a brand
// stored with punctuation between single letters -- "e.l.f." is the
// reported case, "N.Y.X." would have the same problem if it were ever
// stored that way -- tokenizes via unicode61 into one token PER LETTER
// ("e", "l", "f"), because unicode61 treats '.' as a token boundary the
// same way it treats a space. A typed "elf" (no punctuation, one 3-letter
// word) can never prefix-match any of those tokens -- none of them are
// even 3 characters long -- so buildFtsMatchExpression returns a MATCH
// that finds zero rows for that brand, silently, with no error. Confirmed
// with a real seeded catalog (scripts/test-search-brand-compact-pure.cjs):
// searching "elf" today returns zero e.l.f.-branded products and, via the
// unrelated name-trigram substring path, incorrectly surfaces products
// with "Self"/"Shelf" in the name instead (a pre-existing trigram-
// substring characteristic this fix doesn't touch -- see that test file's
// own comment for why that's a separate, accepted tradeoff, not something
// this change makes worse).
//
// "e.l.f." typed WITH its own punctuation ("e.l.f.") already worked
// before this fix, by accident: tokenizeSearchWords splits it into three
// 1-character words, each under buildShortWordFallbackClause's existing
// <3-char gate -- but that gate only scopes to p.name/p.unit, not brand,
// so it only found e.l.f. products whose NAME happened to also contain
// single e/l/f letters, not reliably via brand at all. Typing the brand
// naturally, without its internal dots ("elf"/"ELF"/"E.l.f"), is by far
// the more common real case and had no working path whatsoever.
//
// Fix: compare a COMPACT (diacritic-folded, joiner-folded, space-
// stripped) form of the typed word against the same compact form of the
// brand column via a plain substring LIKE -- this is exactly what
// compactSearchText/the client-side compact-matching path already do
// (frontend/src/utils/searchMatch.ts's queryWordMatchesHaystack), just
// brought to the server's own SQL search so admin Products/POS/Inventory
// search doesn't lag one step behind the client re-filter. Scoped
// deliberately to BRAND ONLY, not name/description: brand is a short,
// curated field (a handful of distinct values across the whole catalog),
// so a compact substring match against it is precise -- the same
// substring check against a long free-text name/description field is
// what produces the "Self"/"Shelf" false-positive risk noted above, and
// this fix doesn't extend that risk anywhere it doesn't already exist.
// Bounded via the same LIMIT pattern buildShortWordFallbackClause already
// established (SQLite can stop scanning brand once it has enough
// candidate ids, so a catalog-wide compact-brand scan stays cheap and
// bounded regardless of table size) -- see that function's own comment
// for the real D1 CPU-limit incident this pattern exists to prevent.
function buildCompactColumnMatchClause(
  word: string,
  columnExpr: string,
  params: Record<string, unknown>,
  paramKey: string,
  alreadyNormalized = false,
): string {
  params[paramKey] = `%${word}%`
  return `p.id IN (SELECT id FROM products p WHERE p.is_active = 1 AND ${compactHaystackSql(columnExpr, alreadyNormalized)} LIKE @${paramKey} LIMIT 200)`
}

// Standalone top-level clause for the common single-word case (buildHybrid
// MatchClause above only fires for 2+-word groups) -- every word in a
// group must independently appear as a compact substring of brand (AND
// within a group, same precedence every other clause in this file uses),
// OR'd across groups per tokenizeSearchTermGroups' own contract. Gated on
// word.length >= 2 -- a single letter against a compact brand field would
// still match nearly every brand and add cost for no real selectivity.
export function buildCompactBrandMatchClause(
  groups: readonly string[][],
  mode: 'AND' | 'OR' | string,
  params: Record<string, unknown>,
  paramKeyBase: string,
): string | undefined {
  let idx = 0
  const groupExprs = groups
    .map((words) => words.filter((word) => word.length >= 2))
    .filter((words) => words.length > 0)
    .map((words) => {
      const wordClauses = words.map((word) => buildCompactColumnMatchClause(word, 'p.brand_compact', params, `${paramKeyBase}_${idx++}`, true))
      return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
    })
  if (!groupExprs.length) return undefined
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupExprs.length > 1 ? groupExprs.map((expr) => `(${expr})`).join(joiner) : groupExprs[0]
}

// --- partial multi-word match fallback (long product names) -------------
//
// Reported gap: a long, verbose product name (this catalog has plenty --
// full ingredient-style names, multi-variant names with size/shade
// suffixes) is hard for a customer or cashier to type or remember exactly.
// Every match path above (FTS, trigram, hybrid, short-word, compact-brand)
// requires EVERY typed word to be found somewhere (AND within a group) --
// correct and cheap for the common 1-3-word search, but a single wrong or
// out-of-catalog word anywhere in a longer typed query (4+ words) makes
// the WHOLE group fail to match, even when most of the other words are
// exactly right and would have found the product on their own.
//
// Fix: for a group of 4+ words specifically, ALSO try requiring only a
// MAJORITY of the words to match (word.length-1, capped at 3 -- i.e. "2-3
// of the words," matching what was actually asked for) rather than every
// single one, scoped to name only (this is a long-NAME problem
// specifically, not brand/category/sku, which stay on the stricter exact
// paths above). Implemented as a per-row match COUNT via `SUM(CASE WHEN
// ... THEN 1 ELSE 0 END) >= threshold` -- one LIKE check per word (linear
// in word count), not the combinatorial "try every 2-or-3-word subset"
// alternative, which would blow up for an 8-word group (tokenizeSearch
// WordsPerGroup's own cap) and cost far more for the same result.
// Deliberately gated to 4+-word groups only -- a short, common 1-3-word
// search already works via the exact paths above and never needs to pay
// this extra scan; only a genuinely long typed query reaches this at all,
// which is the rare case, not the common one (see this file's own header
// on keeping the common case cheap). Bounded via the same LIMIT 200
// pattern as every other fallback above for the same reason.
export function buildPartialWordMatchClause(
  groups: readonly string[][],
  mode: 'AND' | 'OR' | string,
  columnExprs: readonly string[],
  params: Record<string, unknown>,
  paramKeyBase: string,
  minGroupWords = 4,
  alreadyNormalizedCols = false,
): string | undefined {
  const eligibleGroups = groups.filter((words) => words.length >= minGroupWords)
  if (!eligibleGroups.length) return undefined
  const normalizedCols = columnExprs.map((expr) => normalizedHaystackSql(expr, alreadyNormalizedCols))
  let idx = 0
  const groupExprs = eligibleGroups.map((words) => {
    const threshold = Math.min(3, words.length - 1)
    const hitTerms = words.map((word) => {
      const key = `${paramKeyBase}_${idx++}`
      params[key] = `%${word}%`
      const colOrs = normalizedCols.map((col) => `${col} LIKE @${key}`).join(' OR ')
      return `(CASE WHEN (${colOrs}) THEN 1 ELSE 0 END)`
    })
    return `p.id IN (SELECT id FROM products p WHERE p.is_active = 1 AND (${hitTerms.join(' + ')}) >= ${threshold} LIMIT 200)`
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  return groupExprs.length > 1 ? groupExprs.map((expr) => `(${expr})`).join(joiner) : groupExprs[0]
}

// --- short-word (<3 char) fallback for products (routes/products.ts,
// inventory.ts, portal.ts) ------------------------------------------------
//
// Real, confirmed gap the two trigram tables above (products_fts_code,
// products_fts_name_trigram) both share and can't fix on their own: FTS5's
// trigram tokenizer generates NO trigrams at all for a query shorter than 3
// characters -- confirmed against real FTS5 (better-sqlite3): a MATCH query
// of "ml" or "g" or a single shade-code letter against either trigram table
// is unconditionally zero rows, not a fluke of this catalog's data. That's
// SQLite's own documented trigram-tokenizer behavior, not something
// buildTrigramMatchExpression's existing `word.length >= 3` guard was ever
// wrong to apply -- dropping a too-short word from a trigram MATCH avoids a
// query SQLite would reject/never match anyway.
//
// Why this matters here specifically: this catalog's fused number+unit/
// shade-code naming convention (see products_fts_name_trigram's own
// migration comment) means the unit/shade-code PART, once a person types
// just that instead of the whole fused token, is *itself* commonly only
// 1-2 characters -- "ml", "g", or a single letter shade code. Confirmed at
// real catalog scale (~107,000-query harness against this project's own
// product data, scripts/harness/run_search.cjs): every single non-noise
// failure remaining after products_fts_name_trigram was added was exactly
// this case -- by far the largest remaining gap.
//
// Fix: a plain LIKE-based fallback (reusing buildLikeAliasClause per word,
// same alias-aware/diacritic-folded matching sales.ts/returns.ts already
// rely on) has no minimum-length restriction at all, so it correctly finds
// a 1-2 character word a trigram MATCH structurally cannot. Deliberately
// gated on "does ANY group contain a word under 3 characters" -- a normal
// all-3+-character query is already fully and more cheaply covered by the
// FTS5 prefix/trigram paths, so this LIKE scan (the same full-table-scan
// cost profile migrations/0018's own comment describes) never runs for the
// common case, only as a widen-net alternative OR'd alongside the
// already-correct FTS-based clauses. Scoped by the caller's own
// columnExprs (deliberately narrower than the full FTS column set for
// products/inventory -- see those routes' own call site comment for why
// sku/barcode/brand/category are excluded here specifically).
// Real, confirmed production incident (live `wrangler tail` output, not a
// theory): a single-character search (literally just "m") tripped
// "D1_ERROR: D1 DB exceeded its CPU time limit and was reset" -- and once
// D1 resets, EVERY other endpoint on the same worker (settings,
// notifications, unrelated pages) starts failing too until it recovers.
// Root cause: this function's LIKE scan is a function-wrapped,
// leading-wildcard `LIKE '%x%'` -- SQLite can't use any index for that, so
// it re-normalizes and compares every single row. That's an acceptable,
// bounded cost for a real narrow query (a 2-char shade code like "ml"
// genuinely matches a handful of rows), but a bare 1-character query
// against a 10,000+ row catalog matches a *huge*, near-unselective
// fraction of it (a large percentage of names contain any single given
// letter) -- so the "cheap-looking" LIKE scan feeds thousands of rows into
// the caller's already-expensive family-grouping/pagination query on top,
// which is what actually exhausts the CPU budget.
// Fix: cap the candidate set at the source with its own bounded, non-
// correlated subquery (`LIMIT 500`) instead of inlining the raw LIKE
// boolean directly into the outer WHERE. SQLite can stop scanning as soon
// as it finds 500 matches (no ORDER BY forcing a full pass), so this
// turns an unbounded worst-case scan into a bounded one. Zero behavior
// change for the legitimate case this fallback exists for (a real
// shade-code/unit fragment match has far fewer than 500 hits, so the
// LIMIT never actually engages) -- only changes the pathological
// "1-2 characters matches half the catalog" case, which is exactly the
// one that crashed D1.
export function buildShortWordFallbackClause(
  groups: readonly string[][],
  mode: 'AND' | 'OR' | string,
  columnExprs: readonly string[],
  params: Record<string, unknown>,
  paramKeyBase: string,
  alreadyNormalizedCols = false,
): string | undefined {
  if (!groups.some((words) => words.some((word) => word.length < 3))) return undefined
  let idx = 0
  const groupExprs = groups.map((words) => {
    const wordClauses = words.map((word) => buildLikeAliasClause(word, columnExprs, params, `${paramKeyBase}_${idx++}`, alreadyNormalizedCols))
    return wordClauses.length > 1 ? `(${wordClauses.join(' AND ')})` : wordClauses[0]
  })
  const joiner = mode === 'OR' ? ' OR ' : ' AND '
  const combined = groupExprs.length > 1 ? groupExprs.map((expr) => `(${expr})`).join(joiner) : groupExprs[0]
  // All current callers (products.ts/inventory.ts/portal.ts) pass
  // 'p.name'/'p.unit' -- always the products table under alias 'p'. The
  // subquery's own 'p' is a fresh, non-correlated scope (a plain lookup,
  // not referencing the outer row), so it can safely reuse the same alias
  // name the way the FTS/trigram IN-subqueries above it already do.
  return `p.id IN (SELECT id FROM products p WHERE p.is_active = 1 AND (${combined}) LIMIT 500)`
}

export function buildLikeAliasClause(
  word: string,
  columnExprs: readonly string[],
  params: Record<string, unknown>,
  paramKeyBase: string,
  alreadyNormalizedCols = false,
): string {
  const normalizedCols = columnExprs.map((expr) => normalizedHaystackSql(expr, alreadyNormalizedCols))
  const candidateForms = expandAliasCandidatesForFts(word)
  let idx = 0
  const candidateClauses = candidateForms.map((formWords) => {
    const perWordClauses = formWords.map((w) => {
      const key = `${paramKeyBase}_${idx++}`
      params[key] = `%${w}%`
      const colOrs = normalizedCols.map((col) => `${col} LIKE @${key}`)
      return colOrs.length > 1 ? `(${colOrs.join(' OR ')})` : colOrs[0]
    })
    return perWordClauses.length > 1 ? `(${perWordClauses.join(' AND ')})` : perWordClauses[0]
  })
  return candidateClauses.length > 1 ? `(${candidateClauses.join(' OR ')})` : candidateClauses[0]
}

// --- "Issues" quick filter (products.ts, inventory.ts) --------------------
//
// progress.md backlog item ("Searchable 'issues' filter on Products/
// Inventory"): a quick filter surfacing products in specific flagged
// states -- the user's own example was zero stock, with "and other
// flagged cases (etc)" left unspecified. Scoped here to a small,
// deliberately unambiguous set of real, objectively-checkable data-quality
// gaps -- states any admin would recognize as "this product needs
// attention" -- rather than guessing at a larger or fuzzier list. Each key
// below is independent (a product can trip more than one at once, e.g. no
// image AND no barcode), so the caller ORs together whichever the request
// asks for -- see buildIssueStateClauses below.
//
// Deliberately NOT included here (would need a real decision, not a
// guess): duplicate-SKU/barcode detection (a cross-row check, and this
// app already has a dedicated Merge Duplicates review flow for that --
// see MergeDuplicatesReviewModal.tsx -- so folding it into this per-row
// filter would create two competing ways to find the same thing);
// expiring/expired batches (belongs to the batch system, which already
// has its own expiry-alert surface, not the plain product list); negative
// stock (an integrity bug this app treats as a clamp-and-fix condition,
// not a browsable state -- see productWrites.ts's stock-clamp handling).
export const ISSUE_STATE_KEYS = ['out_of_stock', 'no_image', 'no_barcode', 'no_category', 'no_price'] as const
export type IssueStateKey = typeof ISSUE_STATE_KEYS[number]

function issueStateClause(key: string, stockExpr: string): string | undefined {
  switch (key) {
    case 'out_of_stock':
      return `${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`
    case 'no_image':
      return `(p.image_path IS NULL OR TRIM(p.image_path) = '')`
    case 'no_barcode':
      return `(p.barcode IS NULL OR TRIM(p.barcode) = '')`
    case 'no_category':
      return `(p.category IS NULL OR TRIM(p.category) = '')`
    // Both currencies checked -- a product priced only in KHR (or only in
    // USD) is priced, not missing a price. Only flagged when neither
    // currency has a positive value.
    case 'no_price':
      return `(COALESCE(p.selling_price_usd, 0) <= 0 AND COALESCE(p.selling_price_khr, 0) <= 0)`
    default:
      return undefined
  }
}

// Parses a comma-joined `issueState`/`issue_state` query value (unknown/
// unrecognized keys silently ignored, same tolerance as the multi-value
// brand/category filters above) and OR's together whichever of
// ISSUE_STATE_KEYS were requested -- "surface a product with ANY of the
// selected issues", the natural reading for a checklist-style filter.
// Returns undefined when nothing recognized was requested (no-op, matches
// every other optional filter in these two route files).
export function buildIssueStateClauses(rawValue: string, stockExpr: string): string | undefined {
  const keys = rawValue.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
  const clauses = keys.map((key) => issueStateClause(key, stockExpr)).filter((c): c is string => !!c)
  if (!clauses.length) return undefined
  return clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]
}
