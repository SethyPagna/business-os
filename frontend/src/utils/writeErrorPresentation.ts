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

  if (code === 'client_request_id_required') {
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

  return {
    title: copy(t, 'write_rejected_title', 'Write rejected'),
    detail: copy(t, 'write_rejected_details', 'The server did not accept this change. View details to check the reason.'),
    unknownOutcome: false,
  }
}
