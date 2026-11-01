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
import { fullContactPhoneClause, isDigitWord, phoneProbeOf, phoneShapedSql, type PhoneSearchAccess } from './phoneSearchGuard'

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

export interface ContactMatchClause {
  sql: string
  params: Record<string, string>
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
  const probe = access.fullPhone ? ({ kind: 'none' } as const) : phoneProbeOf(rawSearch)
  const open = buildOpenContactMatchClause(table, rawSearch, paramPrefix, false)
  if (probe.kind === 'none') return open
  // The account cannot see numbers: digit-only words search the non-phone columns only; a whole number also finds the
  // contact whose phone IS that number (the open match narrows the rows, the digit comparison confirms one string).
  const restricted = buildOpenContactMatchClause(table, rawSearch, paramPrefix, true)
  if (probe.kind === 'partial' || !open || !restricted) return restricted
  const exact = fullContactPhoneClause(probe, `${paramPrefix}_digits`, CONTACT_OPTION_LIMIT)
  return { sql: `((${open.sql} AND ${exact.sql}) OR ${restricted.sql})`, params: { ...open.params, ...exact.params, ...restricted.params } }
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
      if (digitWordsAvoidPhones && isDigitWord(word)) return `${NON_PHONE_COLUMNS[table]} : ${word}*`
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
  const trigramEligible = words.every((word) => word.length >= 3) && !(digitWordsAvoidPhones && words.some(isDigitWord))

  const params: Record<string, string> = {}
  const wordParam = `${paramPrefix}_word`
  params[wordParam] = wordExpr
  const wordMatch = `id IN (SELECT rowid FROM ${wordTable} WHERE ${wordTable} MATCH @${wordParam})`
  // A contact saved by its number has that number as its name, so a digit word may not read such a name either.
  const clauses = [digitWordsAvoidPhones && words.some(isDigitWord) ? `(${wordMatch} AND NOT ${phoneShapedSql('name')})` : wordMatch]

  if (trigramEligible) {
    const phoneParam = `${paramPrefix}_phone`
    params[phoneParam] = words.join(' AND ')
    clauses.push(`id IN (SELECT rowid FROM ${phoneTable} WHERE ${phoneTable} MATCH @${phoneParam})`)
  }

  return { sql: `(${clauses.join(' OR ')})`, params }
}
