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
