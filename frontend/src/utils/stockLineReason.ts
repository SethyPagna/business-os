// The reason a queued fast stock-in line writes onto its inventory movement.
//
// What the operator typed wins, exactly as typed -- never remapped onto a
// saved-reason id or a session label. A blank line keeps the label each
// write path carried before per-line reasons came back (N27 hardcoded them),
// so a fast operator who types nothing is not blocked and the ledger reads
// as it did. POST /api/inventory/adjust refuses a missing reason, which is
// why the fallback is resolved here rather than server-side.
//
// The plain add path (POST /api/batches) is the one caller that does NOT
// use this: it sends the typed text or null, because only the Worker knows
// the lot code its own "Stock received (<lot>)" label carries.
type TranslateWithFallback = (key: string, fallbackEn?: string, fallbackKm?: string) => string

export function stockLineReason(line: { mode: 'add' | 'remove' | 'set'; reason: string }, tr: TranslateWithFallback): string {
  const typed = String(line.reason || '').trim()
  if (typed) return typed
  return line.mode === 'add'
    ? tr('stock_in_session_reason', 'Stock-in session')
    : tr('stock_change_session_reason', 'Stock change session')
}
