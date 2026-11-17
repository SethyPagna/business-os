// The date chips of the Inventory list (owner, 17 Nov 2026): "options of the dates of checked". Each chip is one Cambodia business day on which a product at this branch was LAST counted, with how many products
// that is. The server computes them from the check-state set it already caches (summary.days, newest first, nothing extra read); a tap on a chip asks the list for that day (checkedOn=YYYY-MM-DD), the same one
// /list plus one overlay as a status chip.
import { fmtDateOnly } from '../../utils/formatters.ts'

export type CheckDay = { day: string; count: number }
/** What the summary of an answer says about the dates: the days, or that there are too many products to list them (the status chips are then hidden too). */
export type CheckDaysSummary = { days?: unknown; tooLarge?: unknown } | null | undefined

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The days of a summary, newest first. Anything the server did not mean as a day (a malformed date, a zero or fractional count, a repeat) is dropped; no days, or `tooLarge`, means no chips. */
export function checkDaysOf(summary: CheckDaysSummary): CheckDay[] {
  if (!summary || summary.tooLarge === true || !Array.isArray(summary.days)) return []
  const seen = new Set<string>()
  const days: CheckDay[] = []
  for (const entry of summary.days as unknown[]) {
    const { day, count } = (entry ?? {}) as { day?: unknown; count?: unknown }
    if (typeof day !== 'string' || !DAY.test(day) || seen.has(day) || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) continue
    seen.add(day)
    days.push({ day, count })
  }
  return days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/**
 * What the rail draws: the days, and the day the list is filtered to even when the summary no longer lists it (the last product counted that day was counted again since), so the chosen chip is always on the rail
 * and "All" is always one tap away. A chosen day the summary does not list has no count.
 */
export function dayChipsOf(days: readonly CheckDay[], chosen: string): Array<{ day: string; count?: number }> {
  if (!chosen || !DAY.test(chosen) || days.some(entry => entry.day === chosen)) return [...days]
  return [...days, { day: chosen }].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** dd/mm/yyyy, the app's one date form (the same in English and Khmer). */
export const dayLabel = (day: string): string => fmtDateOnly(day)
