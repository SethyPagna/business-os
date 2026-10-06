import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LinkIcon from 'lucide-react/dist/esm/icons/link.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import { useApp as useAppHook } from '../../../AppContext.tsx'
import SearchInput from '../../shared/SearchInput.tsx'
import PaginationControls, { DEFAULT_PAGE_SIZE } from '../../shared/PaginationControls.tsx'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../../shared/ConflictIcon.ts'
import { useDebouncedValue } from '../../../utils/useDebouncedValue.ts'
import type { PermissionUser } from '../../../utils/permissions.ts'
import {
  listLinkRequests,
  listMembers,
  type MemberFilter,
  type MemberLinkRequest,
  type MemberList,
  type StaffMember,
} from '../../../api/portalMembersTransport.ts'
import {
  PORTAL_MEMBER_LINKS_PERMISSION,
  SIGNUP_SETTING_KEY,
  customerHidden,
  customerLabel,
  isSignupSwitchOn,
  linkStateOf,
  memberActions,
  memberReadErrorText,
  memberFilters,
  memberIdLabel,
  memberText,
  memberViewer,
  type MemberAction,
} from './memberModel.ts'
import { ChipBadge, IconAction, phoneLabel, type MemberT } from './memberUi.tsx'
import { RejectDialog, ResetDialog, StatusDialog, TempPasswordFloat, UnlinkDialog } from './MemberActionDialogs.tsx'
import MemberDetailFloat from './MemberDetailFloat.tsx'
import MemberHistoryFloat from './MemberHistoryFloat.tsx'
import MemberLinkFloat from './MemberLinkFloat.tsx'
import MemberRequestsSection from './MemberRequestsSection.tsx'
import MemberSignupFloat from './MemberSignupFloat.tsx'

// Contacts > Members: website accounts (W- ids), separate from in-store
// customers. Staff link, unlink, change or move the link to a customer with an
// identity check, and every change is a history row that can be reverted. The
// Worker is the security boundary (routes/portalMembers.ts); what this screen
// decides is which control a viewer is offered (memberModel.ts).

type NotifyFn = (message: string, tone?: string) => void

interface AppContextValue {
  can: (permissionKey: string, actionKey: string) => boolean
  hasPermission: (key: string) => boolean
  user?: PermissionUser
  settings: Record<string, unknown>
  saveSettings: (settings: Record<string, unknown>) => Promise<unknown>
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

const useApp = useAppHook as unknown as () => AppContextValue

interface Props {
  t: MemberT
  notify: NotifyFn
  active?: boolean
  initialSearch?: string
}

type Dialog =
  | { kind: 'link'; id: number; request: MemberLinkRequest | null }
  | { kind: 'history'; id: number }
  | { kind: 'unlink'; id: number }
  | { kind: 'status'; id: number; mode: 'suspend' | 'reactivate' }
  | { kind: 'reset'; id: number }
  | { kind: 'password'; id: number; password: string }
  | { kind: 'reject'; request: MemberLinkRequest }
  | { kind: 'signup' }

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5]

function MemberRow({ member, viewer, t, onOpen, onLink }: {
  member: StaffMember
  viewer: ReturnType<typeof memberViewer>
  t: MemberT
  onOpen: () => void
  onLink: () => void
}) {
  const hidden = customerHidden(member, viewer)
  const state = linkStateOf(member)
  const canLink = memberActions(member, viewer).includes('link')
  const linkText = member.customer
    ? customerLabel(member.customer)
    : hidden && state !== 'not_linked'
      ? memberText(t, 'pm_customer_hidden', 'Customer hidden')
      : memberText(t, 'pm_not_linked', 'Not linked')
  return (
    <li data-member-row={member.id} className="flex items-center gap-1 pr-1 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 px-3 py-2 text-left">
        {/* Phone: name and chip on the first line, id and phone under it, the link last.
            Desktop: all five on ONE row. Khmer needs line room, hence leading-relaxed. */}
        <span className="grid grid-cols-[minmax(0,1fr),auto] items-center gap-x-3 gap-y-0.5 leading-relaxed md:grid-cols-[9.5rem,minmax(0,1.2fr),8.5rem,6.5rem,minmax(0,1.4fr)]">
          <span className="col-span-2 row-start-2 truncate font-mono text-[11px] text-gray-500 dark:text-gray-400 md:col-span-1 md:col-start-1 md:row-start-1">
            {memberIdLabel(member)}
            <span className="md:hidden">{member.phone ? ` · ${phoneLabel(member.phone)}` : ''}</span>
          </span>
          <span className="col-start-1 row-start-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100 md:col-start-2">{member.name || '—'}</span>
          <span className="hidden truncate text-xs text-gray-600 dark:text-gray-300 md:col-start-3 md:row-start-1 md:block">{phoneLabel(member.phone)}</span>
          <span className="col-start-2 row-start-1 justify-self-end md:col-start-4 md:justify-self-start"><ChipBadge chip={member.chip} t={t} /></span>
          <span className="col-span-2 row-start-3 flex min-w-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 md:col-span-1 md:col-start-5 md:row-start-1">
            {member.conflicts.length && !hidden ? <ConflictIcon className={`h-3.5 w-3.5 shrink-0 ${CONFLICT_ICON_CLASS}`} aria-hidden="true" /> : null}
            <span data-member-link-state={state} className="min-w-0 truncate">{linkText}</span>
            {member.pendingRequest ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{memberText(t, 'pm_in_review', 'In review')}</span>
            ) : null}
          </span>
        </span>
      </button>
      {canLink ? (
        <button
          type="button"
          data-member-row-link=""
          onClick={onLink}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 sm:text-sm"
        >
          <LinkIcon className="h-4 w-4 shrink-0" />
          <span>{memberText(t, 'pm_act_link', 'Link')}</span>
        </button>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-zinc-600" aria-hidden="true" />
    </li>
  )
}

export default function MembersTab({ t, notify, active = true, initialSearch }: Props) {
  const { can, hasPermission, user, settings, saveSettings, fmtUSD, fmtKHR } = useApp()
  const allowed = hasPermission(PORTAL_MEMBER_LINKS_PERMISSION)
  const viewer = useMemo(() => memberViewer(user, can), [user, can])
  const filters = useMemo(() => memberFilters(viewer), [viewer])

  const [filter, setFilter] = useState<MemberFilter>('all')
  const [search, setSearch] = useState(initialSearch || '')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<MemberList | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [requests, setRequests] = useState<MemberLinkRequest[] | null>(null)
  const [requestsError, setRequestsError] = useState('')
  const [known, setKnown] = useState<Record<number, StaffMember>>({})
  const [detailId, setDetailId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const loadToken = useRef(0)
  // Only error text needs the translator; a language switch must not refetch the list.
  const tRef = useRef(t)
  tRef.current = t
  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const remember = useCallback((members: StaffMember[]) => {
    if (!members.length) return
    setKnown((current) => {
      const next = { ...current }
      for (const member of members) next[member.id] = member
      return next
    })
  }, [])

  // The newest copy of a member wins: a result or a refusal replaces what the list held.
  const resolve = useCallback((id: number): StaffMember | null => (
    known[id] ?? list?.items.find((item) => item.id === id) ?? requests?.find((request) => request.member.id === id)?.member ?? null
  ), [known, list, requests])

  const load = useCallback(async (silent = false) => {
    if (filter === 'requests') return
    const token = ++loadToken.current
    if (!silent) setLoading(true)
    setLoadError('')
    try {
      const result = await listMembers({ filter, q: debouncedSearch, limit: DEFAULT_PAGE_SIZE, offset: (page - 1) * DEFAULT_PAGE_SIZE })
      if (token !== loadToken.current) return
      setList(result)
      remember(result.items)
    } catch (error) {
      if (token === loadToken.current) setLoadError(memberReadErrorText(error, tRef.current))
    } finally {
      if (token === loadToken.current) setLoading(false)
    }
  }, [filter, debouncedSearch, page, remember])

  const loadRequests = useCallback(async () => {
    setRequestsError('')
    try {
      const result = await listLinkRequests('pending')
      setRequests(result)
      remember(result.map((request) => request.member))
    } catch (error) {
      setRequestsError(memberReadErrorText(error, tRef.current))
    }
  }, [remember])

  useEffect(() => { if (active && allowed) void load() }, [active, allowed, load])
  useEffect(() => { if (active && allowed) void loadRequests() }, [active, allowed, loadRequests])

  const refresh = useCallback(() => { void load(true); void loadRequests() }, [load, loadRequests])

  const choose = (next: MemberFilter) => { setFilter(next); setPage(1) }
  const onSearch = (value: string) => { setSearch(value); setPage(1) }

  const onRefusal = useCallback((error: unknown) => {
    const member = (error as { member?: StaffMember | null } | null)?.member
    if (member && typeof member.id === 'number') remember([member])
  }, [remember])

  const changed = useCallback((member: StaffMember, messageKey: string, fallback: string) => {
    remember([member])
    setDialog(null)
    notify(memberText(t, messageKey, fallback))
    refresh()
  }, [notify, refresh, remember, t])

  const runAction = (member: StaffMember, action: MemberAction) => {
    if (action === 'link' || action === 'relink') setDialog({ kind: 'link', id: member.id, request: null })
    else if (action === 'unlink') setDialog({ kind: 'unlink', id: member.id })
    else if (action === 'history') setDialog({ kind: 'history', id: member.id })
    else if (action === 'suspend' || action === 'reactivate') setDialog({ kind: 'status', id: member.id, mode: action })
    else if (action === 'reset') setDialog({ kind: 'reset', id: member.id })
  }

  if (!allowed) {
    return <div data-members-forbidden="" className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">{memberText(t, 'pm_err_forbidden', 'You need the "Approve member links" permission.')}</div>
  }

  const detail = detailId != null ? resolve(detailId) : null
  const dialogMember = dialog && 'id' in dialog ? resolve(dialog.id) : null
  const rows = list?.items ?? []
  const filtered = search.trim() !== '' || filter !== 'all'
  const requestCount = requests?.length ?? 0
  const signupOn = isSignupSwitchOn(settings?.[SIGNUP_SETTING_KEY])

  return (
    <div className="space-y-2" data-members-tab="">
      <div className="sticky top-2 z-30 -mx-1 space-y-2 bg-gray-50 pb-2 pt-1 dark:bg-gray-900 sm:mx-0">
        <div className="flex min-w-0 items-center gap-2">
          <SearchInput
            id="member-search"
            name="member_search"
            value={search}
            onChange={onSearch}
            placeholder={viewer.seesCustomers
              ? memberText(t, 'pm_search_ph_lc', 'Search W- id, name, phone, LC number')
              : memberText(t, 'pm_search_ph', 'Search W- id, name, phone')}
            className="min-w-0 max-w-md flex-1"
          />
          {viewer.canToggleSignup ? (
            <IconAction id="signup" label={memberText(t, 'pm_signup_title', 'Website sign-up')} icon={Settings2} onClick={() => setDialog({ kind: 'signup' })} />
          ) : null}
        </div>
        <div role="group" aria-label={memberText(t, 'filters', 'Filters')} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {filters.map((option) => {
            const selected = filter === option.id
            return (
              <button
                key={option.id}
                type="button"
                data-member-filter={option.id}
                aria-pressed={selected}
                onClick={() => choose(option.id)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium leading-relaxed ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-gray-200'}`}
              >
                <span>{memberText(t, option.key, option.fallback)}</span>
                {option.id === 'requests' && requestCount > 0 ? (
                  <span data-member-requests-count="" className={`rounded-full px-1.5 text-[10px] font-semibold ${selected ? 'bg-white/25 text-white' : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'}`}>{requestCount}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {filter === 'requests' ? (
        <MemberRequestsSection
          requests={requests}
          error={requestsError}
          viewer={viewer}
          t={t}
          onApprove={(request) => setDialog({ kind: 'link', id: request.member.id, request })}
          onReject={(request) => setDialog({ kind: 'reject', request })}
          onRetry={() => { void loadRequests() }}
        />
      ) : (
        <>
          {loadError ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
              <span className="min-w-0">{loadError}</span>
              <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => { void load() }}>{memberText(t, 'retry', 'Retry')}</button>
            </div>
          ) : null}
          {loading && !list ? (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-zinc-800 dark:border-zinc-700" aria-busy="true">
              {SKELETON_ROWS.map((row) => (
                <li key={row} className="animate-pulse px-3 py-3">
                  <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="mt-2 h-3 w-24 rounded bg-slate-100 dark:bg-slate-800" />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            !loadError ? (
              <div data-members-empty="" className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">
                {filtered ? memberText(t, 'pm_empty_filtered', 'No matching members') : memberText(t, 'pm_empty', 'No members')}
              </div>
            ) : null
          ) : (
            <ul className={`divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/40 ${loading ? 'opacity-70' : ''}`}>
              {rows.map((member) => {
                const current = resolve(member.id) ?? member
                return (
                  <MemberRow
                    key={member.id}
                    member={current}
                    viewer={viewer}
                    t={t}
                    onOpen={() => setDetailId(member.id)}
                    onLink={() => setDialog({ kind: 'link', id: member.id, request: null })}
                  />
                )
              })}
            </ul>
          )}
          <PaginationControls
            compact
            rangeAsPageSize
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={list?.total ?? 0}
            onPageChange={setPage}
            label={memberText(t, 'pm_members', 'Members')}
            t={t}
            className="justify-center"
          />
        </>
      )}

      {detail ? (
        <MemberDetailFloat member={detail} viewer={viewer} t={t} onClose={() => setDetailId(null)} onAction={(action) => runAction(detail, action)} />
      ) : null}

      {dialog?.kind === 'link' && dialogMember ? (
        <MemberLinkFloat
          member={dialogMember}
          viewer={viewer}
          request={dialog.request}
          t={t}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onDone={(member) => changed(member, dialog.request ? 'pm_done_approved' : 'pm_done_link', dialog.request ? 'Approved' : 'Linked')}
        />
      ) : null}
      {dialog?.kind === 'history' && dialogMember ? (
        <MemberHistoryFloat
          member={dialogMember}
          viewer={viewer}
          t={t}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onChanged={(member) => { remember([member]); notify(memberText(t, 'pm_done_revert', 'Reverted')); refresh() }}
        />
      ) : null}
      {dialog?.kind === 'unlink' && dialogMember ? (
        <UnlinkDialog member={dialogMember} viewer={viewer} t={t} onClose={() => setDialog(null)} onRefusal={onRefusal} onDone={(result) => changed((result as { member: StaffMember }).member, 'pm_done_unlink', 'Unlinked')} />
      ) : null}
      {dialog?.kind === 'status' && dialogMember ? (
        <StatusDialog
          member={dialogMember}
          mode={dialog.mode}
          t={t}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onDone={(result) => changed((result as { member: StaffMember }).member, dialog.mode === 'suspend' ? 'pm_done_suspend' : 'pm_done_reactivate', dialog.mode === 'suspend' ? 'Suspended' : 'Reactivated')}
        />
      ) : null}
      {dialog?.kind === 'reset' && dialogMember ? (
        <ResetDialog
          member={dialogMember}
          viewer={viewer}
          t={t}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onDone={(result) => { setDialog({ kind: 'password', id: dialogMember.id, password: (result as { temporaryPassword: string }).temporaryPassword }); refresh() }}
        />
      ) : null}
      {dialog?.kind === 'password' && dialogMember ? (
        <TempPasswordFloat password={dialog.password} member={dialogMember} t={t} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'reject' ? (
        <RejectDialog request={dialog.request} t={t} onClose={() => setDialog(null)} onRefusal={onRefusal} onDone={() => { setDialog(null); notify(memberText(t, 'pm_done_reject', 'Rejected')); refresh() }} />
      ) : null}
      {dialog?.kind === 'signup' ? (
        <MemberSignupFloat on={signupOn} t={t} saveSettings={saveSettings} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  )
}
