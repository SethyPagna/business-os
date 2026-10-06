import { useCallback, useEffect, useState } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import Modal from '../../shared/Modal.tsx'
import { RecordChangeTable } from '../../shared/RecordsFloat.tsx'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import type { RecordItem, RecordsAdapter } from '../../../utils/entityRecords.ts'
import {
  getMemberHistory,
  type MemberCustomerRef,
  type MemberHistory,
  type MemberHistoryEvent,
  type StaffMember,
} from '../../../api/portalMembersTransport.ts'
import {
  EVIDENCE_TEXT,
  HISTORY_ACTION_TEXT,
  SUGGESTION_BASIS_TEXT,
  UNLINK_REASONS,
  canRevert,
  customerLabel,
  memberReadErrorText,
  memberIdLabel,
  memberText,
  type MemberViewer,
} from './memberModel.ts'
import { RevertDialog } from './MemberActionDialogs.tsx'
import { IconAction, textOf, type MemberT } from './memberUi.tsx'

// History: the append-only link events of one member, newest first. VIEW-ONLY:
// no field here edits a record. Each row opens the same Field | Before | After
// table every Records float uses (RecordChangeTable); the one control on a row
// is Revert, which opens the shared review dialog. An event is revertible only
// while it is the member's latest change (the Worker says so per row).

const REASON_TEXT: Record<string, [string, string]> = {
  signup_claimed_customer: ['pm_reason_signup_claimed', 'The old sign-up claimed an existing customer'],
  signup_created_customer: ['pm_reason_signup_created', 'The old sign-up created this customer'],
  moved: ['pm_reason_moved', 'Moved to another member'],
}

type MemberRecord = RecordItem & { event: MemberHistoryEvent }

function customerSide(customer: MemberCustomerRef | null, hidden: boolean, t: MemberT): string {
  if (hidden) return memberText(t, 'pm_customer_hidden', 'Customer hidden')
  return customer ? customerLabel(customer) : memberText(t, 'pm_not_linked', 'Not linked')
}

/** Exported for the test: the rows a history entry expands to. */
export function historyAdapter(t: MemberT, customerVisible: boolean): RecordsAdapter {
  const dash = '—'
  return {
    normalizeKind: (raw) => String(raw ?? 'link'),
    kindLabel: (kind) => {
      const text = HISTORY_ACTION_TEXT[kind as keyof typeof HISTORY_ACTION_TEXT]
      return text ? textOf(t, text) : kind
    },
    fieldRows: (record) => {
      const event = (record as MemberRecord).event
      const rows = [{
        key: 'customer',
        label: memberText(t, 'pm_field_customer', 'Linked customer'),
        before: customerSide(event.fromCustomer, !customerVisible, t),
        after: customerSide(event.toCustomer, !customerVisible, t),
      }]
      if (event.evidence) {
        rows.push({
          key: 'evidence',
          label: memberText(t, 'pm_evidence', 'Identity check'),
          before: dash,
          after: event.evidence === 'system' ? memberText(t, 'pm_ev_system', 'System') : textOf(t, EVIDENCE_TEXT[event.evidence].label),
        })
      }
      // Withheld (null) from a viewer without Contacts view: provenance says a customer exists.
      const reason = event.reasonCode
        ? UNLINK_REASONS.find((option) => option.id === event.reasonCode) ?? null
        : null
      const reasonText = reason ? memberText(t, reason.key, reason.fallback) : event.reasonCode && REASON_TEXT[event.reasonCode] ? textOf(t, REASON_TEXT[event.reasonCode]) : ''
      if (reasonText) rows.push({ key: 'reason', label: memberText(t, 'reason', 'Reason'), before: dash, after: reasonText })
      if (event.matchBasis?.basis?.length) {
        const strength = event.matchBasis.strength === 'strong' ? memberText(t, 'pm_strong', 'Strong') : memberText(t, 'pm_possible', 'Possible')
        rows.push({ key: 'match', label: memberText(t, 'pm_field_match', 'Match'), before: dash, after: `${strength} · ${textOf(t, SUGGESTION_BASIS_TEXT(event.matchBasis.basis))}` })
      }
      if (event.note) rows.push({ key: 'note', label: memberText(t, 'note', 'Note'), before: dash, after: event.note })
      return rows
    },
  }
}

interface Props {
  member: StaffMember
  viewer: MemberViewer
  t: MemberT
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
  onClose: () => void
  onChanged: (member: StaffMember) => void
  onRefusal: (error: unknown) => void
}

export default function MemberHistoryFloat({ member, viewer, t, fmtUSD, fmtKHR, onClose, onChanged, onRefusal }: Props) {
  const [history, setHistory] = useState<MemberHistory | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [reverting, setReverting] = useState<MemberHistoryEvent | null>(null)

  const load = useCallback(() => {
    let cancelled = false
    setError('')
    getMemberHistory(member.id).then(
      (result) => { if (!cancelled) setHistory(result) },
      (failure: unknown) => { if (!cancelled) setError(memberReadErrorText(failure, t)) },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id])
  useEffect(() => load(), [load])

  const customerVisible = history ? history.customerVisible : viewer.seesCustomers
  const adapter = historyAdapter(t, customerVisible)
  const ctx = { label: (key: string, fallback: string) => memberText(t, key, fallback), t: (key: string) => t(key) ?? key, fmtUSD, fmtKHR }
  const events = history?.events ?? []

  return (
    <>
      <Modal title={`${memberText(t, 'history', 'History')} · ${memberIdLabel(member)}`} onClose={onClose} size="lg" unsavedChanges="read-only">
        <div className="space-y-2" data-member-history="">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{history ? `${events.length} ${memberText(t, 'records', 'records')}` : memberText(t, 'loading', 'Loading...')}</span>
            <span>{memberText(t, 'tap_to_view_details', 'Tap a record to view details.')}</span>
          </p>
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-2 rounded border border-red-200 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:text-red-400">
              <span>{error}</span>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => { load() }}>{memberText(t, 'retry', 'Retry')}</button>
            </div>
          ) : history && events.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">{memberText(t, 'pm_hist_empty', 'No history yet')}</div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {events.map((event) => {
                const open = openId === event.id
                const record: MemberRecord = {
                  id: String(event.id),
                  at: event.createdAt,
                  actor_username: event.actorName,
                  kind: event.action,
                  event,
                }
                const subject = customerVisible && (event.fromCustomer || event.toCustomer)
                  ? `${event.fromCustomer?.name || memberText(t, 'pm_not_linked', 'Not linked')} → ${event.toCustomer?.name || memberText(t, 'pm_not_linked', 'Not linked')}`
                  : ''
                return (
                  <li key={event.id} data-member-event={event.action} className="flex items-start">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        data-records-row=""
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : event.id)}
                        className="flex w-full items-start gap-2 px-1 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        {open ? <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {/* Khmer glyphs need vertical room: leading-relaxed, not a line box sized to Latin text. */}
                            <span className="text-[13px] font-medium leading-relaxed text-gray-800 dark:text-gray-100">{adapter.kindLabel(event.action, ctx)}</span>
                            {subject ? <span className="min-w-0 text-xs leading-relaxed text-gray-500">{subject}</span> : null}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-relaxed text-gray-400">
                            <span data-records-actor="">{event.actorName || memberText(t, 'unknown', 'Unknown')}</span>
                            <span>{fmtDateTime24(event.createdAt)}</span>
                          </span>
                        </span>
                      </button>
                      {open ? (
                        <div className="px-1 pb-3 pl-6">
                          <RecordChangeTable record={record} adapter={adapter} t={ctx.t} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                        </div>
                      ) : null}
                    </div>
                    {canRevert(event, viewer) ? (
                      <IconAction id="revert" label={memberText(t, 'revert', 'Revert')} icon={Undo2} onClick={() => setReverting(event)} />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>

      {reverting ? (
        <RevertDialog
          member={member}
          event={reverting}
          viewer={viewer}
          t={t}
          onClose={() => setReverting(null)}
          onRefusal={onRefusal}
          onDone={(result) => {
            setReverting(null)
            onChanged((result as { member: StaffMember }).member)
            load()
          }}
        />
      ) : null}
    </>
  )
}
