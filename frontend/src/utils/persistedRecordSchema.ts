// Versions for the records this device keeps for the person at the till: POS carts and form drafts (CACHE-LIFECYCLE R8, G10).
//
// A record is stamped with the schema of the build that wrote it. A build reads the schemas it knows. A record from a NEWER build
// (a rollback, or a second tab still on the new build) is never read under this build's older rules and never overwritten or
// deleted by it: it stays on the device byte for byte, the screen starts empty, and the person is told once. Records from before
// this slice carry no schema and are read exactly as before.
//
// Only user work is protected this way. The product search index is a cache: an unknown `format` or `core` there is discarded and
// downloaded again (api/productSearchIndex.ts).

export const POS_ORDERS_SCHEMA = 1
export const WORK_DRAFT_SCHEMA = 1
// The newest money rule this build can price a cart under (POS money_precision_version).
export const KNOWN_MONEY_PRECISION = 1
export const NEWER_RECORD_EVENT = 'app:newer-record'

export type RecordAge = 'none' | 'unreadable' | 'readable' | 'newer'
export type NewerRecordKind = 'cart' | 'draft'

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return undefined }
}

const isNewerSchema = (value: unknown, known: number): boolean => typeof value === 'number' && Number.isFinite(value) && value > known

/** The stored POS orders string (a JSON array of orders): readable, from a newer build, or not ours at all. */
export function inspectPosOrdersRecord(raw: string | null | undefined): RecordAge {
  if (typeof raw !== 'string' || !raw) return 'none'
  const parsed = parseJson(raw)
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

/** The stored draft envelope { schema?, at, data }. */
export function inspectWorkDraftRecord(raw: string | null | undefined): RecordAge {
  if (typeof raw !== 'string' || !raw) return 'none'
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unreadable'
  return isNewerSchema((parsed as Record<string, unknown>).schema, WORK_DRAFT_SCHEMA) ? 'newer' : 'readable'
}

// One notice per kind per page. The shell may not be listening yet when a screen first meets a newer record, so the kinds wait
// in `pending` until the shell takes them.
const announced = new Set<NewerRecordKind>()
const pending: NewerRecordKind[] = []

export function announceNewerRecord(kind: NewerRecordKind): void {
  if (announced.has(kind)) return
  announced.add(kind)
  pending.push(kind)
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try { window.dispatchEvent(new CustomEvent(NEWER_RECORD_EVENT, { detail: { kind } })) } catch { /* a notice never blocks the screen */ }
}

export function takeNewerRecordNotices(): NewerRecordKind[] {
  return pending.splice(0, pending.length)
}

export function __resetNewerRecordNoticesForTests(): void {
  announced.clear()
  pending.length = 0
}
