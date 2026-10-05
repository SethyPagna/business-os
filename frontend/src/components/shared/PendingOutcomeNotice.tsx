import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import InfoHint from './InfoHint.tsx'

// Same cast Modal.tsx and SearchInput.tsx use: every admin surface sits under the one AppProvider.
const useApp = useAppHook as unknown as () => { t: (key: string) => string }

type PendingOutcomeNoticeProps = {
  /** Resends the exact original request. Omit when the surface cannot retry. */
  onRetry?: () => void
  /** Drops the stored request. The caller asks the owner to confirm first (a discard may throw away a write that did succeed). */
  onDiscard?: () => void
  /** Locks both icons while a retry or a save is running. */
  busy?: boolean
  /** One line. Defaults to "Previous save unconfirmed. Retry or discard." */
  message?: string
  /** The long explanation, kept behind an info icon instead of three lines of prose. */
  detail?: string
  className?: string
}

/**
 * "A previous write has an unknown outcome" -- one sentence, a Retry icon and a
 * Discard icon, each named by a translated tooltip that is also its aria-label.
 * The one banner for every surface that keeps a frozen request to retry; it
 * replaces nine hand-built copies that disagreed on wording, buttons and place.
 */
export default function PendingOutcomeNotice({ onRetry, onDiscard, busy = false, message, detail, className = '' }: PendingOutcomeNoticeProps) {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const retryLabel = tr('retry_original_request', 'Retry original request')
  const discardLabel = tr('discard_retry', 'Discard retry')
  const shortMessage = message ?? tr('write_pending_short', 'Previous save unconfirmed. Retry or discard.')
  const buttonClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/40'
  return (
    <div role="status" className={`flex min-w-0 items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 py-1 pl-3 pr-1 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 ${className}`.trim()}>
      <span className="min-w-0 flex-1 break-words">{shortMessage}</span>
      <InfoHint label={shortMessage} text={detail ?? tr('sale_bulk_pending', 'A previous request has an unknown outcome. Retry the original request or discard it before starting another.')} />
      {onRetry ? <button type="button" className={buttonClass} disabled={busy} onClick={onRetry} aria-label={retryLabel} title={retryLabel}><RefreshCw className="h-4 w-4" aria-hidden="true" /></button> : null}
      {onDiscard ? <button type="button" className={buttonClass} disabled={busy} onClick={onDiscard} aria-label={discardLabel} title={discardLabel}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}
    </div>
  )
}
