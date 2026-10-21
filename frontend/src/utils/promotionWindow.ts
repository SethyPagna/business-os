// A rule that is not live right now has either passed its end date or is
// waiting for its start. `today` and `endDate` are YYYY-MM-DD and `today` is the
// Cambodia business day (todayStr), so the flip happens at 00:00 Phnom Penh on
// every device, not at the device's own midnight.
export function isPromotionEnded(today: string, endDate: string): boolean {
  return Boolean(endDate) && endDate < today
}
