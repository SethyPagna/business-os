import { fmtClock24, parseServerTimestampMs } from '../../utils/formatters.ts'

/**
 * "Stock as of 14:05": when the Worker computed the Dashboard's stock figures (which can be a few minutes old), in business time, 24-hour.
 * `template` is the translated sentence with a {time} slot. Null when the Worker sent no time or one that is not a time, so the line
 * is left out; the device clock is never a substitute.
 */
export function stockAsOfText(asOf: unknown, template: string): string | null {
  if (typeof asOf !== 'string' || !Number.isFinite(parseServerTimestampMs(asOf))) return null
  return template.replace('{time}', fmtClock24(asOf))
}

/**
 * The header's "as of" when the panel also shows an expanded list that was computed at a different moment: the OLDER of the two,
 * so the time printed never claims fresher data than the oldest number on screen. Unparseable or missing times are ignored; null when none parse.
 */
export function olderAsOf(times: readonly unknown[]): string | null {
  let best: string | null = null
  let bestMs = Infinity
  for (const t of times) {
    if (typeof t !== 'string') continue
    const ms = parseServerTimestampMs(t)
    if (Number.isFinite(ms) && ms < bestMs) { best = t; bestMs = ms }
  }
  return best
}
