// Refusals of the till's sale about an online order (POST /api/sales with online_order_id) and of a refund through ABA (POST /api/returns with refund_channel 'aba'), by their stable
// code -> the language-pack key that says it in the staff language. Staff-only and rare, so this file is reached only by a dynamic import from the till when such a sale
// is refused, and never rides in the storefront's refusal tables. The three return codes use the code itself as the pack key because the Returns screen already looks a refusal up by
// code (T(code, message)); the till's codes use oo_err_* keys. The Worker's own English stays for an English screen; only a Khmer one loads the pack, as for every other restated refusal.
export const ONLINE_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  order_in_review: 'oo_err_in_review',
  order_other_branch: 'oo_err_other_branch',
  online_tender_mismatch: 'oo_err_tender_mismatch',
  online_order_changed: 'oo_err_order_changed_till',
  aba_refund_over_online: 'aba_refund_over_online',
  refund_channel_requires_online_order: 'refund_channel_requires_online_order',
  return_exchange_refund_channel: 'return_exchange_refund_channel',
  order_already_fulfilled: 'oo_err_already_fulfilled',
  order_not_paid: 'oo_err_till_not_paid',
  online_currency_unsupported: 'oo_err_currency',
  online_order_invalid: 'oo_err_order_invalid',
  order_not_found: 'oo_err_not_found',
}

/** Give a refused online-order sale its Khmer sentence when the screen is Khmer; any other error, or an English screen, is returned as it came. */
export async function restateOnlineRefusal<T extends Error & { code?: unknown }>(error: T): Promise<T> {
  const code = typeof error?.code === 'string' ? error.code : ''
  const key = code && Object.prototype.hasOwnProperty.call(ONLINE_REFUSAL_KEYS, code) ? ONLINE_REFUSAL_KEYS[code] : ''
  if (!key) return error
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    if (!language.startsWith('km')) return error
    const pack = (await import('../../lang/km.json')).default as Record<string, unknown>
    const value = pack[key]
    if (typeof value === 'string' && value.trim()) error.message = value
  } catch {
    // Keep the Worker's English.
  }
  return error
}
