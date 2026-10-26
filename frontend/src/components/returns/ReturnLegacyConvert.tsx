// 6.0.992: the screens and API calls for "Convert to current format" (helpers/returnLegacyConvert.ts holds the pure rules).
//   useLegacyReturnConvert -- preview -> shared compact confirm dialog (before/after per return) -> apply. One hook, used
//                             by the Edit Return lock panel, the list row and the bulk bar, so all three say the same.
//   ReturnLegacyLockPanel  -- replaces the Edit Return form for a locked return: the reason, then Convert (admin) or
//                             "an admin can review and convert it" (everyone else).
//   ReturnLegacyLockTag    -- the list row's lock icon with the reason; for an admin, the Convert button (same RefreshCcw
//                             icon as the panel and the bulk bar).
import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import { businessDateTimeId } from '../../utils/timestampId.ts'
import { apiFetch, confirmServerReachable } from '../../api/http.ts'
import {
  legacyConvertAccess,
  legacyConvertFailureText,
  legacyConvertReasonText,
  type LegacyConvertPreview,
  type LegacyConvertResult,
  type LegacyConvertRow,
} from './helpers/returnLegacyConvert.ts'

type Translate = (key: string, fallback: string) => string
type NotifyFn = (message: string, type?: string) => void
type MoneyFormatter = (value: number | string) => string
const useApp = useAppHook as () => { user?: unknown; t?: (key: string) => string | undefined; fmtUSD?: MoneyFormatter; fmtKHR?: MoneyFormatter }

export type LegacyLockReturn = {
  id: number | string
  return_number?: string | null
  total_refund_usd?: number | string | null
  money_precision_version?: unknown
  sale_money_precision_version?: unknown
  return_scope?: unknown
}

export async function previewLegacyConvert(returnIds: number[]): Promise<LegacyConvertPreview> {
  return apiFetch('POST', '/api/returns/legacy-convert/preview', { return_ids: returnIds }) as Promise<LegacyConvertPreview>
}

// Online only, like the bulk return action: the write is guarded against the sale's live revision, so a replay from an
// offline queue could never be the change the admin reviewed.
export async function applyLegacyConvert(returnIds: number[], digest: string, requestId: string): Promise<LegacyConvertResult> {
  if (navigator.onLine === false && !(await confirmServerReachable())) throw new Error('Connect to the server before converting returns.')
  return apiFetch('POST', '/api/returns/legacy-convert', { return_ids: returnIds, expected_digest: digest, client_request_id: requestId }) as Promise<LegacyConvertResult>
}

function useTranslate(): Translate {
  const { t } = useApp()
  return useCallback((key: string, fallback: string) => {
    const value = typeof t === 'function' ? t(key) : undefined
    return value && value !== key ? value : fallback
  }, [t])
}

export function useLegacyReturnConvert({ notify, onConverted }: { notify: NotifyFn; onConverted?: (ids: number[]) => void }) {
  const { t, fmtUSD, fmtKHR } = useApp()
  const T = useTranslate()
  const { askToConfirm, confirmDialog } = useConfirmDialog(t as never)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const usd = (value: number) => (fmtUSD ? fmtUSD(value) : `$${value.toFixed(2)}`)
  const khr = (value: number) => (fmtKHR ? fmtKHR(value) : `${Math.round(value)} ៛`)

  /** Resolves to the refusal text when nothing could be converted, null otherwise (converted, cancelled or failed). */
  const startConvert = useCallback(async (ids: number[]): Promise<string | null> => {
    if (busyRef.current || !ids.length) return null
    busyRef.current = true
    setBusy(true)
    try {
      const preview = await previewLegacyConvert(ids)
      const convertible = preview.rows.filter((row) => row.outcome === 'convert')
      const refused = preview.rows.filter((row) => row.outcome === 'refused')
      if (!convertible.length) {
        const reason = refused.length
          ? legacyConvertReasonText(refused[0].code, refused[0].params, T, { usd, khr })
          : T('return_convert_nothing', 'Already in the current format. Nothing to convert.')
        notify(reason, refused.length ? 'error' : 'info')
        return refused.length ? reason : null
      }
      const describe = (row: LegacyConvertRow): ReactNode => {
        const lines = row.lines.map((line) => `${usd(line.before_total_usd)} → ${usd(line.after_total_usd ?? line.before_total_usd)}`).join(', ')
        const riel = row.after && row.after.total_refund_khr !== row.before.total_refund_khr
          ? ` · ${khr(row.before.total_refund_khr)} → ${khr(row.after.total_refund_khr)}`
          : ` · ${khr(row.before.total_refund_khr)}`
        return `${usd(row.total_refund_usd)}${riel}${row.lines.length ? ` (${lines})` : ''}`
      }
      const confirmed = await askToConfirm({
        title: T('return_convert_title', 'Convert to current format'),
        message: T('return_convert_message', 'Refunds, cash, debt, stock and report totals stay the same. Undo is in History.'),
        items: [
          ...convertible.map((row) => ({ label: row.return_number || `#${row.id}`, value: describe(row) })),
          ...refused.map((row) => ({ label: row.return_number || `#${row.id}`, value: legacyConvertReasonText(row.code, row.params, T, { usd, khr }) })),
        ],
        // The riel figure of a dollar refund may be restated at the sale's rate (a current-format return must carry it); say so when it moves.
        note: [
          convertible.some((row) => row.after && row.after.total_refund_khr !== row.before.total_refund_khr)
            ? T('return_convert_riel_note', 'The riel figure of a dollar refund is restated at the sale rate, as shown. No riel cash changes.') : '',
          refused.length ? T('return_convert_partial_note', "Returns that can't be converted stay as they are.") : '',
        ].filter(Boolean).join(' ') || undefined,
        confirmLabel: T('return_convert_action', 'Convert'),
      })
      if (!confirmed) return null
      const requestId = `return-convert-${businessDateTimeId()}-${Math.random().toString(36).slice(2, 10)}`
      const result = await applyLegacyConvert(ids, preview.digest, requestId)
      notify(T('return_convert_done', 'Converted. Undo is in History.'), 'success')
      onConverted?.(result.converted)
      return null
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || '')
      notify(legacyConvertFailureText(code, T), 'error')
      return null
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [T, askToConfirm, notify, onConverted, usd, khr])

  return { startConvert, busy, dialog: confirmDialog }
}

export function ReturnLegacyLockPanel({ ret, onClose, fmtUSD, notify, onConverted }: {
  ret: LegacyLockReturn; onClose: () => void; fmtUSD: MoneyFormatter; notify: NotifyFn; onConverted?: () => void
}) {
  const { user } = useApp()
  const T = useTranslate()
  const access = legacyConvertAccess(ret, user as never)
  const [refusal, setRefusal] = useState<string | null>(null)
  const { startConvert, busy, dialog } = useLegacyReturnConvert({ notify, onConverted: () => { onConverted?.(); onClose() } })
  return createPortal(
    <div className="modal-viewport-safe fixed inset-0 z-[1050] flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label={T('edit_return', 'Edit Return')} data-return-legacy-lock={access || ''}
        className="modal-panel-safe w-full rounded-t-2xl bg-white p-4 dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{T('edit_return', 'Edit Return')}{ret.return_number ? ` · ${ret.return_number}` : ''}</h2>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-700"
            onClick={onClose} aria-label={T('close', 'Close')} title={T('close', 'Close')}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <p className="my-3 flex items-start gap-2 text-sm leading-relaxed" role="status">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>{T('return_legacy_lock_reason', 'This return was saved in an older money format than its sale, so it cannot be edited as it is.')}</span>
        </p>
        <div className="mb-3 flex justify-between text-sm"><span>{T('refund', 'Refund')}</span><span>{fmtUSD(Number(ret.total_refund_usd) || 0)}</span></div>
        {refusal ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200" role="alert">{refusal}</p> : null}
        {access === 'convert' ? (
          <button type="button" className="btn-primary inline-flex w-full items-center justify-center gap-1.5" disabled={busy}
            onClick={() => { void startConvert([Number(ret.id)]).then(setRefusal) }} title={T('return_convert_title', 'Convert to current format')}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />{T('return_convert_action', 'Convert')}
          </button>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">{T('return_convert_admin_only', 'An admin can review and convert it.')}</p>
        )}
      </div>
      {dialog}
    </div>, document.body,
  )
}

/** The list row's lock: a reason tooltip for everyone; for an admin, an icon-only Convert button. */
export function ReturnLegacyLockTag({ ret, onConvert }: { ret: LegacyLockReturn; onConvert?: (id: number) => void }) {
  const { user } = useApp()
  const T = useTranslate()
  const access = legacyConvertAccess(ret, user as never)
  if (!access) return null
  const reason = T('return_legacy_lock_reason', 'This return was saved in an older money format than its sale, so it cannot be edited as it is.')
  if (access === 'convert' && onConvert) {
    const label = `${reason} ${T('return_convert_title', 'Convert to current format')}`
    return (
      <button type="button" data-return-legacy-lock="convert" aria-label={label} title={label}
        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        onClick={(event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onConvert(Number(ret.id)) }}>
        <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )
  }
  const label = `${reason} ${T('return_convert_admin_only', 'An admin can review and convert it.')}`
  return (
    <span data-return-legacy-lock="reason_only" role="img" aria-label={label} title={label}
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}
