import { useEffect, useMemo, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import ArrowRightCircle from 'lucide-react/dist/esm/icons/arrow-right-circle.js'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { dismissContactDuplicateCluster, getContactDuplicateClusters, mergeContacts } from './contactDuplicates'
import type { ContactDuplicateCluster, ContactDuplicateClusterEntry, ContactDuplicateSeverity, ContactTableKind } from './contactDuplicates'
import { deleteCustomer, deleteSupplier, deleteDeliveryContact } from '../../api/contactWriteTransport'

type TranslateFn = (key: string) => string | undefined
type NotifyFn = (message: string, tone?: string) => void
// This page's own tab ids (Contacts.tsx) differ from ContactTableKind
// (contactDuplicates.ts / the API) only in the delivery-contacts case --
// 'delivery_contacts' there vs 'delivery' here. TABLE_TO_TAB below is the
// one place that mapping happens.
type ContactTabId = 'customers' | 'suppliers' | 'delivery' | 'duplicates'

interface DuplicatesTabProps {
  t: TranslateFn
  notify: NotifyFn
  active?: boolean
  onResolve?: (tab: ContactTabId, name: string) => void
  includeSuppliers?: boolean
}

const TABLE_TO_TAB: Record<ContactTableKind, ContactTabId> = {
  customers: 'customers',
  suppliers: 'suppliers',
  delivery_contacts: 'delivery',
}

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

const DELETE_BY_TABLE: Record<ContactTableKind, (id: number | string) => Promise<unknown>> = {
  customers: deleteCustomer,
  suppliers: deleteSupplier,
  delivery_contacts: deleteDeliveryContact,
}

function ClusterCard({
  cluster, t, table, dismissing, merging, deletingId, selected, selectable, onToggleSelect, onResolve, onDismiss, onMergeInto, onDelete,
}: {
  cluster: ContactDuplicateCluster
  t: TranslateFn
  table: ContactTableKind
  dismissing: boolean
  merging: boolean
  deletingId: number | null
  selected: boolean
  selectable: boolean
  onToggleSelect: () => void
  onResolve: (name: string) => void
  onDismiss: () => void
  onMergeInto: (keeper: ContactDuplicateClusterEntry) => void
  onDelete: (contact: ContactDuplicateClusterEntry) => void
}) {
  const [key, fallback] = SEVERITY_LABEL_KEY[cluster.severity]
  // Which contact is about to be kept, once the person has picked one --
  // a second tap on the SAME contact confirms the merge; tapping a
  // different one (or Cancel) restarts the choice. Deliberately a local
  // two-tap confirm rather than a separate modal: a merge here only ever
  // acts on ids the panel already fetched moments ago, no extra context
  // to show that a modal would add.
  const [pendingKeeperId, setPendingKeeperId] = useState<number | null>(null)
  // Same two-tap pattern for delete -- outright removing a record (not a
  // merge) needs its own confirm step since there's no "undo" here.
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const busy = dismissing || merging || deletingId != null

  const clickMerge = (contact: ContactDuplicateClusterEntry) => {
    setPendingDeleteId(null)
    if (pendingKeeperId === contact.id) {
      onMergeInto(contact)
      setPendingKeeperId(null)
    } else {
      setPendingKeeperId(contact.id)
    }
  }

  const clickDelete = (contact: ContactDuplicateClusterEntry) => {
    setPendingKeeperId(null)
    if (pendingDeleteId === contact.id) {
      onDelete(contact)
      setPendingDeleteId(null)
    } else {
      setPendingDeleteId(contact.id)
    }
  }

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
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-gray-400">{cluster.type === 'phone' ? cluster.value : `"${cluster.value}"`}</span>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            title={t('dismiss_duplicate') || 'Dismiss -- I\'ve reviewed this, not actually a duplicate'}
            className="rounded-lg p-1 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {cluster.contacts.map((contact) => {
          const isPendingKeeper = pendingKeeperId === contact.id
          return (
            <div key={contact.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium text-gray-900 dark:text-white">{contact.name || `#${contact.id}`}</span>
                {contact.phone ? <span className="text-xs text-gray-500 dark:text-gray-400">{contact.phone}</span> : null}
                {contact.membershipNumber ? <span className="text-xs text-gray-400">{contact.membershipNumber}</span> : null}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                {cluster.contacts.length >= 2 ? (
                  <button
                    type="button"
                    onClick={() => clickMerge(contact)}
                    disabled={busy}
                    title={isPendingKeeper
                      ? (t('merge_confirm_hint') || 'Tap again to confirm -- the other record(s) will be merged into this one and deleted')
                      : (t('merge_into_hint') || 'Keep this one, merge the other(s) into it')}
                    className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${
                      isPendingKeeper
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
                    }`}
                  >
                    <Merge className="h-3 w-3" />
                    {merging && isPendingKeeper
                      ? (t('merging') || 'Merging...')
                      : isPendingKeeper
                        ? (t('confirm') || 'Confirm')
                        : (t('keep_this_one') || 'Keep this')}
                  </button>
                ) : null}
                {contact.name ? (
                  <button
                    type="button"
                    onClick={() => onResolve(contact.name as string)}
                    title={t('resolve_duplicate_hint') || `Open ${table} filtered to this name to edit by hand`}
                    className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-blue-600 transition hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <ArrowRightCircle className="h-3 w-3" />
                    {t('resolve') || 'Resolve'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => clickDelete(contact)}
                  disabled={busy}
                  title={pendingDeleteId === contact.id
                    ? (t('delete_confirm_hint') || 'Tap again to permanently delete this record')
                    : (t('delete_duplicate_hint') || 'Permanently delete this record (no merge)')}
                  className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${
                    pendingDeleteId === contact.id
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                  {deletingId === contact.id
                    ? (t('deleting') || 'Deleting...')
                    : pendingDeleteId === contact.id
                      ? (t('confirm') || 'Confirm')
                      : (t('delete') || 'Delete')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DuplicatesTab({ t, notify, active = true, onResolve, includeSuppliers = true }: DuplicatesTabProps) {
  // Supplier privacy (Part 383 R2): without the contacts_suppliers grant
  // the supplier duplicates scan isn't offered (its endpoint would 403
  // server-side anyway).
  const TABLES: { id: ContactTableKind; label: string }[] = [
    { id: 'customers', label: t('customers') || 'Customers' },
    ...(includeSuppliers ? [{ id: 'suppliers' as ContactTableKind, label: t('suppliers') || 'Suppliers' }] : []),
    { id: 'delivery_contacts', label: t('delivery_contacts_tab') || 'Delivery Contacts' },
  ]
  const [table, setTable] = useState<ContactTableKind>('customers')
  const [clusters, setClusters] = useState<ContactDuplicateCluster[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<ContactDuplicateSeverity | 'all'>('all')
  // Keyed by clusterKey() -- which single cluster card is mid-dismiss or
  // mid-merge, so only that one card shows a busy state instead of
  // disabling the whole grid for one action.
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [mergingId, setMergingId] = useState<string | null>(null)
  // Which single contact id is mid-delete, scoped inside whichever cluster
  // card that belongs to -- deletingClusterId gates the busy state on the
  // right card, deletingContactId is what ClusterCard checks per-row.
  const [deletingClusterId, setDeletingClusterId] = useState<string | null>(null)
  const [deletingContactId, setDeletingContactId] = useState<number | null>(null)
  // Multi-select for bulk actions -- keyed by clusterKey(), same identity
  // dismissingId/mergingId already use. Cleared on table switch and after
  // any bulk action completes (selections referencing a now-gone cluster
  // are meaningless).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = async (targetTable: ContactTableKind) => {
    setLoading(true)
    try {
      const result = await getContactDuplicateClusters(targetTable)
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
    void load(table)
    setSelectedKeys(new Set())
    // Intentionally only re-runs on table switch, not every `active` flip --
    // this is a manual-refresh review panel (see the Refresh button), not a
    // live-synced list like the other three tabs, so re-fetching every time
    // the page regains focus would be wasted work for data that only
    // changes when someone actually edits a contact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

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

  // After deleting one contact out of a cluster, drop just that contact
  // from the cluster's list -- if that leaves fewer than 2 contacts, the
  // cluster no longer represents an actual duplicate, so remove it
  // entirely instead of showing a single lonely record.
  const removeContactFromCluster = (id: string, contactId: number) => {
    setClusters((current) => current
      .map((cluster) => (clusterKey(table, cluster) === id
        ? { ...cluster, contacts: cluster.contacts.filter((contact) => contact.id !== contactId) }
        : cluster))
      .filter((cluster) => cluster.contacts.length >= 2))
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

  // Merges every OTHER contact in the cluster into the chosen `keeper`,
  // one mergeContacts() call per record (the API only takes one keep/merge
  // pair at a time -- see contactDuplicates.ts) -- almost always exactly
  // one call since most clusters have two contacts, but this also covers
  // a rarer 3+ way cluster the same way. Stops and surfaces the error on
  // the first failed merge rather than silently leaving some records
  // merged and others not with no indication which.
  const handleMergeInto = async (cluster: ContactDuplicateCluster, keeper: ContactDuplicateClusterEntry) => {
    const others = cluster.contacts.filter((contact) => contact.id !== keeper.id)
    if (!others.length) return
    const id = clusterKey(table, cluster)
    setMergingId(id)
    try {
      for (const other of others) {
        await mergeContacts(table, keeper.id, other.id)
      }
      notify(t('duplicate_merged') || 'Merged -- the other record(s) were combined into this one')
      removeCluster(id)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('merge_duplicate_failed') || 'Could not merge these records'), 'error')
    } finally {
      setMergingId(null)
    }
  }

  // Outright delete of one record in a cluster -- distinct from Merge:
  // nothing is kept from the deleted record, and the other contact(s) in
  // the cluster are untouched. For when one side is just wrong/spurious
  // data rather than genuinely the same contact as another record.
  const handleDelete = async (cluster: ContactDuplicateCluster, contact: ContactDuplicateClusterEntry) => {
    const id = clusterKey(table, cluster)
    setDeletingClusterId(id)
    setDeletingContactId(contact.id)
    try {
      await DELETE_BY_TABLE[table](contact.id)
      notify(t('duplicate_deleted') || 'Deleted')
      removeContactFromCluster(id, contact.id)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : (t('delete_duplicate_failed') || 'Could not delete this record'), 'error')
    } finally {
      setDeletingClusterId(null)
      setDeletingContactId(null)
    }
  }

  const toggleSelected = (id: string) => {
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
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(table, cluster)))
    if (!targets.length) return
    setBulkBusy(true)
    let failed = 0
    for (const cluster of targets) {
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

  // Bulk Merge -- only safe to automate for exactly-2-contact clusters,
  // where "keep the older record" (lower id, i.e. created first) is an
  // unambiguous, defensible default. A 3+-way cluster genuinely needs a
  // human to pick which one survives (see ClusterCard's per-row "Keep
  // this" flow), so those are skipped here and left for individual
  // resolution rather than guessing at a keeper.
  const bulkMerge = async () => {
    const targets = clusters.filter((cluster) => selectedKeys.has(clusterKey(table, cluster)))
    if (!targets.length) return
    const mergeable = targets.filter((cluster) => cluster.contacts.length === 2)
    const skipped = targets.length - mergeable.length
    setBulkBusy(true)
    let failed = 0
    for (const cluster of mergeable) {
      const id = clusterKey(table, cluster)
      const [first, second] = [...cluster.contacts].sort((a, b) => a.id - b.id)
      try {
        await mergeContacts(table, first.id, second.id)
        removeCluster(id)
      } catch {
        failed += 1
      }
    }
    setBulkBusy(false)
    setSelectedKeys(new Set())
    if (failed || skipped) {
      const parts = []
      if (failed) parts.push(replaceVars(t('bulk_merge_partial_failure') || '{count} could not be merged', { count: failed }))
      if (skipped) parts.push(replaceVars(t('bulk_merge_skipped_multiway') || '{count} group(s) with 3+ records were skipped -- merge those individually', { count: skipped }))
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
            onClick={() => setTable(entry.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              table === entry.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <button
          onClick={() => void load(table)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-900/20"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh') || 'Refresh'}
        </button>
      </div>

      <p className="text-xs text-gray-400">
        {replaceVars(t('duplicates_tab_hint') || 'Groups of {table} that share a phone number or an exact name -- most often from records entered before duplicate checking existed. This is a review list only; edit or merge the records from the {table} tab.', {
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
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set(visibleClusters.map((cluster) => clusterKey(table, cluster))))}
              disabled={bulkBusy || !visibleClusters.length}
              className="ml-auto text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline dark:text-blue-400"
            >
              {t('select_all') || 'Select all'}
            </button>
            {selectedKeys.size > 0 ? (
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

          {selectedKeys.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/30">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                {replaceVars(t('duplicates_bulk_selected_count') || '{count} selected', { count: selectedKeys.size })}
              </span>
              <button
                type="button"
                onClick={() => void bulkMerge()}
                disabled={bulkBusy}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-50"
              >
                <Merge className="mr-1 inline h-3.5 w-3.5" />
                {bulkBusy ? (t('saving') || 'Saving...') : (t('duplicates_bulk_merge_action') || 'Merge selected')}
              </button>
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
            {visibleClusters.map((cluster) => {
              const id = clusterKey(table, cluster)
              return (
                <ClusterCard
                  key={id}
                  cluster={cluster}
                  t={t}
                  table={table}
                  dismissing={dismissingId === id}
                  merging={mergingId === id}
                  deletingId={deletingClusterId === id ? deletingContactId : null}
                  selected={selectedKeys.has(id)}
                  selectable={!bulkBusy}
                  onToggleSelect={() => toggleSelected(id)}
                  onResolve={(name) => onResolve?.(TABLE_TO_TAB[table], name)}
                  onDismiss={() => void handleDismiss(cluster)}
                  onMergeInto={(keeper) => void handleMergeInto(cluster, keeper)}
                  onDelete={(contact) => void handleDelete(cluster, contact)}
                />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
