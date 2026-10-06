// productSearchDocQuery.ts -- the server executor of the shared search core
// (G37 phase 2). Turns a typed product search into ONE FTS5 expression over
// products_search_fts (the stored products.search_doc, migration 0233).
//
// The matching contract is lib/searchCore.ts's (header there): every query
// unit must match, in any order, at one of these levels --
//   exact term, term prefix (2+ letters, or 1 while it is the word being
//   typed), joined-term prefix (3+ letters, or any length inside a short run
//   like "sk 2"), roman alias (ii -> 2), or fuzzy (4+ letters, same first
//   letter, repeated-letter skeleton within OSA distance 1 or 2).
// The browser walks an in-memory index for that; here the same levels become
// FTS alternatives per unit:
//
//   term*            exact + prefix terms        "pal"*
//   ~term*           joined-term prefix          "~skii"*     (stored behind '~')
//   roman            exact roman alias           "2"
//   typo variants    exact terms near the token  "palette" OR "pallette"
//   Khmer            quoted phrase of fragments  "សេរ៉ូម"*     (unicode61 splits
//                    Khmer at its marks on both sides; a phrase keeps the
//                    fragments adjacent, which is substring-like matching)
//
// Typo variants come from the term vocabulary (fts5vocab over the FTS table),
// read one first-letter range at a time and cached per isolate, so a search
// never builds a per-row edit-distance expression and never scans products.
// The whole FTS string is a bound parameter: it is not part of SQLite's
// expression tree, so the SQL depth is constant whatever the query length
// (D1 caps it at 100). Caps: 6 comma groups x 8 tokens, at most
// MAX_FUZZY_VARIANTS typo terms per token.
//
// Not handled here (prepareProductSearchDoc returns undefined and the caller
// keeps the legacy clause): titles-only searches (the document mixes name and
// brand terms), a ≥5-digit code fragment mixed with words, a checked UPC-A/E
// pair, too many missing documents, and any error reading the index.

import type { Env } from '../index'
import { getDb, type D1Compat } from './db'
import {
  SEARCH_DOC_JOIN_MARK,
  buildTermIndex,
  fuzzyBudget,
  isKhmerToken,
  osaDistance,
  queryUnits,
  romanCanonical,
  searchTermIndex,
  skeleton,
  type QueryUnit,
} from './searchCore'
import { loadMissingSearchDocRows, MISSING_DOC_ROW_CAP } from './productSearchDoc'
import { searchTermBarcodeKeys } from './searchMatch'

export const MAX_FUZZY_VARIANTS = 6

// ---------------------------------------------------------------- vocabulary

export interface VocabTypoTerm {
  term: string
  shape: string
  docs: number
}

// The terms of the index that start with one character.
export interface VocabBucket {
  // Plain terms, sorted.
  terms: string[]
  // Joined terms without their mark, sorted.
  joins: string[]
  // Typo candidates: letter-initial, 4+ characters, not Khmer.
  typos: VocabTypoTerm[]
}

// null = the vocabulary cannot be read; the rewrite then offers no typo
// variants and assumes a short run's joined form exists.
export type VocabSource = (initial: string) => Promise<VocabBucket | null>

export function vocabBucketFrom(plain: ReadonlyArray<{ term: string; doc: number }>, joined: ReadonlyArray<{ term: string; doc: number }>): VocabBucket {
  const byTerm = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  const terms = plain.map((row) => row.term).sort(byTerm)
  const joins = joined.map((row) => row.term.slice(SEARCH_DOC_JOIN_MARK.length)).sort(byTerm)
  const typos: VocabTypoTerm[] = []
  for (const row of plain) {
    if (row.term.length < 4 || !/^\p{L}/u.test(row.term) || isKhmerToken(row.term)) continue
    typos.push({ term: row.term, shape: skeleton(row.term), docs: Number(row.doc) || 0 })
  }
  typos.sort((a, b) => byTerm(a.term, b.term))
  return { terms, joins, typos }
}

function startsAt(sorted: readonly string[], prefix: string): boolean {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < prefix) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length && sorted[lo].startsWith(prefix)
}

const VOCAB_TTL_MS = 10 * 60 * 1000
const VOCAB_FAILURE_TTL_MS = 30 * 1000
const VOCAB_CACHE_LIMIT = 256
const vocabCache = new Map<string, { at: number; ttl: number; value: Promise<VocabBucket | null> }>()

export function resetProductSearchVocabCache(): void {
  vocabCache.clear()
}

function firstChar(value: string): string {
  return Array.from(value)[0] ?? ''
}

// One range read of fts5vocab per mark: a first-letter bucket is a few hundred
// terms, not the whole 4-6k term vocabulary.
async function readVocabBucket(db: D1Compat, initial: string): Promise<VocabBucket> {
  const next = String.fromCodePoint((initial.codePointAt(0) ?? 0) + 1)
  const range = 'SELECT term, doc FROM products_search_vocab WHERE term >= @lo AND term < @hi'
  const [plain, joined] = await db.batch([
    { sql: range, params: { lo: initial, hi: next } },
    { sql: range, params: { lo: SEARCH_DOC_JOIN_MARK + initial, hi: SEARCH_DOC_JOIN_MARK + next } },
  ])
  const rows = (result: unknown): Array<{ term: string; doc: number }> => ((result as { results?: unknown[] } | undefined)?.results ?? []) as Array<{ term: string; doc: number }>
  return vocabBucketFrom(rows(plain), rows(joined))
}

export function d1VocabSource(db: D1Compat): VocabSource {
  return (initial: string) => {
    const now = Date.now()
    const cached = vocabCache.get(initial)
    if (cached && now - cached.at < cached.ttl) return cached.value
    const entry: { at: number; ttl: number; value: Promise<VocabBucket | null> } = {
      at: now,
      ttl: VOCAB_TTL_MS,
      value: readVocabBucket(db, initial).catch(() => {
        entry.ttl = VOCAB_FAILURE_TTL_MS
        return null
      }),
    }
    if (vocabCache.size >= VOCAB_CACHE_LIMIT) vocabCache.clear()
    vocabCache.set(initial, entry)
    return entry.value
  }
}

// ---------------------------------------------------------------- rewrite

export interface SearchDocRewrite {
  // FTS5 expression, typo variants included.
  match: string
  // The same expression without typo variants; null when no variant was added.
  // A row in `match` but not in `strictMatch` matched only through a typo
  // variant (relevance tier 4).
  strictMatch: string | null
  // A lone 5+ digit token also looked up in the barcode/sku trigram table.
  codeDigits: string | null
}

const quote = (term: string): string => `"${term}"`
const group = (parts: readonly string[], op: 'AND' | 'OR'): string => (parts.length === 1 ? parts[0] : `(${parts.join(` ${op} `)})`)

interface TokenAlternatives {
  // Exact / prefix / joined / roman alternatives.
  strict: string[]
  // Typo variants, best first.
  fuzzy: string[]
  // Whether the token matches anything in the index at all (a short run
  // uses its joined form only when that form exists).
  exists: boolean
}

async function describeToken(vocab: VocabSource, token: string, last: boolean, run: boolean): Promise<TokenAlternatives> {
  // A prefix on the phrase's last fragment: a Khmer word typed so far ends
  // mid-fragment ("ពេលយ" while the product has "ពេលយប់").
  if (isKhmerToken(token)) return { strict: [`${quote(token)}*`], fuzzy: [], exists: true }
  const strict = [token.length >= 2 || last ? `${quote(token)}*` : quote(token)]
  const joinedAllowed = token.length >= 3 || run
  if (joinedAllowed) strict.push(`${quote(SEARCH_DOC_JOIN_MARK + token)}*`)
  const roman = romanCanonical(token)
  const romanAllowed = roman !== token && !last
  if (romanAllowed) strict.push(quote(roman))

  const bucket = await vocab(firstChar(token))
  if (!bucket) return { strict, fuzzy: [], exists: true }

  const shape = skeleton(token)
  const budget = token.length >= 4 && /^\p{L}+$/u.test(token) ? fuzzyBudget(shape.length) : 0
  const variants = budget > 0 ? typoVariants(bucket, token, shape, budget, last) : []
  const fuzzy = variants.slice(0, MAX_FUZZY_VARIANTS).map((variant) => variant.alternative)

  let exists = variants.length > 0
  if (!exists) exists = startsAt(bucket.terms, token)
  if (!exists && joinedAllowed) exists = startsAt(bucket.joins, token)
  if (!exists && romanAllowed) {
    const romanBucket = await vocab(firstChar(roman))
    exists = !romanBucket || startsAt(romanBucket.terms, roman)
  }
  return { strict, fuzzy, exists }
}

interface TypoVariant {
  alternative: string
  distance: number
  docs: number
}

// The terms a typed token reaches through the fuzzy level (same rule as the
// browser index): within OSA distance `budget` of the whole term, or, while it
// is the word being typed, of the term's first shape.length + 1 characters
// with the typed head held exact. Terms of the second kind that share those
// characters are ONE prefix alternative ("lipstic"* covers lipstick,
// lipstick01, lipstickpillow ...) instead of one term each, so the variant cap
// never drops a real match.
function typoVariants(bucket: VocabBucket, token: string, shape: string, budget: number, last: boolean): TypoVariant[] {
  const whole: TypoVariant[] = []
  const heads = new Map<string, { distance: number; docs: number; terms: Array<{ term: string; docs: number }> }>()
  for (const { term, shape: termShape, docs } of bucket.typos) {
    if (term === token || term.startsWith(token)) continue
    const distance = osaDistance(shape, termShape, budget)
    if (distance <= budget) { whole.push({ alternative: quote(term), distance, docs }); continue }
    if (!last || termShape.length <= shape.length + 1 || shape.slice(0, -1) !== termShape.slice(0, shape.length - 1)) continue
    const head = termShape.slice(0, shape.length + 1)
    const headDistance = osaDistance(shape, head, budget)
    if (headDistance > budget) continue
    const entry = heads.get(head) ?? { distance: headDistance, docs: 0, terms: [] }
    entry.docs += docs
    entry.terms.push({ term, docs })
    heads.set(head, entry)
  }
  const prefixes: string[] = []
  const variants: TypoVariant[] = []
  for (const [head, entry] of heads) {
    // A prefix reaches exactly these terms only when none of them repeats a
    // letter inside the head (the skeleton would differ from the text).
    if (entry.terms.every(({ term }) => term.startsWith(head))) {
      prefixes.push(head)
      variants.push({ alternative: `${quote(head)}*`, distance: entry.distance, docs: entry.docs })
    } else for (const { term, docs } of entry.terms) variants.push({ alternative: quote(term), distance: entry.distance, docs })
  }
  // A whole-term variant a prefix alternative already reaches is redundant.
  for (const entry of whole) {
    if (!prefixes.some((head) => entry.alternative.startsWith(`"${head}`))) variants.push(entry)
  }
  return variants.sort((a, b) => (a.distance - b.distance) || (b.docs - a.docs) || (a.alternative < b.alternative ? -1 : a.alternative > b.alternative ? 1 : 0))
}

interface UnitExpression {
  strict: string
  full: string
}

function alternativesOf(parts: TokenAlternatives[]): UnitExpression {
  const strict = parts.flatMap((part) => part.strict)
  const full = [...strict, ...parts.flatMap((part) => part.fuzzy)]
  return { strict: group(strict, 'OR'), full: group(full, 'OR') }
}

async function unitExpression(vocab: VocabSource, unit: QueryUnit): Promise<UnitExpression> {
  if (unit.parts.length === 1) return alternativesOf([await describeToken(vocab, unit.parts[0], unit.last, false)])
  const forms = await Promise.all(unit.joined.map((form) => describeToken(vocab, form, unit.last, true)))
  if (forms.some((form) => form.exists)) return alternativesOf(forms)
  // No joined form exists anywhere: the run's parts must each match.
  const parts = await Promise.all(unit.parts.map((part, index) => describeToken(vocab, part, unit.last && index === unit.parts.length - 1, false)))
  const each = parts.map((part) => alternativesOf([part]))
  return { strict: group(each.map((e) => e.strict), 'AND'), full: group(each.map((e) => e.full), 'AND') }
}

// null = this query is not the index path's to answer (see the file header).
export async function rewriteProductSearch(rawQuery: string, vocab: VocabSource, mode?: string): Promise<SearchDocRewrite | null> {
  const groups = queryUnits(rawQuery)
  if (!groups.length) return null
  // One typed character lists the names that start with it (the browser's
  // first-keystroke rule); an index prefix walk cannot say "starts the name".
  if (groups.length === 1 && groups[0].text.length === 1) return null
  let codeDigits: string | null = null
  for (const entry of groups) {
    for (const unit of entry.units) {
      if (unit.parts.length === 1 && /^[0-9]{5,}$/.test(unit.parts[0])) {
        if (groups.length > 1 || entry.units.length > 1) return null
        codeDigits = unit.parts[0]
      }
    }
  }
  const op = String(mode || '').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const groupExpressions: UnitExpression[] = []
  for (const entry of groups) {
    const units = await Promise.all(entry.units.map((unit) => unitExpression(vocab, unit)))
    groupExpressions.push({ strict: group(units.map((u) => u.strict), 'AND'), full: group(units.map((u) => u.full), 'AND') })
  }
  const match = group(groupExpressions.map((e) => e.full), op)
  const strict = group(groupExpressions.map((e) => e.strict), op)
  return { match, strictMatch: strict === match ? null : strict, codeDigits }
}

// ---------------------------------------------------------------- plan

export interface ProductSearchDocPlan extends SearchDocRewrite {
  // Active products whose document is missing and that the core matched in
  // code (loadMissingSearchDocRows); they join the match set by id.
  missingIds: number[]
  // The text carries a checked barcode-looking token, so the exact-barcode
  // clause (and its tier) is wanted next to the index match.
  barcodeLookup: boolean
}

export interface PrepareProductSearchDocOptions {
  mode?: string
  titleOnly?: boolean
  // The client already ranked ids for this request; no text matching at all.
  ranked?: boolean
}

// Whether a lone token can be a barcode/sku: one token that carries a digit.
// A plain word ("palette") never runs the exact-barcode clause, whose
// catch-all comparison reads every active product.
export function looksLikeBarcode(rawQuery: string): boolean {
  return searchTermBarcodeKeys(rawQuery).length > 0 && /\d/.test(rawQuery)
}

function hasUpcPair(rawQuery: string): boolean {
  return searchTermBarcodeKeys(rawQuery).some((key) => key.startsWith('upca:') || key.startsWith('upce:'))
}

// undefined = use the legacy search clause (the migration or backfill is not
// in place, the query shape is not the index path's, or the index failed).
export async function prepareProductSearchDoc(env: Env, rawQuery: string, options: PrepareProductSearchDocOptions = {}): Promise<ProductSearchDocPlan | undefined> {
  if (!rawQuery.trim() || options.titleOnly || options.ranked || hasUpcPair(rawQuery)) return undefined
  try {
    const db = getDb(env)
    const missing = await loadMissingSearchDocRows(db)
    if (missing.length > MISSING_DOC_ROW_CAP) return undefined
    const rewrite = await rewriteProductSearch(rawQuery, d1VocabSource(db), options.mode)
    if (!rewrite) return undefined
    const missingIds = missing.length
      ? searchTermIndex(buildTermIndex(missing.map((row) => ({ id: row.id, name: row.name, brand: row.brand }))), rawQuery, { mode: options.mode }).hits.map((hit) => hit.id)
      : []
    return { ...rewrite, missingIds, barcodeLookup: looksLikeBarcode(rawQuery) }
  } catch {
    return undefined
  }
}

// The query-string aliases the three product endpoints accept, read the same
// way each of them reads them.
export function productSearchRequest(query: Record<string, string | undefined>): { text: string; mode?: string; titleOnly: boolean; ranked: boolean } {
  return {
    text: String(query.query || query.q || query.search || ''),
    mode: query.searchMode || query.search_mode,
    titleOnly: ['name', 'title'].includes(String(query.searchFields || query.search_fields || '').toLowerCase()),
    ranked: query.rankIds != null && String(query.rankIds).trim() !== '',
  }
}

export async function prepareProductSearchDocFromQuery(env: Env, query: Record<string, string | undefined>): Promise<ProductSearchDocPlan | undefined> {
  const request = productSearchRequest(query)
  return prepareProductSearchDoc(env, request.text, { mode: request.mode, titleOnly: request.titleOnly, ranked: request.ranked })
}
