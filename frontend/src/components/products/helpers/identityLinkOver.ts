// N34 / lane "linkover" -- the client half of the identity link-over decision.
//
// The owner's ruling: "make sure when change they linkover ... prompt user if
// they should link over, and keep it changeable in conflict."
//
// Two questions live here, and they are deliberately the SAME two questions the
// Worker's guard asks, through the same kernel:
//
//   1. BEFORE the save -- does this edit move the row onto another product's
//      identity, and onto WHICH rows? (identityEditMovesOnto). This is the
//      pre-check the edit path never had: until 2026-09-06 the client asked its
//      identity question in CREATE mode only (classifyCreateMatches, gated on
//      `isCreateMode`), so an edit that renamed or re-barcoded a row onto
//      another product's identity was discovered by the server's 409 after Save
//      had already been pressed.
//
//   2. AFTER a refusal -- what did the server say we collided with, and which
//      answers does it accept at this door? (identityCollisionFrom).
//
// Both fold the barcode through identityBarcodeKey and group the name through
// normalizeProductGroupName -- via productRowIdentityKey in
// utils/productDetailRule.ts, the ONE module both packages carry verbatim
// (tests/productDetailRuleParity.test.ts byte-compares them). So "is this the
// same product?" cannot be answered one way here and another way on the
// Worker: a client that folded raw barcodes would prompt on a save that moved
// nothing, and a client that folded harder than the server would let a genuine
// collision through to a 409 the operator was never warned about.
//
// NOTHING in this module writes. It classifies, and the caller decides.

import { productRowIdentityKey, resolveProductIdentityEdit } from '../../../utils/productDetailRule.ts'

// The decision the Worker reads off the save body, mirrored EXACTLY. These are
// wire constants, not display strings: tests/identityLinkOver.test.ts reads the
// literals back out of cloudflare/src/routes/products.ts and fails if either
// side is respelled, because a client sending '__identityDecision' or
// 'keepSeparate' would silently get the plain refusal forever -- the guard
// treats anything that is not the exact word as "no answer was given", which is
// the right behaviour there and an invisible dead end here.
export const IDENTITY_DECISION_FIELD = '__identity_decision'
export const IDENTITY_KEEP_SEPARATE = 'keep_separate'

export type IdentityMatch = {
  id: number
  name: string | null
  barcode: string | null
}

/** A row the client can compare against -- whatever the search/list gave it. */
export type IdentityCandidate = {
  id: number | string
  name?: string | null
  barcode?: string | null
}

export type IdentityCollision = {
  /** Every row this save collides with, never just the first. */
  matches: IdentityMatch[]
  /** The server's own message, kept for the surfaces that only report text. */
  message: string
  /**
   * Whether THIS door can offer to link the records over. False on create --
   * there is no saved row yet whose records could move anywhere, which is why
   * the Worker sends 'open_existing' there instead. A client that offered a
   * merge on create would be offering to fold a row that does not exist.
   */
  canLinkOver: boolean
  /** Whether the operator may write anyway and settle the pair in Conflicts. */
  canKeepSeparate: boolean
}

function toMatch(row: unknown): IdentityMatch | null {
  const raw = row as { id?: unknown; name?: unknown; barcode?: unknown } | null
  const id = Number(raw?.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    name: raw?.name == null ? null : String(raw.name),
    barcode: raw?.barcode == null ? null : String(raw.barcode),
  }
}

/**
 * The server's identity refusal, unpacked. Returns null for ANY other failure,
 * so an unrelated error (a 500, a permission refusal, a dropped connection) can
 * never be mistaken for an invitation to fold two products together.
 *
 * Reads the structured fields the guard now sends (`matches`, `resolutions`)
 * and falls back to the single `duplicate` row the refusal has always carried,
 * so this keeps working against an older Worker -- with link-over offered and
 * keep-separate correctly NOT offered, because an older Worker would refuse the
 * decision field it does not know about.
 */
export function identityCollisionFrom(error: unknown): IdentityCollision | null {
  const err = error as {
    code?: unknown
    error?: unknown
    matches?: unknown
    duplicate?: unknown
    resolutions?: unknown
  } | null
  if (String(err?.code || '') !== 'duplicate_product') return null

  const listed = Array.isArray(err?.matches) ? err.matches : []
  const matches = (listed.length ? listed : [err?.duplicate])
    .map(toMatch)
    .filter((row): row is IdentityMatch => row !== null)
  if (!matches.length) return null

  // An older Worker sends no `resolutions` at all. Treat that as "link-over
  // only": it is the behaviour that shipped, and offering keep-separate against
  // a Worker that would reject the decision field would put a button in front
  // of the operator that cannot work.
  const resolutions = Array.isArray(err?.resolutions) ? err.resolutions.map((value) => String(value)) : null
  return {
    matches,
    message: String(err?.error || ''),
    canLinkOver: resolutions ? resolutions.includes('link_over') : true,
    canKeepSeparate: resolutions ? resolutions.includes(IDENTITY_KEEP_SEPARATE) : false,
  }
}

/**
 * The PRE-check. Given the row as it stands, the edit about to be sent, and the
 * candidate rows the client already has, return every candidate the edit would
 * land on top of.
 *
 * Empty means "ask nothing" -- and that is the answer in the overwhelmingly
 * common case, because `changesIdentity` is false whenever the edit leaves the
 * name group and the folded barcode where they are. The form posts the WHOLE
 * row on every save, so name and barcode are present even when only the price
 * moved; asking "does another row have this identity?" on every save is the
 * wrong question, and for a pair that ALREADY shares one -- a leading-zero
 * twin -- the answer is permanently yes.
 *
 * `excludeId` is the row being edited: a row can never collide with itself.
 */
export function identityEditMovesOnto(
  current: { id?: number | string | null; name?: unknown; barcode?: unknown } | null | undefined,
  body: { name?: unknown; barcode?: unknown },
  candidates: readonly IdentityCandidate[],
): IdentityMatch[] {
  const { nextName, nextBarcode, changesIdentity } = resolveProductIdentityEdit(current, body)
  if (!changesIdentity) return []
  const nextKey = productRowIdentityKey(nextName, nextBarcode)
  // A blank name has no identity to collide with -- normalizeProductGroupName
  // returns '' and every unnamed row would otherwise match every other one.
  if (!String(nextName || '').trim()) return []
  const selfId = Number(current?.id)
  const seen = new Set<number>()
  const hits: IdentityMatch[] = []
  for (const candidate of candidates) {
    const match = toMatch(candidate)
    if (!match) continue
    if (Number.isInteger(selfId) && match.id === selfId) continue
    if (seen.has(match.id)) continue
    if (productRowIdentityKey(match.name, match.barcode) !== nextKey) continue
    seen.add(match.id)
    hits.push(match)
  }
  return hits
}

/** The save body plus the operator's explicit "write it anyway" answer. */
export function withKeepSeparateDecision<T extends Record<string, unknown>>(payload: T): T & Record<string, unknown> {
  return { ...payload, [IDENTITY_DECISION_FIELD]: IDENTITY_KEEP_SEPARATE }
}
