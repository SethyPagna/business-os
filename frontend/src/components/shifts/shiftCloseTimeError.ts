// The Worker refuses a shift time that would leave a recorded sale, return or expense outside the drawer, or
// that only an administrator may choose (409, a code). The app shows its own translated sentence, never the
// English fallback; each code is the pack key of its sentence.
const TIME_REFUSAL_CODES = new Set([
  'shift_close_before_last_activity',
  'shift_close_too_early',
  'shift_time_admin_only',
  'shift_overlaps_next_segment',
  'shift_overlaps_previous_segment',
  'shift_reopen_needs_count',
])

export function shiftCloseTimeRefusalText(error: unknown, t: (key: string) => string): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && TIME_REFUSAL_CODES.has(code) ? t(code) : null
}
