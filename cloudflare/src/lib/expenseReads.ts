import { readSwitch } from './readSwitches'
import type { Env } from '../index'

// The Expenses page's two read cuts (E1-F), both behind the read switch `expense_reads`. OFF is the exact code of 6.0.1053; only a stored
// token of exactly 'on' turns them on (a `shadow:<rate>` token serves OFF: neither cut has a sampled comparison).
//   1. GET /api/fees/report in ONE grouped pass over the expense table instead of four (foldFeeGroups).
//   2. GET /api/fees?source=all|sale&cursor=... : the export pages by a keyset cursor over the merged list (encodeFeeCursor), so a page reads its own
//      rows and not the top offset+limit again.
export const EXPENSE_READS_SWITCH = 'expense_reads'

export function expenseReadsOn(env: Env): Promise<boolean> {
  return readSwitch(env, EXPENSE_READS_SWITCH)
}

// ---------------------------------------------------------------------------------------------------------------------
// The report's grouped pass
// ---------------------------------------------------------------------------------------------------------------------

/** One group of the single pass: GROUP BY fee_date, fee_type and the label key; `label` is MIN(TRIM(label)) of the group (null when every label is null). */
export type FeeGroupRow = { d: string; t: string; k: string; label: string | null; n: number; usd: number; khr: number }

/** The four statements' rows in the shape routes/fees.ts maps into the response (same keys, same sort), so the response is built by the same code either way. */
export type FeeReportParts = {
  totals: { count: number; amount_usd: number; amount_khr: number }
  days: Array<{ date: string; count: number; amount_usd: number; amount_khr: number }>
  byType: Array<{ fee_type: string; count: number; amount_usd: number; amount_khr: number }>
  byCategory: Array<{ fee_type: string; label: string; count: number; amount_usd: number; amount_khr: number }>
}

/** SQLite orders TEXT by its UTF-8 bytes, which is code point order; JS compares UTF-16 units, which differ for a character above U+FFFF against U+E000..U+FFFF. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number
    const y = b.codePointAt(j) as number
    if (x !== y) return x < y ? -1 : 1
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return (i < a.length ? 1 : 0) - (j < b.length ? 1 : 0)
}

/**
 * ROUND(value, 2) for scale 100 or ROUND(value, 0) for scale 1 as SQLite answers it, or null when the answer could differ. The one-pass sums are
 * sums of per-group sums, so they can sit a few ULPs from the four-pass sums; both round alike unless the value lies on a half-unit boundary
 * (0.005 USD, 0.5 riel), which only a sub-cent or fractional-riel amount can produce. Null sends the request to the four-pass code.
 */
export function roundLikeSqlite(value: number, scale: 100 | 1): number | null {
  const scaled = Math.abs(value) * scale
  if (!Number.isFinite(scaled)) return null
  const frac = scaled - Math.floor(scaled)
  if (Math.abs(frac - 0.5) <= 1e-6 + scaled * 1e-12) return null
  const out = Math.floor(scaled + 0.5) / scale
  return value < 0 && out !== 0 ? -out : out
}

type Sum = { n: number; usd: number; khr: number }
type Cat = Sum & { label: string | null }
const add = (into: Sum, row: Sum): void => { into.n += row.n; into.usd += row.usd; into.khr += row.khr }
function slot<V>(map: Map<string, V>, key: string, make: () => V): V {
  let value = map.get(key)
  if (value === undefined) { value = make(); map.set(key, value) }
  return value
}
const cmpMoney = (a: { amount_usd: number; amount_khr: number }, b: { amount_usd: number; amount_khr: number }): number => (b.amount_usd - a.amount_usd) || (b.amount_khr - a.amount_khr)

/**
 * The totals, the per-day series, the per-type breakdown and the per-type-and-label breakdown of routes/fees.ts GET /report, folded from the rows of one
 * grouped pass. Same rounding, same sort (money descending; a tie keeps the order the four-pass statement emitted it in: the group key ascending, which is
 * what SQLite's stable sorter leaves), same label (the binary-smallest trimmed spelling, '' when blank). Null when any figure is on a rounding boundary.
 */
export function foldFeeGroups(rows: FeeGroupRow[]): FeeReportParts | null {
  const total: Sum = { n: 0, usd: 0, khr: 0 }
  const days = new Map<string, Sum>()
  const types = new Map<string, Sum>()
  const cats = new Map<string, Map<string, Cat>>()
  for (const row of rows) {
    add(total, row)
    add(slot(days, row.d, () => ({ n: 0, usd: 0, khr: 0 })), row)
    add(slot(types, row.t, () => ({ n: 0, usd: 0, khr: 0 })), row)
    const cat = slot(slot(cats, row.t, () => new Map<string, Cat>()), row.k, () => ({ n: 0, usd: 0, khr: 0, label: null }))
    add(cat, row)
    if (row.label !== null && (cat.label === null || compareCodePoints(row.label, cat.label) < 0)) cat.label = row.label
  }
  const money = (sum: Sum): { count: number; amount_usd: number; amount_khr: number } | null => {
    const usd = roundLikeSqlite(sum.usd, 100)
    const khr = roundLikeSqlite(sum.khr, 1)
    return usd === null || khr === null ? null : { count: sum.n, amount_usd: usd, amount_khr: khr }
  }
  const totals = money(total)
  if (!totals) return null
  const outDays: FeeReportParts['days'] = []
  for (const [date, sum] of [...days].sort((a, b) => compareCodePoints(b[0], a[0]))) {
    const m = money(sum)
    if (!m) return null
    outDays.push({ date, ...m })
  }
  const outTypes: FeeReportParts['byType'] = []
  for (const [feeType, sum] of [...types].sort((a, b) => compareCodePoints(a[0], b[0]))) {
    const m = money(sum)
    if (!m) return null
    outTypes.push({ fee_type: feeType, ...m })
  }
  const outCats: Array<FeeReportParts['byCategory'][number] & { key: string }> = []
  for (const [feeType, byKey] of [...cats].sort((a, b) => compareCodePoints(a[0], b[0]))) {
    for (const [key, sum] of [...byKey].sort((a, b) => compareCodePoints(a[0], b[0]))) {
      const m = money(sum)
      if (!m) return null
      outCats.push({ fee_type: feeType, label: sum.label || '', key, ...m })
    }
  }
  // Array.prototype.sort is stable, so equal rows keep the key-ascending order they were pushed in.
  outTypes.sort(cmpMoney)
  outCats.sort((a, b) => cmpMoney(a, b) || compareCodePoints(a.label, b.label))
  return { totals, days: outDays, byType: outTypes, byCategory: outCats.map(({ key: _key, ...cat }) => cat) }
}

// ---------------------------------------------------------------------------------------------------------------------
// The export cursor
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Where a keyset page resumes. The merged list is a two-pointer merge of two lists (expenses by fee_date, id; sale courier rows by day, entry time, id),
 * not a sort by one key, so the cursor holds ONE key per list: the last expense and the last sale row already served (null while none was). `h` is the
 * highest expense id and sale id at the start of the export; a row created later is outside the export, so a mid-export insert can neither shift nor
 * duplicate a page (the sales export's `snapshot_max_id`, GET /api/sales/export).
 *
 * A sale row whose created_at has no readable day has a NULL day (and usually a NULL entry time): the list puts those rows last, so the key keeps them as
 * null, never as the text 'null'. `u` is how many such rows the export's scope held at its start (0 = none: no page looks for them); a token without it
 * (one handed out before the field existed) reads as 1, which only costs one look for them at the end of the sale list.
 */
export type FeeExportCursor = {
  e: [string, number] | null
  s: [string | null, string | null, number] | null
  h: [number, number]
  u: number
}

const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string): string => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function encodeFeeCursor(cursor: FeeExportCursor): string {
  return toBase64Url(JSON.stringify({ v: 1, e: cursor.e, s: cursor.s, h: cursor.h, u: cursor.u }))
}

const KEY_TEXT_MAX_CHARS = 64
const keyText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= KEY_TEXT_MAX_CHARS
const rowId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** The cursor a page handed out, or null for anything else (a hand-made, truncated or foreign token). The caller then pages by `offset`. */
export function decodeFeeCursor(text: string): FeeExportCursor | null {
  try {
    const parsed = JSON.parse(fromBase64Url(text)) as { v?: unknown; e?: unknown; s?: unknown; h?: unknown; u?: unknown }
    if (!parsed || parsed.v !== 1) return null
    const { e, s, h } = parsed
    if (e !== null && !(Array.isArray(e) && e.length === 2 && keyText(e[0]) && rowId(e[1]))) return null
    // a dated sale row always has an entry time; only a row with no day may have none (and a null day with a null entry time is the garbage row)
    if (s !== null && !(Array.isArray(s) && s.length === 3 && (s[0] === null || keyText(s[0])) && (s[1] === null || keyText(s[1])) && !(s[0] !== null && s[1] === null) && rowId(s[2]))) return null
    if (!(Array.isArray(h) && h.length === 2 && h.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0))) return null
    const u = parsed.u === undefined ? 1 : parsed.u
    if (!(typeof u === 'number' && Number.isSafeInteger(u) && u >= 0)) return null
    return { e: e as FeeExportCursor['e'], s: s as FeeExportCursor['s'], h: [h[0], h[1]], u }
  } catch {
    return null
  }
}
