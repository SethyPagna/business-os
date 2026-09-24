import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import ResolveModal, { type ResolveDraft } from '../shared/ResolveModal.tsx'
import { contactMergeRequest, dismissContactDuplicateCluster, undismissContactDuplicateCluster, getContactDuplicateClusters, mergeContacts, planBulkContactMerges } from './contactDuplicates'
import type { ContactDuplicateCluster, ContactDuplicateSeverity, ContactTableKind } from './contactDuplicates'
import { contactHistoryParts, createContactResolveAdapter } from './contactResolveAdapter.ts'
import SaleLinkConflictsSection from './SaleLinkConflictsSection'
import { useApp } from '../../AppContext.tsx'
import PaginationControls, { DEFAULT_PAGE_SIZE, paginateItems } from '../shared/PaginationControls.tsx'
import {
  RESTORE_WORK_EVENT,
  consumePendingRestore,
  markRestoreHandled,
  minimizeWork,
  reparkDeniedRestore,
  type MinimizedWorkEntry,
} from '../../utils/minimizedWork.ts'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void

interface DuplicatesTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  includeSuppliers?: boolean
}

// The group open in the Resolve grid, and the choices a restored chip brings back.
type ResolveTarget = { table: ContactTableKind; cluster: ContactDuplicateCluster; draft?: ResolveDraft }
const TABLE_KINDS: ReadonlySet<string> = new Set<ContactTableKind>(['customers', 'suppliers', 'delivery_contacts'])

// Dismissals now persist server-side (routes/contacts.ts's POST
// .../duplicates/dismiss, backed by migrations/0034 -- see
// contactDuplicates.ts's dismissContactDuplicateCluster) instead of the
// old localStorage-only flag, so a dismissal made on one device/browser
// actually stays dismissed on another. The server already filters
// dismissed clusters out of GET .../duplicates itself (lib/
// contactDuplicates.ts's findDuplicateContactClusters), so this component
// no longer tracks dismissed ids locally at all -- Dismiss just removes
// the cluster from the list (optimistically, then confirmed by the next
// Refresh) instead of toggling a locally-remembered flag. There's no
// "show dismissed again" surface today (no GET .../duplicates?include=
// dismissed endpoint exists) -- a wrongly-dismissed cluster only comes
// back if the underlying records change enough to regroup it, same as
// any other cluster.

function clusterKey(table: ContactTableKind, cluster: ContactDuplicateCluster): string {
  return `${table}:${cluster.type}:${cluster.value}`
}

function replaceVars(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values?.[key] ?? ''))
}

// Same worst-first severity styling as DuplicateFlagBanner.tsx, applied to
// a whole-table sweep instead of a single live-typing check -- kept
// visually consistent so a "phone_conflict" cluster reads the same
// wherever it shows up in this feature.
const SEVERITY_STYLE: Record<ContactDuplicateSeverity, string> = {
  phone_conflict: 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30',
  exact_match: 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30',
  name_only: 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30',
}

// Fallbacks only -- the actual label always goes through t() with these as
// the English default (see SEVERITY_LABEL_KEY below). DuplicatesTab used
// to render these hardcoded strings directly and never touched its own
// `t` prop at all (declared in the props type, destructured out of the
// component, and never called anywhere in the file) -- every string here,
// including these severity labels, the table-switcher chips, and the
// header copy, always showed in English regardless of the app's selected
// language. Fixed by actually wiring `t` through.
const SEVERITY_LABEL_KEY: Record<ContactDuplicateSeverity, [string, string]> = {
  phone_conflict: ['duplicate_severity_phone_conflict', 'Phone conflict'],
  exact_match: ['duplicate_severity_exact_match', 'Likely duplicate'],
  name_only: ['duplicate_severity_name_only', 'Same name'],
}

const SEVERITY_TEXT: Record<ContactDuplicateSeverity, string> = {
  phone_conflict: 'text-red-700 dark:text-red-300',
  exact_match: 'text-amber-800 dark:text-amber-300',
  name_only: 'text-blue-700 dark:text-blue-300',
}

function ClusterCard({
  cluster, t, dismissing, selected, selectable, canResolveConflicts, canMergeDuplicates, onToggleSelect, onResolve, onDismiss, onReopen,
}: {
  cluster: ContactDuplicateCluster
  t: TranslateFn
  dismissing: boolean
  selected: boolean
  selectable: boolean
  canResolveConflicts: boolean
  canMergeDuplicates: boolean
  onToggleSelect: () => void
  onResolve: () => void
  onDismiss: () => void
  onReopen: () => void
}) {
  const [key, fallback] = SEVERITY_LABEL_KEY[cluster.severity]
  // Merging happens in the Resolve grid (one button per group, R12). Keeping a
  // group separate and reopening it use the shared review dialog, which shows
  // the state before and after instead of relying on a hidden second click.
  const [pendingAction, setPendingAction] = useState<{ kind: 'dismiss' } | { kind: 'reopen' } | null>(null)
  const busy = dismissing

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${SEVERITY_STYLE[cluster.severity]} ${busy ? 'opacity-60' : ''}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              disabled={busy}
              aria-label={t('select_duplicate_cluster') || 'Select this duplicate group'}
            />
          ) : null}
          <span className={`text-xs font-semibold ${SEVERITY_TEXT[cluster.severity]}`}>{t(key) || fallback}</span>
          {cluster.dismissed ? (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">{t('kept') || 'Kept'}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400">{cluster.type === 'phone' ? cluster.value : `"${cluster.value}"`}</span>
          {canResolveConflicts && cluster.dismissed ? (
            // A kept cluster is reopenable, never a one-way hide -- Reopen drops
            // the "not a duplicate" marker so it re-enters the open queue and
            // can be merged/resolved after all.
            <button
              type="button"
              onClick={() => setPendingAction({ kind: 'reopen' })}
              disabled={busy}
              title={t('reopen_duplicate') || 'Reopen -- put this back in the review queue to merge or resolve'}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('reopen') || 'Reopen'}
            </button>
          ) : canResolveConflicts ? (
            <button
              type="button"
              onClick={() => setPendingAction({ kind: 'dismiss' })}
              disabled={busy}
              title={t('dismiss_duplicate') || 'Dismiss -- I\'ve reviewed this, not actually a duplicate'}
              className="rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-gray-200"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="space-y-1">
        {cluster.contacts.map((contact) => (
          <div key={contact.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium text-gray-900 dark:text-white">{contact.name || `#${contact.id}`}</span>
            {contact.phone ? <span className="text-xs text-gray-500 dark:text-gray-400">{contact.phone}</span> : null}
            {contact.membershipNumber ? <span className="text-xs text-gray-400">{contact.membershipNumber}</span> : null}
            {/* Linked history at a glance: what Resolve moves onto the kept
                record (routes/contacts.ts repoints it), and why a raw delete of
                a record is not offered here: it would orphan it. Only counts
                above zero show, so a clean record stays uncluttered. */}
            {contactHistoryParts(contact.history, t).map((chip) => (
              <span key={chip} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500 dark:bg-white/10 dark:text-gray-400">{chip}</span>
            ))}
          </div>
        ))}
      </div>
      {canMergeDuplicates && cluster.contacts.length >= 2 ? (
        <div className="mt-2 flex justify-end border-t border-black/5 pt-1.5 dark:border-white/10">
          <button
            type="button"
            onClick={onResolve}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium leading-5 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
          >
            <Merge className="h-3.5 w-3.5" />
            {t('resolve') || 'Resolve'}
          </button>
        </div>
      ) : null}
      {pendingAction ? (
        <ConfirmDialog
          title={pendingAction.kind === 'dismiss'
            ? (t('confirm_keep') || 'Confirm keep separate')
            : (t('confirm_reopen') || 'Confirm reopen')}
          message={pendingAction.kind === 'dismiss'
            ? (t('keep_review_message') || 'These records will remain separate and leave the review queue.')
            : (t('reopen_review_message') || 'This group will return to the review queue.')}
          items={pendingAction.kind === 'dismiss'
            ? [
                { label: t('before') || 'Before', value: t('needs_review') || 'Needs review' },
                { label: t('after') || 'After', value: t('kept_separate') || 'Kept as separate records' },
              ]
            : [
                { label: t('before') || 'Before', value: t('kept_separate') || 'Kept as separate records' },
                { label: t('after') || 'After', value: t('needs_review') || 'Needs review' },
              ]}
          confirmLabel={pendingAction.kind === 'dismiss' ? (t('keep') || 'Keep separate') : (t('reopen') || 'Reopen')}
          working={busy}
          onConfirm={() => {
            if (pendingAction.kind === 'dismiss') onDismiss()
            else onReopen()
            setPendingAction(null)
          }}
          onClose={() => setPendingAction(null)}
          t={t}
        />
      ) : null}
    </div>
  )
}

export default function DuplicatesTab({ t, notify, active = true, includeSuppliers = true }: DuplicatesTabProps) {
  const { can } = useApp() as { can: (permissionKey: string, actionKey: string) => boolean }
  const canResolveConflicts = can('contacts', 'resolve_conflicts')
  const canBulkContacts = can('contacts', 'bulk')
  const canBulkContactsRef = useRef(canBulkContacts)
  canBulkContactsRef.current = canBulkContacts
  const canMergeDuplicates = canBulkContacts && canResolveConflicts && can('contacts', 'merge')
  const canMergeDuplicatesRef = useRef(canMergeDuplicates)
  canMergeDuplicatesRef.current = canMergeDuplicates
  const tRef = useRef(t)
  tRef.current = t
  // Supplier privacy (Part 383 R2): without the contacts_suppliers grant
  // the supplier duplicates scan isn't offered (its endpoint would 403
  // server-side anyway).
  const TABLES: { id: ContactTableKind; label: string }[] = [
    { id: 'customers', label: t('customers') || 'Customers' },
    ...(includeSuppliers ? [{ id: 'suppliers' as ContactTableKind, label: t('suppliers') || 'Suppliers' }] : []),
    { id: 'delivery_contacts', label: t('delivery_contacts_tab') || 'Delivery Contacts' },
  ]
  const [table, setTable] = useState<ContactTableKind>('customers')
  // The tab is "Conflicts" now (user direction, Aug 31), not just
  // duplicates -- this flag switches to its fourth section, sale-link
  // conflicts, which has its own component and data source.
  const [saleLinksActive, setSaleLinksActive] = useState(false)
  const [clusters, setClusters] = useState<ContactDuplicateCluster[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<ContactDuplicateSeverity | 'all'>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  // Reveal already-kept (dismissed) clusters alongside the open queue so a
  // wrongly-kept conflict can be reopened and resolved -- "keep" is never a
  // one-way hide. Off by default (the queue leads with what still needs a
  // decision); flipping it re-fetches with includeDismissed.
  const [showKept, setShowKept] = useState(false)
  // Keyed by clusterKey() -- which single cluster card is mid-dismiss or
  // mid-reopen, so only that one card shows a busy state instead of
  // disabling the whole grid for one action.
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  // Multi-select for bulk actions -- keyed by clusterKey(), same identity
  // dismissingId already uses. Cleared on table switch and after any bulk
  // action completes (selections referencing a now-gone cluster are
  // meaningless).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // The group open in the Resolve grid. wroteRef: a merge step committed, so
  // the list is out of date even when a later step stopped.
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const wroteRef = useRef(false)

  useEffect(() => {
    if (!canBulkContacts) setSelectedKeys(new Set())
  }, [canBulkContacts])

  // Losing the merge grant closes the grid; the adapter asks again right
  // before it writes, for a grant lost between this render and the click.
  useEffect(() => {
    if (!canMergeDuplicates) setResolving(null)
  }, [canMergeDuplicates])

  const load = async (targetTable: ContactTableKind, includeDismissed: boolean) => {
    setLoading(true)
    try {
      const result = await getContactDuplicateClusters(targetTable, { includeDismissed })
      setClusters(result)
      setLoaded(true)
    } catch {
      notify(t('could_not_load_duplicates') || 'Could not load possible duplicates', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!active) return
    void load(table, showKept)
    setSelectedKeys(new Set())
    // Re-runs on table switch AND when "Show kept" flips (that toggle needs a
    // fresh sweep to pull the dismissed clusters in). Deliberately NOT on
    // every `active` flip -- this is a manual-refresh review panel (see the
    // Refresh button), not a live-synced list like the other three tabs, so
    // re-fetching every time the page regains focus would be wasted work for
    // data that only changes when someone actually edits a contact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, showKept])

  // Removes a cluster from the current table's list without a full
  // reload -- used after both Dismiss (the cluster is gone from GET
  // .../duplicates from now on) and Merge (the cluster's underlying
  // records no longer exist as separate rows, so it can't regroup as-is
  // either). A stray edge case either action can't account for locally
  // (a third record joining the same phone/name right after) just waits
  // for the next Refresh, same as any other manual-refresh review list.
  const removeCluster = (id: string) => {
    setClusters((current) => current.filter((cluster) => clusterKey(table, cluster) !== id))
    setSelectedKeys((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const handleDismiss = async (cluster: ContactDuplicateCluster) => {
    const id = clusterKey(table, cluster)
    setDismissingId(id)
    try {
      await dismissContactDuplicateCluster(table, { type: cluster.type, value: cluster.value })
      removeCluster(id)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('dismiss_duplicate_failed') || 'Could not dismiss this duplicate'), 'error')
    } finally {
      setDismissingId(null)
    }
  }

  // Reopen a kept cluster -- drops the dismissal marker so it re-enters the
  // open review queue. Flipped in place (dismissed:false) rather than removed,
  // so it stays visible with its full merge/dismiss actions right where the
  // reviewer is looking; the "Kept" badge and Reopen action swap back to a
  // normal open cluster. Only reachable from the "Show kept" view.
  const handleReopen = async (cluster: ContactDuplicateCluster) => {
    const id = clusterKey(table, cluster)
    setDismissingId(id)
    try {
      await undismissContactDuplicateCluster(table, { type: cluster.type, value: cluster.value })
      setClusters((current) => current.map((c) => (clusterKey(table, c) === id ? { ...c, dismissed: false } : c)))
      notify(t('duplicate_reopened') || 'Reopened -- back in the review queue')
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('reopen_duplicate_failed') || 'Could not reopen this cluster'), 'error')
    } finally {
      setDismissingId(null)
    }
  }

  // Resolve (R12): the group opens in the shared Resolve grid, one column per
  // record, and the grid sends ONE merge request naming every field's value.
  const openResolve = useCallback((target: ContactTableKind, cluster: ContactDuplicateCluster, draft?: ResolveDraft) => {
    if (!canMergeDuplicatesRef.current) return
    wroteRef.current = false
    setResolving({ table: target, cluster, draft })
  }, [])

  const resolveAdapter = useMemo(() => (resolving ? createContactResolveAdapter({
    table: resolving.table,
    cluster: resolving.cluster,
    t: (key) => tRef.current(key),
    canMerge: () => canMergeDuplicatesRef.current,
    onWritten: () => { wroteRef.current = true },
  }) : null), [resolving])
  const resolveName = resolving ? (resolving.cluster.contacts.find((contact) => contact.name?.trim())?.name ?? resolving.cluster.value) : ''
  const resolveTitle = `${t('resolve') || 'Resolve'} — ${resolveName}`

  const closeResolve = () => {
    const wrote = wroteRef.current
    wroteRef.current = false
    setResolving(null)
    if (wrote) void load(table, showKept)
  }

  // Minimize parks the grid as a chip carrying the group and the choices made
  // so far. Restoring reads the records again, so the grid never shows a
  // parked copy of them.
  const parkResolve = (draft: ResolveDraft) => {
    if (!resolving) return
    minimizeWork({
      key: `contact_resolve:${clusterKey(resolving.table, resolving.cluster)}`,
      kind: 'contact_resolve',
      pageId: 'contacts',
      anchor: 'hub:contacts:duplicates',
      label: resolveTitle,
      payload: { table: resolving.table, cluster: resolving.cluster, draft },
      requiredPermission: { permissionKey: 'contacts', actionKey: 'merge' },
    })
    closeResolve()
  }

  const restoreResolve = useCallback((entry: MinimizedWorkEntry): boolean => {
    const parked = entry.payload as Partial<ResolveTarget> | undefined
    if (!parked?.table || !TABLE_KINDS.has(parked.table) || !Array.isArray(parked.cluster?.contacts)) return false
    if (!canMergeDuplicatesRef.current || (parked.table === 'suppliers' && !includeSuppliers)) {
      reparkDeniedRestore(entry)
      notify(t('access_denied') || 'Access denied', 'warning')
      return false
    }
    setSaleLinksActive(false)
    setTable(parked.table)
    openResolve(parked.table, parked.cluster, parked.draft)
    return true
  }, [includeSuppliers, notify, openResolve, t])

  // A chip restored before this tab mounted waits as pending; one restored
  // while it is mounted arrives as the event.
  useEffect(() => {
    const pending = consumePendingRestore('contact_resolve')
    if (pending && restoreResolve(pending)) markRestoreHandled('contact_resolve')
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.kind !== 'contact_resolve' || !detail.entry) return
      if (restoreResolve(detail.entry as MinimizedWorkEntry)) markRestoreHandled('contact_resolve')
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
  }, [restoreResolve])

  const toggleSelected = (id: string) => {
    if (!canBulkContactsRef.current) return
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Bulk Dismiss -- the one bulk action with no per-cluster ambiguity
  // (unlike merge/delete, dismissing never touches a specific contact
  // record, just a "reviewed, not a duplicate" flag on the cluster
  // itself), so it's always available regardless of cluster size.
  // Continues past individual failures (a cluster whose dismiss call
  // fails just stays in the list, reported once at the end) rather than
  // aborting the whole batch on the first error.
  const bulkDismiss = async () => {
    if (!canBulkContactsRef.current) return
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(table, cluster)))
    if (!targets.length) return
    setBulkBusy(true)
    let failed = 0
    for (const cluster of targets) {
      if (!canBulkContactsRef.current) break
      const id = clusterKey(table, cluster)
      try {
        await dismissContactDuplicateCluster(table, { type: cluster.type, value: cluster.value })
        removeCluster(id)
      } catch {
        failed += 1
      }
    }
    setBulkBusy(false)
    setSelectedKeys(new Set())
    if (failed) {
      notify(replaceVars(t('bulk_dismiss_partial_failure') || '{count} of the selected duplicates could not be dismissed', { count: failed }), 'error')
    } else {
      notify(t('bulk_dismiss_success') || 'Dismissed the selected duplicates')
    }
  }

  // Bulk Merge -- P3-9: runs on a cluster of ANY size, not just exactly two.
  // The old two-only rule left the exact clusters this action exists for
  // untouched: production holds a ten-row and a six-row supplier cluster minted
  // by a hidden writer, identical apart from their ids, and Bulk Merge refused
  // all sixteen rows. planBulkContactMerges() states the survivor rule (the one
  // member with a phone, else the lowest id) instead of guessing, and Resolve
  // on each card still overrides it by hand, field by field.
  //
  // Each group is ONE merge request, so it lands whole or not at all. A group
  // past the six-record limit merges its first six now and stays listed for
  // the next run; a group holding two membership numbers or two storefront
  // accounts needs a person to choose, so it is counted and left for Resolve.
  const bulkMerge = async () => {
    if (!canBulkContactsRef.current || !canMergeDuplicates) return
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(table, cluster)))
    if (!targets.length) return
    const plans = planBulkContactMerges(targets)
    const skipped = targets.length - plans.length
    setBulkBusy(true)
    let failed = 0
    let needsResolve = 0
    let moreLeft = 0
    let staleList = false
    for (const plan of plans) {
      if (!canBulkContactsRef.current) break
      try {
        await mergeContacts(table, contactMergeRequest(plan.cluster, plan.keeperId, plan.loserIds))
        if (plan.laterIds.length) moreLeft += 1
        else removeCluster(clusterKey(table, plan.cluster))
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        if (code === 'membership_choice_required' || code === 'portal_choice_required') needsResolve += 1
        else failed += 1
        if (code === 'contact_merge_conflict') staleList = true
      }
    }
    setBulkBusy(false)
    setSelectedKeys(new Set())
    // A partly merged group lists records that are gone now, and a refused one
    // was read before somebody changed it: read the groups again, so the next
    // run sends the records as they are.
    if (moreLeft || staleList) void load(table, showKept)
    if (failed || skipped || needsResolve || moreLeft) {
      const parts = []
      if (failed) parts.push(replaceVars(t('bulk_merge_partial_failure') || '{count} could not be merged', { count: failed }))
      if (needsResolve) parts.push(replaceVars(t('bulk_merge_needs_resolve') || '{count} group(s) need Resolve to choose the membership number or storefront account', { count: needsResolve }))
      if (moreLeft) parts.push(replaceVars(t('bulk_merge_more_left') || '{count} group(s) still have records to merge; run Merge selected again', { count: moreLeft }))
      // Only a degenerate cluster (nothing left to merge into) can land here
      // now; it is still counted out loud rather than dropped silently.
      if (skipped) parts.push(replaceVars(t('bulk_merge_skipped_single') || '{count} group(s) had nothing left to merge', { count: skipped }))
      notify(parts.join('. '), failed ? 'error' : 'info')
    } else {
      notify(t('bulk_merge_success') || 'Merged the selected duplicates')
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleClusters = useMemo(() => clusters.filter((cluster) => {
    if (severityFilter !== 'all' && cluster.severity !== severityFilter) return false
    if (!normalizedSearch) return true
    const haystack = [
      cluster.value,
      ...cluster.contacts.flatMap((c) => [c.name, c.phone, c.membershipNumber]),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(normalizedSearch)
  }), [clusters, normalizedSearch, severityFilter])
  const pagedClusters = useMemo(
    () => paginateItems(visibleClusters, page, pageSize),
    [page, pageSize, visibleClusters],
  )

  useEffect(() => { setPage(1) }, [normalizedSearch, severityFilter, showKept, table])

  const counts = useMemo(() => {
    const result = { phone_conflict: 0, exact_match: 0, name_only: 0 }
    for (const cluster of clusters) {
      result[cluster.severity] += 1
    }
    return result
  }, [clusters])

  const activeTableLabel = TABLES.find((entry) => entry.id === table)?.label || ''

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {TABLES.map((entry) => (
          <button
            key={entry.id}
            onClick={() => { setSaleLinksActive(false); setTable(entry.id) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              !saleLinksActive && table === entry.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <button
          onClick={() => setSaleLinksActive(true)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            saleLinksActive
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
          }`}
        >
          {t('link_conflicts_section') || 'Sale links'}
        </button>
        {saleLinksActive ? null : (
          <button
            onClick={() => void load(table, showKept)}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-900/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('refresh') || 'Refresh'}
          </button>
        )}
      </div>

      {saleLinksActive ? <SaleLinkConflictsSection t={t} notify={notify} /> : (
      <>
      <p className="text-xs text-gray-400">
        {replaceVars(t('duplicates_tab_hint') || 'Groups of {table} that share a phone number or an exact name, most often from records entered before duplicate checking existed. Press Resolve to merge a group\'s records into one.', {
          table: activeTableLabel.toLowerCase(),
        })}
      </p>

      {/* Filter row -- search across name/phone/membership number, plus a
          severity chip filter. Both are purely client-side over the
          already-loaded cluster list (each table's cluster count is small
          enough that a second round trip per keystroke would be wasted
          work). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_duplicates_placeholder') || 'Filter by name or phone...'}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-100"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'phone_conflict', 'exact_match', 'name_only'] as const).map((severity) => {
            const [key, fallback] = severity === 'all' ? ['all_severities', 'All'] : SEVERITY_LABEL_KEY[severity]
            return (
              <button
                key={severity}
                onClick={() => setSeverityFilter(severity)}
                className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                  severityFilter === severity
                    ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
                }`}
              >
                {t(key) || fallback}
              </button>
            )
          })}
        </div>
        {/* Reveal kept (dismissed) clusters so they can be reopened -- keeping
            a conflict is reversible, never a one-way hide. */}
        <button
          type="button"
          onClick={() => setShowKept((v) => !v)}
          title={t('show_kept_hint') || 'Show clusters you kept (marked not-a-duplicate) so they can be reopened'}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
            showKept
              ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
          }`}
        >
          <RotateCcw className="h-3 w-3" />
          {t('show_kept') || 'Show kept'}
        </button>
      </div>

      {loading && !loaded ? (
        <div className="py-8 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
      ) : clusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t('no_possible_duplicates_found') || 'No possible duplicates found.'}
        </div>
      ) : visibleClusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t('no_duplicates_match_filter') || 'No duplicates match this filter.'}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            {counts.phone_conflict > 0 ? (
              <span className="text-red-600 dark:text-red-400">
                {counts.phone_conflict} {(t(SEVERITY_LABEL_KEY.phone_conflict[0]) || SEVERITY_LABEL_KEY.phone_conflict[1]).toLowerCase()}{counts.phone_conflict === 1 ? '' : 's'}
              </span>
            ) : null}
            {counts.exact_match > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                {counts.exact_match} {(t(SEVERITY_LABEL_KEY.exact_match[0]) || SEVERITY_LABEL_KEY.exact_match[1]).toLowerCase()}{counts.exact_match === 1 ? '' : 's'}
              </span>
            ) : null}
            {counts.name_only > 0 ? (
              <span>{counts.name_only} {(t(SEVERITY_LABEL_KEY.name_only[0]) || SEVERITY_LABEL_KEY.name_only[1]).toLowerCase()}</span>
            ) : null}
            {canBulkContacts && canResolveConflicts ? <button
              type="button"
              onClick={() => setSelectedKeys(new Set(pagedClusters.map((cluster) => clusterKey(table, cluster))))}
              disabled={bulkBusy || !pagedClusters.length}
              className="ml-auto text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline dark:text-blue-400"
            >
              {t('select_all') || 'Select all'}
            </button> : null}
            {canBulkContacts && selectedKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                disabled={bulkBusy}
                className="text-gray-500 hover:underline disabled:opacity-50 dark:text-gray-400"
              >
                {t('clear_selection') || 'Clear selection'}
              </button>
            ) : null}
          </div>

          {canBulkContacts && canResolveConflicts && selectedKeys.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/30">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                {replaceVars(t('duplicates_bulk_selected_count') || '{count} selected', { count: selectedKeys.size })}
              </span>
              {canMergeDuplicates ? (
                <button
                  type="button"
                  onClick={() => void bulkMerge()}
                  disabled={bulkBusy}
                  className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  <Merge className="mr-1 inline h-3.5 w-3.5" />
                  {bulkBusy ? (t('saving') || 'Saving...') : (t('duplicates_bulk_merge_action') || 'Merge selected')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void bulkDismiss()}
                disabled={bulkBusy}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <EyeOff className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('saving') || 'Saving...') : (t('duplicates_bulk_dismiss_action') || 'Dismiss selected')}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pagedClusters.map((cluster) => {
              const id = clusterKey(table, cluster)
              return (
                <ClusterCard
                  key={id}
                  cluster={cluster}
                  t={t}
                  dismissing={dismissingId === id}
                  selected={canBulkContacts && selectedKeys.has(id)}
                  selectable={canBulkContacts && canResolveConflicts && !bulkBusy}
                  canResolveConflicts={canResolveConflicts}
                  canMergeDuplicates={canMergeDuplicates}
                  onToggleSelect={() => toggleSelected(id)}
                  onResolve={() => openResolve(table, cluster)}
                  onDismiss={() => void handleDismiss(cluster)}
                  onReopen={() => void handleReopen(cluster)}
                />
              )
            })}
          </div>
          <PaginationControls
            compact
            rangeAsPageSize
            page={page}
            pageSize={pageSize}
            totalItems={visibleClusters.length}
            onPageChange={setPage}
            onPageSizeChange={(next) => { setPageSize(next); setPage(1) }}
            label={t('conflicts') || 'conflicts'}
            t={t}
            className="justify-center"
          />
        </>
      )}
      </>
      )}
      {resolving && resolveAdapter ? (
        <ResolveModal
          key={clusterKey(resolving.table, resolving.cluster)}
          title={resolveTitle}
          adapter={resolveAdapter}
          initialDraft={resolving.draft}
          onClose={closeResolve}
          onMinimize={parkResolve}
        />
      ) : null}
    </div>
  )
}
