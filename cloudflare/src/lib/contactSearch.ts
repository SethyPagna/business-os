// contactSearch.ts
//
// Server-side search-query building for routes/contacts.ts's three tables
// (customers, suppliers, delivery_contacts). Replaces the
// `lower(COALESCE(col, '')) LIKE '%term%'` OR-chain that route used to
// build inline -- same full-table-scan cost profile as the pre-FTS5
// products search (see migrations/0018_products_fts.sql's own comment),
// now fixed the same way: migrations/0020_contacts_fts.sql adds one
// word-prefix FTS5 table (`<table>_fts`, unicode61 tokenizer) plus one
// substring-capable trigram FTS5 table (`<table>_fts_phone`) per contact
// table, and buildContactMatchClause below combines a MATCH against each
// via SQL OR -- same two-table split, same reasoning, as
// searchMatch.ts's buildFtsMatchExpression/buildTrigramMatchExpression for
// products_fts/products_fts_code.
//
// Deliberately simpler than the products-side hybrid: contacts search has
// never had a comma-separated AND/OR-groups UI (routes/contacts.ts always
// treated the whole search box as one free-text phrase), so this only
// needs to combine ONE query's words across two tables, not
// buildHybridMatchClause's per-group/per-word cross product. If contacts
// search ever grows comma-groups too, lift that logic in from
// searchMatch.ts instead of duplicating it here.
import { tokenizeSearchWords, expandAliasCandidatesForFts } from './searchMatch'
import { CONTACT_OPTION_LIMIT } from './contactOptions'
import { formatMembershipNumber, MEMBERSHIP_PREFIX } from './membershipNumber'
import { contactPhoneContainsClause, fullContactPhoneClause, hasDigit, phoneProbeOf, phoneShapedSql, typedPhoneDigitForms, type PhoneSearchAccess } from './phoneSearchGuard'

export type ContactSearchTable = 'customers' | 'suppliers' | 'delivery_contacts'

// Table name -> its two FTS5 virtual tables, per migrations/0020_contacts_fts.sql.
const FTS_TABLES: Record<ContactSearchTable, { word: string; phone: string }> = {
  customers: { word: 'customers_fts', phone: 'customers_fts_phone' },
  suppliers: { word: 'suppliers_fts', phone: 'suppliers_fts_phone' },
  delivery_contacts: { word: 'delivery_contacts_fts', phone: 'delivery_contacts_fts_phone' },
}

// The FTS columns that never hold a phone number. A digit-only word of an account without the full-phone permission
// is matched against these only (lib/phoneSearchGuard.ts), so a membership number still finds its customer.
const NON_PHONE_COLUMNS: Record<ContactSearchTable, string> = {
  customers: '{name email company membership_number}',
  suppliers: '{name email company contact_person}',
  delivery_contacts: '{name area}',
}

// The columns that name a person and so can hold a number (a contact saved under its number, a supplier's contact person that is one):
// the response masks them, so a digit word of an account without the grant may not read a row whose value in one of them is wholly a
// number. Listing a column here is what lets the response mask it without opening a search oracle (review B3).
const PERSON_COLUMNS: Record<ContactSearchTable, readonly string[]> = {
  customers: ['name'],
  suppliers: ['name', 'contact_person'],
  delivery_contacts: ['name'],
}

export interface ContactMatchClause {
  sql: string
  params: Record<string, string>
  /** True when the clause compares typed digits to stored phones, which reads every row of the table (no index serves it). */
  scansRows?: boolean
}

// Builds `(id IN (... MATCH @wordQuery) OR id IN (... MATCH @phoneQuery))`
// for the given table, or undefined if the search string tokenizes to
// nothing (matching buildFtsMatchExpression's own empty-groups contract).
// `paramPrefix` avoids colliding with any other named params the caller's
// query already uses (mirrors buildHybridMatchClause's own reason for
// taking one).
export function buildContactMatchClause(
  table: ContactSearchTable,
  rawSearch: unknown,
  paramPrefix: string,
  access: PhoneSearchAccess,
): ContactMatchClause | undefined {
  const clause = buildTextOrPhoneMatchClause(table, rawSearch, paramPrefix, access)
  const member = table === 'customers' ? membershipLookupOf(rawSearch, paramPrefix) : null
  if (!member) return clause
  return { sql: clause ? `(${clause.sql} OR ${member.sql})` : member.sql, params: { ...clause?.params, ...member.params }, ...(clause?.scansRows ? { scansRows: true } : {}) }
}

// A membership number typed as the whole search with or without its hyphen (lc20, lc00020, LC-00020) is looked up by equality on the
// expression migration 0122 indexes, which the word index cannot do for the unhyphenated form (it holds the tokens lc and 00020).
function membershipLookupOf(rawSearch: unknown, paramPrefix: string): ContactMatchClause | null {
  const shape = /^lc-?(\d{1,9})$/i.exec(String(rawSearch ?? '').trim())
  if (!shape || !Number(shape[1])) return null
  const forms = [...new Set([formatMembershipNumber(Number(shape[1])).toLowerCase(), `${MEMBERSHIP_PREFIX}${shape[1]}`.toLowerCase()])]
  const params: Record<string, string> = {}
  const marks = forms.map((form, index) => {
    params[`${paramPrefix}_member${index}`] = form
    return `@${paramPrefix}_member${index}`
  })
  return { sql: `lower(trim(membership_number)) IN (${marks.join(',')})`, params }
}

function buildTextOrPhoneMatchClause(
  table: ContactSearchTable,
  rawSearch: unknown,
  paramPrefix: string,
  access: PhoneSearchAccess,
): ContactMatchClause | undefined {
  const open = buildOpenContactMatchClause(table, rawSearch, paramPrefix, false)
  const probe = phoneProbeOf(rawSearch)
  const exact = probe.kind === 'full' ? fullContactPhoneClause(probe, `${paramPrefix}_digits`, CONTACT_OPTION_LIMIT) : null
  const normalizedColumn = table === 'customers' ? 'phone_normalized' : undefined
  if (access.fullPhone) {
    // A number is stored with the separators it was saved with ("012 345 678"), which neither the word index (tokens 012, 345, 678)
    // nor the trigram index (no run across a space) can find by its contiguous digits, so a typed number is also compared as digits.
    const forms = typedPhoneDigitForms(rawSearch)
    if (forms) {
      const contains = contactPhoneContainsClause(forms, `${paramPrefix}_run`, CONTACT_OPTION_LIMIT, normalizedColumn)
      return open ? { sql: `(${open.sql} OR ${contains.sql})`, params: { ...open.params, ...contains.params }, scansRows: true } : { ...contains, scansRows: true }
    }
    if (!exact || probe.kind !== 'full' || probe.plain || !open) return open ?? (exact ? { sql: exact.sql, params: exact.params, scansRows: true } : undefined)
    return { sql: `(${open.sql} OR ${exact.sql})`, params: { ...open.params, ...exact.params }, scansRows: true }
  }
  // The account cannot see numbers. The restriction is decided on the words the matcher searches, for every search, so no
  // spelling of a digit fragment (accent, letter o, punctuation) reaches a phone column: a digit-only word searches the
  // non-phone columns only. A whole number also finds the contact whose phone IS that number (equality of the digits, however
  // the stored number is separated). Its own parameter names: the matches carry different MATCH texts.
  const restricted = buildOpenContactMatchClause(table, rawSearch, `${paramPrefix}_restricted`, true)
  if (!exact || probe.kind !== 'full') return restricted
  const exactParams: Record<string, string> = { ...exact.params }
  let whole = exact.sql
  if (normalizedColumn) {
    const marks = probe.forms.map((form, index) => {
      exactParams[`${paramPrefix}_pn${index}`] = form
      return `@${paramPrefix}_pn${index}`
    })
    whole = `(${exact.sql} OR ${normalizedColumn} IN (${marks.join(',')}))`
  }
  if (!restricted) return { sql: whole, params: exactParams, scansRows: true }
  return { sql: `(${whole} OR ${restricted.sql})`, params: { ...exactParams, ...restricted.params }, scansRows: true }
}

function buildOpenContactMatchClause(
  table: ContactSearchTable,
  rawSearch: unknown,
  paramPrefix: string,
  digitWordsAvoidPhones: boolean,
): ContactMatchClause | undefined {
  const words = tokenizeSearchWords(rawSearch)
  if (!words.length) return undefined
  const { word: wordTable, phone: phoneTable } = FTS_TABLES[table]

  const wordExpr = words
    .map((word) => {
      // Uses the same per-word alias-expansion fix as
      // buildFtsMatchExpression (see searchMatch.ts's
      // expandAliasCandidatesForFts comment) -- contacts' own ALIAS_GROUPS
      // are currently all cosmetics-brand shorthands that never appear in
      // contact data, so this is a no-op today, but a plain
      // expandAliasCandidates call here would silently reintroduce the
      // exact same never-matches-a-multi-word-target bug the moment any
      // multi-word alias ever does apply to a contact field.
      if (digitWordsAvoidPhones && hasDigit(word)) return `${NON_PHONE_COLUMNS[table]} : ${word}*`
      const candidateForms = expandAliasCandidatesForFts(word)
      const candidateExprs = candidateForms.map((formWords) =>
        formWords.length > 1 ? `(${formWords.map((w) => `${w}*`).join(' AND ')})` : `${formWords[0]}*`,
      )
      return candidateExprs.length > 1 ? `(${candidateExprs.join(' OR ')})` : candidateExprs[0]
    })
    .join(' AND ')

  // Trigram tokens need 3+ characters (see 0019/0020's own comments on
  // why) -- a search entirely made of short words has no usable phone-side
  // query at all, same "drop the whole group" rule
  // buildTrigramMatchExpression already uses rather than silently loosening
  // AND semantics by checking only the long words.
  const trigramEligible = words.every((word) => word.length >= 3) && !(digitWordsAvoidPhones && words.some(hasDigit))

  const params: Record<string, string> = {}
  const wordParam = `${paramPrefix}_word`
  params[wordParam] = wordExpr
  const wordMatch = `id IN (SELECT rowid FROM ${wordTable} WHERE ${wordTable} MATCH @${wordParam})`
  // A contact saved by its number has that number as its name (a supplier's contact person too), so a digit word may not read such a name either.
  const clauses = [digitWordsAvoidPhones && words.some(hasDigit) ? `(${wordMatch} AND ${PERSON_COLUMNS[table].map((column) => `NOT ${phoneShapedSql(column)}`).join(' AND ')})` : wordMatch]

  if (trigramEligible) {
    const phoneParam = `${paramPrefix}_phone`
    params[phoneParam] = words.join(' AND ')
    clauses.push(`id IN (SELECT rowid FROM ${phoneTable} WHERE ${phoneTable} MATCH @${phoneParam})`)
  }

  return { sql: `(${clauses.join(' OR ')})`, params }
}
