// The version of the POS cart this device keeps (CACHE-LIFECYCLE R8, G10). Only the till and its unsent-checkout restore load this file:
// the draft half and the notices every screen shares stay in utils/persistedRecordSchema.ts, so the storefront never carries the cart rules.
//
// A cart is stamped with the schema of the build that wrote it. A build reads the schemas it knows. A cart from a NEWER build (a rollback,
// or a second tab still on the new build) is never read under this build's older rules and never overwritten or deleted by it: it stays
// on the device byte for byte, the till starts empty, and the person is told once. A cart from before this slice carries no schema and is
// read exactly as before.
import { isNewerSchema, parseStoredJson, type RecordAge } from './persistedRecordSchema.ts'

export const POS_ORDERS_SCHEMA = 1
// The newest money rule this build can price a cart under (POS money_precision_version).
export const KNOWN_MONEY_PRECISION = 1

/** The stored POS orders string (a JSON array of orders): readable, from a newer build, or not ours at all. */
export function inspectPosOrdersRecord(raw: string | null | undefined): RecordAge {
  if (typeof raw !== 'string' || !raw) return 'none'
  const parsed = parseStoredJson(raw)
  if (!Array.isArray(parsed)) return 'unreadable'
  for (const order of parsed) {
    if (!order || typeof order !== 'object') continue
    const record = order as Record<string, unknown>
    if (isNewerSchema(record.schema, POS_ORDERS_SCHEMA) || isNewerSchema(record.money_precision_version, KNOWN_MONEY_PRECISION)) return 'newer'
  }
  return 'readable'
}

/**
 * The cart string a screen may load, from its stores in order of preference (localStorage, this tab's sessionStorage, the legacy key):
 * the first one that is not from a newer build. `sawNewer` says a skipped store held one, so the person is told.
 */
export function pickReadablePosOrders(candidates: Array<string | null | undefined>): { raw: string | null; sawNewer: boolean } {
  let sawNewer = false
  for (const candidate of candidates) {
    if (!candidate) continue
    if (inspectPosOrdersRecord(candidate) === 'newer') { sawNewer = true; continue }
    return { raw: candidate, sawNewer }
  }
  return { raw: null, sawNewer }
}

/** Which stores a cart write may reach: one that holds a newer build's record is left alone. */
export function posOrdersWriteTargets(local: string | null | undefined, session: string | null | undefined): { local: boolean; session: boolean } {
  return { local: inspectPosOrdersRecord(local) !== 'newer', session: inspectPosOrdersRecord(session) !== 'newer' }
}
