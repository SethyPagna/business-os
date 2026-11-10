export type WriteErrorDetail = {
  code?: unknown
  outcome?: unknown
  reason?: unknown
  timeoutMs?: unknown
}

export type WriteErrorTranslator = (key: string) => string | undefined

export type WriteErrorPresentation = {
  title: string
  detail: string
  unknownOutcome: boolean
}

type RejectionDetail = readonly [key: string, fallback: string]

const GENERIC_REJECTION_DETAIL: RejectionDetail = ['write_rejected_details', 'The server did not accept this change. View details to check the reason.']

// Keyed by the Worker's refusal code (cloudflare/src/routes/settings.ts).
const REJECTION_DETAILS: ReadonlyMap<string, RejectionDetail> = new Map<string, RejectionDetail>([
  ['invalid_portal_language', ['write_rejected_portal_language', 'The website language must be English or Khmer.']],
  ['portal_translation_private_key', ['write_rejected_portal_translation_key', 'A translation entry name cannot be published. Rename it, then save again.']],
  // KHQR: online order timing is refused with its reason, never clamped (cloudflare/src/lib/onlineOrders.ts validateOnlineOrderSettingsWrite).
  ['invalid_online_order_payment_minutes', ['write_rejected_online_order_payment_minutes', 'The payment time for online orders must be a whole number of minutes from 3 to 60.']],
  ['invalid_online_order_request_days', ['write_rejected_online_order_request_days', 'The change window for online orders must be a whole number of days from 1 to 30.']],
  ['invalid_online_order_payment_method', ['write_rejected_online_order_payment_method', 'The online payment method must be one of the configured payment methods.']],
  ['online_method_required', ['write_rejected_online_method_required', 'Online orders are on. Turn them off before clearing the online payment method.']],
  ['online_method_admin_only', ['write_rejected_online_method_admin_only', 'Only an administrator can change the online payment method.']],
  ['online_order_method_is_cash', ['write_rejected_online_order_method_is_cash', 'The online payment method cannot be a cash method. Add a separate method such as "ABA KHQR" and choose that.']],
  ['online_method_merge_refused', ['write_rejected_online_method_merge_refused', 'The online payment method cannot be merged with another method. Choose a different online method first.']],
  ['online_method_in_use_by_sales', ['write_rejected_online_method_in_use_by_sales', 'That payment method is already used by recent sales. Choose a method that only online orders will use, such as a separate "ABA KHQR".']],
])

/** The pack sentence for a coded refusal the Worker answers on a route that is not the settings save (the payment-method rename); null for any other code. */
export function codedRejectionText(error: unknown, t: WriteErrorTranslator): string | null {
  const code = (error as { code?: unknown } | null)?.code
  const detail = typeof code === 'string' ? REJECTION_DETAILS.get(code) : undefined
  return detail ? copy(t, detail[0], detail[1]) : null
}

function copy(t: WriteErrorTranslator, key: string, fallback: string): string {
  const translated = t(key)
  return translated && translated !== key ? translated : fallback
}

function timeoutSeconds(timeoutMs: unknown): number | null {
  const parsed = Number(timeoutMs)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.max(1, Math.round(parsed / 1000))
}

/**
 * Presents only stable, machine-readable write outcomes to the operator.
 * Server prose remains available in technical diagnostics, but it is not safe
 * to put untranslated or implementation-specific text in the global banner.
 */
export function presentWriteError(error: WriteErrorDetail, t: WriteErrorTranslator): WriteErrorPresentation {
  const code = String(error.code || '')
  const outcome = String(error.outcome || '')
  const unknownOutcome = outcome === 'unknown' || code === 'request_timeout' || code === 'write_outcome_unknown'

  if (unknownOutcome) {
    const seconds = timeoutSeconds(error.timeoutMs)
    const fallback = seconds === null
      ? 'The request did not finish. Its result may be unknown. Check the record before trying again.'
      : `The request timed out after ${seconds}s. It may have been processed. Check the record before trying again.`
    return {
      title: copy(t, 'write_outcome_unknown_title', 'Write result is unknown'),
      detail: copy(t, seconds === null ? 'write_outcome_unknown' : 'write_outcome_unknown_timeout', fallback).replace('{seconds}', String(seconds ?? '')),
      unknownOutcome: true,
    }
  }

  // N13: the Worker refuses a write that omits its request identity, or an expense /
  // promotion edit that omits the version it read (expected_updated_at). Both can only
  // come from an app build that predates the requirement, so both mean "reload the app".
  if (code === 'client_request_id_required' || code === 'expected_updated_at_required') {
    return {
      title: copy(t, 'write_failed_title', 'Write failed'),
      detail: copy(t, 'write_failed_app_out_of_date', 'This app is out of date. Restart or reload it, then try again.'),
      unknownOutcome: false,
    }
  }

  if (String(error.reason || '').startsWith('server_')) {
    return {
      title: copy(t, 'write_blocked_title', 'Write blocked'),
      detail: copy(t, 'write_server_unavailable', 'The server is unavailable. No new request was sent. Try again when it reconnects.'),
      unknownOutcome: false,
    }
  }

  const [detailKey, detailFallback] = REJECTION_DETAILS.get(code) ?? GENERIC_REJECTION_DETAIL
  return {
    title: copy(t, 'write_rejected_title', 'Write rejected'),
    detail: copy(t, detailKey, detailFallback),
    unknownOutcome: false,
  }
}
