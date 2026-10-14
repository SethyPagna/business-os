// The Worker refuses a cashier's close time that would leave a recorded sale, return or expense
// outside the drawer (409, a code). The app shows its own translated sentence, not the English fallback.
export function shiftCloseTimeRefusalText(error: unknown, t: (key: string) => string): string | null {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'shift_close_before_last_activity') return t('shift_close_before_last_activity')
  if (code === 'shift_close_too_early') return t('shift_close_too_early')
  return null
}
