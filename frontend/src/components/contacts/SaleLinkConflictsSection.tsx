import { useEffect, useRef, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Link2 from 'lucide-react/dist/esm/icons/link-2.js'
import UserPlus from 'lucide-react/dist/esm/icons/user-round-plus.js'
import { fmtDate } from '../../utils/formatters'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../shared/PaginationControls'
import {
  dismissSaleLinkConflict, undismissSaleLinkConflict, getSaleLinkConflicts, relinkConflictSales, resolveMissingContact,
} from './contactDuplicates'
import type { SaleLinkConflicts, SaleLinkMismatch, SaleLinkMissing } from './contactDuplicates'
import { useApp } from '../../AppContext.tsx'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

// The Conflicts tab's fourth section (user direction, Aug 31): sale-link
// conflicts, so link problems live beside duplicate problems in ONE place.
// Two kinds, both computed live by GET /customers/link-conflicts:
// - mismatch: a sale is linked to a customer whose phone differs from the
//   phone printed on the sale (the legacy name-links could attach the
//   wrong person). Offers a relink when the sale's phone identifies
//   exactly one other contact; Keep-current dismisses the group.
// - missing: sales carry a customer name/phone that matches no contact.
//   Offers Create-and-link (or Link-to-existing when the phone now
//   matches exactly one contact); Ignore dismisses the group.
// Writes are Full-Access-gated server-side; dismissals persist in the
// 0034 dismissal ledger under this feature's own cluster types.

function replaceVars(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values?.[key] ?? ''))
}

const mismatchKey = (row: SaleLinkMismatch): string => `${row.customer_id}|${row.phone_key}`
const missingKey = (row: SaleLinkMissing): string => `${row.name.toLowerCase()}|${row.phone_key}`

export default function SaleLinkConflictsSection({ t, notify }: { t: TranslateFn; notify: NotifyFn }) {
  const { can } = useApp() as { can: (permissionKey: string, actionKey: string) => boolean }
  const canResolveConflicts = can('contacts', 'resolve_conflicts')
  const tr = (key: string, fallback: string): string => t(key) || fallback
  const [data, setData] = useState<SaleLinkConflicts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // key of the card whose action awaits its confirming second tap.
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Reveal kept-as-is (dismissed) groups so they can be reopened -- keeping a
  // conflict is reversible, never a one-way hide. Off by default; flipping it
  // re-fetches with includeDismissed.
  const [showKept, setShowKept] = useState(false)
  const [mismatchPage, setMismatchPage] = useState(1)
  const [missingPage, setMissingPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const load = async (includeDismissed: boolean) => {
    setLoading(true)
    setError('')
    try {
      const result = await getSaleLinkConflicts({ includeDismissed, mismatchPage, missingPage, pageSize })
      if (aliveRef.current) {
        setData(result)
        const mismatchLast = result.pagination?.mismatches.totalPages || 1
        const missingLast = result.pagination?.missing.totalPages || 1
        if (mismatchPage > mismatchLast) setMismatchPage(mismatchLast)
        if (missingPage > missingLast) setMissingPage(missingLast)
      }
    } catch (e: unknown) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : tr('link_conflicts_failed', 'Could not load sale-link conflicts'))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }
  useEffect(() => { void load(showKept) }, [showKept, mismatchPage, missingPage, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const dropMismatch = (key: string) => setData((current) => (current ? { ...current, mismatches: current.mismatches.filter((row) => mismatchKey(row) !== key) } : current))
  const dropMissing = (key: string) => setData((current) => (current ? { ...current, missing: current.missing.filter((row) => missingKey(row) !== key) } : current))

  const handleRelink = async (row: SaleLinkMismatch) => {
    const key = mismatchKey(row)
    if (pendingKey !== key) { setPendingKey(key); return }
    setPendingKey(null)
    setBusyKey(key)
    try {
      const result = await relinkConflictSales({ customer_id: row.customer_id, phone_key: row.phone_key, target_customer_id: Number(row.suggested_id) })
      notify(replaceVars(tr('sales_relinked_toast', 'Relinked {count} sale(s)'), { count: result?.relinked ?? row.sale_count }))
      dropMismatch(key)
      void load(showKept)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('link_conflicts_failed', 'Could not load sale-link conflicts'), 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const handleResolveMissing = async (row: SaleLinkMissing) => {
    const key = missingKey(row)
    if (pendingKey !== key) { setPendingKey(key); return }
    setPendingKey(null)
    setBusyKey(key)
    const linkExisting = row.phone_owner_count === 1 && row.suggested_id != null
    try {
      const result = await resolveMissingContact({
        name: row.name, phone: row.phone, phone_key: row.phone_key,
        ...(linkExisting ? { target_customer_id: Number(row.suggested_id) } : {}),
      })
      notify(replaceVars(
        result?.created
          ? tr('contact_created_linked_toast', 'Contact created — {count} sale(s) linked')
          : tr('sales_linked_toast', 'Linked {count} sale(s)'),
        { count: result?.linked ?? row.sale_count },
      ))
      dropMissing(key)
      void load(showKept)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('link_conflicts_failed', 'Could not load sale-link conflicts'), 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const handleDismiss = async (kind: 'mismatch' | 'missing', key: string) => {
    setBusyKey(key)
    try {
      await dismissSaleLinkConflict(kind, key)
      if (kind === 'mismatch') dropMismatch(key)
      else dropMissing(key)
      void load(showKept)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('link_conflicts_failed', 'Could not load sale-link conflicts'), 'error')
    } finally {
      setBusyKey(null)
    }
  }

  // Reopen a kept group -- drop the keep marker and flip it back to open in
  // place (dismissed:0), so it stays visible with its resolve/relink actions.
  // Only reachable from the "Show kept" view.
  const handleReopen = async (kind: 'mismatch' | 'missing', key: string) => {
    setBusyKey(key)
    try {
      await undismissSaleLinkConflict(kind, key)
      setData((current) => {
        if (!current) return current
        if (kind === 'mismatch') return { ...current, mismatches: current.mismatches.map((row) => (mismatchKey(row) === key ? { ...row, dismissed: 0 } : row)) }
        return { ...current, missing: current.missing.map((row) => (missingKey(row) === key ? { ...row, dismissed: 0 } : row)) }
      })
      notify(tr('duplicate_reopened', 'Reopened -- back in the review queue'))
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : tr('reopen_duplicate_failed', 'Could not reopen this cluster'), 'error')
    } finally {
      setBusyKey(null)
    }
  }

  const money = (value: unknown): string => `$${(Number(value) || 0).toFixed(2)}`
  const mismatches = data?.mismatches || []
  const missing = data?.missing || []

  const groupMeta = (row: { sale_count: number; total_usd: number; first_at: string; last_at: string }): string => {
    const range = row.first_at === row.last_at ? fmtDate(row.first_at) : `${fmtDate(row.first_at)} – ${fmtDate(row.last_at)}`
    return `${row.sale_count} × ${money(row.total_usd)} · ${range}`
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-gray-400">
          {tr('link_conflicts_hint', 'Sales whose customer link disagrees with the phone printed on the receipt, and sales naming a customer that has no contact record. Resolve or dismiss each group.')}
        </p>
        <button
          type="button"
          onClick={() => {
            setMismatchPage(1)
            setMissingPage(1)
            setShowKept((v) => !v)
          }}
          title={tr('show_kept_hint', 'Show clusters you kept (marked not-a-duplicate) so they can be reopened')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
            showKept
              ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
          }`}
        >
          <RotateCcw className="h-3 w-3" />
          {tr('show_kept', 'Show kept')}
        </button>
        <button
          onClick={() => void load(showKept)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-900/20"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {tr('refresh', 'Refresh')}
        </button>
      </div>

      {data?.pagination ? (
        <div className="flex flex-wrap items-center gap-2">
          <PaginationControls
            page={data.pagination.mismatches.page}
            pageSize={data.pagination.pageSize}
            totalItems={data.pagination.mismatches.total}
            onPageChange={setMismatchPage}
            onPageSizeChange={(next) => { setPageSize(next); setMismatchPage(1); setMissingPage(1) }}
            label={tr('link_mismatches', 'link mismatches')}
            t={t}
            compact
            rangeAsPageSize
          />
          <PaginationControls
            page={data.pagination.missing.page}
            pageSize={data.pagination.pageSize}
            totalItems={data.pagination.missing.total}
            onPageChange={setMissingPage}
            onPageSizeChange={(next) => { setPageSize(next); setMismatchPage(1); setMissingPage(1) }}
            label={tr('missing_contacts', 'missing contacts')}
            t={t}
            compact
            rangeAsPageSize
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-gray-400">{tr('loading', 'Loading...')}</div>
      ) : mismatches.length === 0 && missing.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-zinc-700">
          {tr('link_conflicts_empty', 'No sale-link conflicts found.')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {mismatches.map((row) => {
            const key = mismatchKey(row)
            const busy = busyKey === key
            const pending = pendingKey === key
            const suggestion = row.phone_owner_count === 1 && row.suggested_id != null && row.suggested_id !== row.customer_id
            return (
              <div key={`mm-${key}`} className={`rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30 ${busy ? 'opacity-60' : ''}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">{tr('link_mismatch_title', 'Phone differs from linked contact')}</span>
                    {row.dismissed ? <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">{tr('kept', 'Kept')}</span> : null}
                  </div>
                  {canResolveConflicts && row.dismissed ? (
                    <button
                      type="button"
                      onClick={() => void handleReopen('mismatch', key)}
                      disabled={busy}
                      title={tr('reopen_duplicate', 'Reopen -- put this back in the review queue to merge or resolve')}
                      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {tr('reopen', 'Reopen')}
                    </button>
                  ) : canResolveConflicts ? (
                    <button
                      type="button"
                      onClick={() => void handleDismiss('mismatch', key)}
                      disabled={busy}
                      title={tr('keep_current_link', 'Keep current link')}
                      className="rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-gray-200"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="space-y-0.5 text-sm">
                  <div className="font-medium text-gray-900 dark:text-white">{row.sale_name || row.sale_phone}
                    <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">{row.sale_phone}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{groupMeta(row)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {tr('linked_to', 'Linked to')}: <span className="font-medium text-gray-700 dark:text-gray-200">{row.customer_name || `#${row.customer_id}`}</span>
                    {row.customer_phone ? ` · ${row.customer_phone}` : ''}
                  </div>
                  {suggestion ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {replaceVars(tr('phone_belongs_to', 'This phone belongs to {name}'), { name: `${row.suggested_name || `#${row.suggested_id}`}` })}
                    </div>
                  ) : null}
                </div>
                {canResolveConflicts && suggestion ? (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => void handleRelink(row)}
                      disabled={busy}
                      title={pending ? replaceVars(tr('relink_confirm_hint', 'Tap again to confirm — these sales will link to {name}'), { name: row.suggested_name || '' }) : undefined}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                        pending ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
                      }`}
                    >
                      <Link2 className="h-3 w-3" />
                      {pending
                        ? tr('confirm', 'Confirm')
                        : replaceVars(tr('relink_sales_action', 'Relink {count} sale(s)'), { count: row.sale_count })}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}

          {missing.map((row) => {
            const key = missingKey(row)
            const busy = busyKey === key
            const pending = pendingKey === key
            const linkExisting = row.phone_owner_count === 1 && row.suggested_id != null
            return (
              <div key={`ms-${key}`} className={`rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/40 dark:bg-blue-950/30 ${busy ? 'opacity-60' : ''}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{tr('link_missing_title', 'No matching contact')}</span>
                    {row.dismissed ? <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">{tr('kept', 'Kept')}</span> : null}
                  </div>
                  {canResolveConflicts && row.dismissed ? (
                    <button
                      type="button"
                      onClick={() => void handleReopen('missing', key)}
                      disabled={busy}
                      title={tr('reopen_duplicate', 'Reopen -- put this back in the review queue to merge or resolve')}
                      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {tr('reopen', 'Reopen')}
                    </button>
                  ) : canResolveConflicts ? (
                    <button
                      type="button"
                      onClick={() => void handleDismiss('missing', key)}
                      disabled={busy}
                      title={tr('ignore_group', 'Ignore')}
                      className="rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-gray-200"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="space-y-0.5 text-sm">
                  <div className="font-medium text-gray-900 dark:text-white">{row.name || row.phone}
                    {row.phone ? <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">{row.phone}</span> : null}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{groupMeta(row)}</div>
                  {linkExisting ? (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {replaceVars(tr('phone_belongs_to', 'This phone belongs to {name}'), { name: `${row.suggested_name || `#${row.suggested_id}`}` })}
                    </div>
                  ) : null}
                </div>
                {canResolveConflicts ? <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => void handleResolveMissing(row)}
                    disabled={busy}
                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      pending ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
                    }`}
                  >
                    {linkExisting ? <Link2 className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
                    {pending
                      ? tr('confirm', 'Confirm')
                      : linkExisting
                        ? replaceVars(tr('link_to_existing_action', 'Link to {name}'), { name: row.suggested_name || '' })
                        : replaceVars(tr('create_and_link_action', 'Create contact & link {count} sale(s)'), { count: row.sale_count })}
                  </button>
                </div> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
