// `ids=` filter for the contact list routes (GET /customers, /suppliers,
// /delivery-contacts -- see routes/contacts.ts's registerContactRoutes).
//
// Why this exists: the list route's only "give me these specific rows"
// shape used to be "download the whole table and find them client-side".
// For customers that is the single most expensive read in the system
// (SELECT * over every row PLUS a per-row loyalty aggregation), so a
// caller that wants one or two known contacts -- POS re-reading the
// customer it just created, or re-selecting the existing customer behind
// a phone conflict -- paid for the entire table. `ids=` turns that into
// one bounded query.
//
// Additive and backward compatible: no `ids` param -> every clause below
// is skipped and the route behaves exactly as before.
//
// The ids are rendered as SQL literals rather than bound parameters on
// purpose. D1 refuses a statement carrying more than 100 bound parameters
// (see lib/sqlBinding.ts), and this clause shares its statement with the
// search/gender/date parameters; validated non-negative integers are not
// injectable, so inlining them keeps the whole bound-parameter budget for
// the rest of the query.

// A deliberately small ceiling: this is a "look these few up" filter, not
// a bulk export path. A caller with more ids than this should page the
// list instead, so the route rejects the request rather than silently
// truncating it to the first N (a partial answer that looks complete is
// worse than an error).
export const CONTACT_ID_FILTER_MAX = 50

export type ContactIdFilter = {
  // True when the caller asked for an id filter at all -- distinct from
  // "asked for one and every value was junk", which must return no rows
  // rather than falling back to the whole table.
  requested: boolean
  ids: number[]
  // Set when the caller sent more than CONTACT_ID_FILTER_MAX usable ids.
  tooMany: boolean
}

function pushIdTokens(raw: unknown, out: string[]): void {
  if (raw == null) return
  if (Array.isArray(raw)) {
    for (const entry of raw) pushIdTokens(entry, out)
    return
  }
  const text = String(raw)
  if (!text.trim()) return
  for (const token of text.split(',')) out.push(token.trim())
}

/**
 * Parses `ids` from a query string. Accepts a single comma-separated value
 * (`ids=1,2,3`), a repeated parameter (`ids=1&ids=2`), or both. Values that
 * are not positive integers are dropped; duplicates collapse in first-seen
 * order so the caller's own ordering is preserved for debugging.
 */
export function parseContactIdFilter(raw: unknown): ContactIdFilter {
  const tokens: string[] = []
  pushIdTokens(raw, tokens)
  if (!tokens.length) return { requested: false, ids: [], tooMany: false }

  const seen = new Set<number>()
  const ids: number[] = []
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) continue
    const value = Number(token)
    if (!Number.isSafeInteger(value) || value <= 0) continue
    if (seen.has(value)) continue
    seen.add(value)
    ids.push(value)
  }
  return { requested: true, ids, tooMany: ids.length > CONTACT_ID_FILTER_MAX }
}

/**
 * The WHERE fragment for a parsed filter. Returns '' when no filter was
 * requested, and a never-matching clause when one was requested but no
 * usable id survived parsing -- never "match everything".
 */
export function buildContactIdClause(filter: ContactIdFilter, column = 'id'): string {
  if (!filter.requested) return ''
  if (!filter.ids.length) return '1 = 0'
  return `${column} IN (${filter.ids.join(', ')})`
}
