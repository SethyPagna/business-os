import { useRef, useState, type ReactNode } from 'react'
import ConfirmDialog, { type ConfirmReviewItem } from '../../shared/ConfirmDialog.tsx'
import Modal from '../../shared/Modal.tsx'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import {
  newMemberRequestId,
  rejectLinkRequest,
  resetMemberPassword,
  revertMemberEvent,
  suspendMember,
  reactivateMember,
  unlinkMember,
  type MemberEvidence,
  type MemberHistoryEvent,
  type MemberLinkRequest,
  type MemberUnlinkReason,
  type StaffMember,
} from '../../../api/portalMembersTransport.ts'
import {
  CHIP_TEXT,
  HISTORY_ACTION_TEXT,
  UNLINK_REASONS,
  customerHidden,
  customerLabel,
  linkStateOf,
  memberErrorText,
  memberIdLabel,
  memberText,
  revertRelinks,
  type MemberViewer,
} from './memberModel.ts'
import { EvidenceFields, IconAction, NoteField, phoneLabel, textOf, type MemberT } from './memberUi.tsx'

// Every member action that is not the Link float goes through the ONE shared
// compact review dialog (ConfirmDialog): the values before and after, a short
// why, and Confirm. Never the browser's confirm().

interface Shared {
  t: MemberT
  /** The action landed: the parent refreshes its list and closes the dialog. */
  onDone: (result?: unknown) => void
  onClose: () => void
  /** A refusal that carries the member as it is now (stale, status conflict): refresh the row from it. */
  onRefusal?: (error: unknown) => void
}

interface ShellProps extends Shared {
  title: string
  message?: ReactNode
  items: ConfirmReviewItem[]
  confirmLabel: string
  danger?: boolean
  canConfirm: boolean
  run: () => Promise<unknown>
  children?: ReactNode
}

/**
 * Owns the busy and error state of one review dialog. A refusal is shown inside
 * the dialog in the operator's language and the dialog stays open, so the typed
 * note and the chosen evidence survive a retry; the request id is made once per
 * open, so a retry after an unknown outcome replays instead of writing twice.
 */
export function ActionShell({ title, message, items, confirmLabel, danger, canConfirm, run, children, t, onDone, onClose, onRefusal }: ShellProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const submit = async () => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    setError('')
    try {
      onDone(await run())
    } catch (failure) {
      setError(memberErrorText(failure, t))
      onRefusal?.(failure)
    } finally {
      busy.current = false
      setWorking(false)
    }
  }
  return (
    <ConfirmDialog
      title={title}
      message={message}
      items={items}
      confirmLabel={confirmLabel}
      danger={danger}
      working={working}
      confirmDisabled={!canConfirm}
      layer="nested"
      onConfirm={() => { void submit() }}
      onClose={onClose}
      t={t}
    >
      {children}
      {error ? <p role="alert" data-member-error="" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</p> : null}
    </ConfirmDialog>
  )
}

/** One review row's value: the customer, or the words for "none" / "hidden". */
export function customerValue(member: StaffMember, viewer: MemberViewer, t: MemberT, customer: { name: string | null; membershipNumber: string | null } | null): string {
  if (customer) return customerLabel(customer)
  if (customerHidden(member, viewer) && linkStateOf(member) !== 'not_linked') return memberText(t, 'pm_customer_hidden', 'Customer hidden')
  return memberText(t, 'pm_not_linked', 'Not linked')
}

const memberLine = (member: StaffMember): string => `${memberIdLabel(member)} · ${member.name}`
const row = (label: string, value: ReactNode): ConfirmReviewItem => ({ label, value })

// --- Unlink ---------------------------------------------------------------------

export function UnlinkDialog({ member, viewer, ...shared }: Shared & { member: StaffMember; viewer: MemberViewer }) {
  const { t } = shared
  const [reason, setReason] = useState<MemberUnlinkReason | ''>('')
  const [note, setNote] = useState('')
  const requestId = useRef(newMemberRequestId())
  const noteRequired = reason === 'other'
  return (
    <ActionShell
      {...shared}
      title={memberText(t, 'pm_dlg_unlink', 'Unlink member')}
      confirmLabel={memberText(t, 'pm_act_unlink', 'Unlink')}
      danger
      canConfirm={Boolean(reason) && (!noteRequired || note.trim() !== '')}
      items={[
        row(memberText(t, 'pm_member', 'Member'), memberLine(member)),
        row(memberText(t, 'before', 'Before'), customerValue(member, viewer, t, member.customer)),
        row(memberText(t, 'after', 'After'), memberText(t, 'pm_not_linked', 'Not linked')),
      ]}
      run={() => unlinkMember(member.id, {
        expectedLinkVersion: member.linkVersion,
        reasonCode: reason as MemberUnlinkReason,
        note: note.trim() || undefined,
        clientRequestId: requestId.current,
      })}
    >
      <div role="group" aria-label={memberText(t, 'reason', 'Reason')} data-member-reason="" className="flex flex-wrap gap-1.5">
        {UNLINK_REASONS.map((option) => (
          <button
            key={option.id}
            type="button"
            data-member-reason-option={option.id}
            aria-pressed={reason === option.id}
            onClick={() => setReason(option.id)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium leading-relaxed ${reason === option.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-gray-200'}`}
          >
            {memberText(t, option.key, option.fallback)}
          </button>
        ))}
      </div>
      <NoteField
        value={note}
        onChange={setNote}
        t={t}
        required={noteRequired}
        placeholder={noteRequired ? memberText(t, 'pm_note_required', 'Note (required)') : memberText(t, 'note', 'Note')}
      />
    </ActionShell>
  )
}

// --- Revert ---------------------------------------------------------------------

export function RevertDialog({ member, event, viewer, ...shared }: Shared & { member: StaffMember; event: MemberHistoryEvent; viewer: MemberViewer }) {
  const { t } = shared
  const relinks = revertRelinks(event)
  const [evidence, setEvidence] = useState<MemberEvidence | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const requestId = useRef(newMemberRequestId())
  const needsNote = evidence === 'owner_override'
  const codeOk = evidence !== 'called_number_on_file' || /^\d{6}$/.test(code.replace(/\s/g, ''))
  // Reverting a first link only removes it; a revert that relinks restores the earlier customer.
  const restored = relinks ? customerValue(member, viewer, t, event.fromCustomer) : memberText(t, 'pm_not_linked', 'Not linked')
  return (
    <ActionShell
      {...shared}
      title={memberText(t, 'pm_dlg_revert', 'Revert change')}
      confirmLabel={memberText(t, 'revert', 'Revert')}
      canConfirm={(!relinks || (evidence !== null && codeOk)) && (!needsNote || note.trim() !== '')}
      items={[
        row(memberText(t, 'pm_member', 'Member'), memberLine(member)),
        row(memberText(t, 'pm_reverts', 'Reverts'), textOf(t, HISTORY_ACTION_TEXT[event.action])),
        row(memberText(t, 'before', 'Before'), customerValue(member, viewer, t, member.customer)),
        row(memberText(t, 'after', 'After'), restored),
        ...(event.groupId ? [row(memberText(t, 'pm_also', 'Also'), memberText(t, 'pm_move_both', 'Reverting a move restores both members'))] : []),
      ]}
      run={() => revertMemberEvent(member.id, {
        eventId: event.id,
        note: note.trim() || undefined,
        ...(relinks && evidence ? { evidence, ...(evidence === 'called_number_on_file' ? { checkCode: code.replace(/\s/g, '') } : {}) } : {}),
        clientRequestId: requestId.current,
      })}
    >
      {relinks ? <EvidenceFields viewer={viewer} evidence={evidence} onEvidence={setEvidence} code={code} onCode={setCode} t={t} /> : null}
      <NoteField
        value={note}
        onChange={setNote}
        t={t}
        required={needsNote}
        placeholder={needsNote ? memberText(t, 'pm_note_required', 'Note (required)') : memberText(t, 'note', 'Note')}
      />
    </ActionShell>
  )
}

// --- Suspend / Reactivate ----------------------------------------------------------

export function StatusDialog({ member, mode, ...shared }: Shared & { member: StaffMember; mode: 'suspend' | 'reactivate' }) {
  const { t } = shared
  const [note, setNote] = useState('')
  const suspending = mode === 'suspend'
  return (
    <ActionShell
      {...shared}
      title={suspending ? memberText(t, 'pm_dlg_suspend', 'Suspend member') : memberText(t, 'pm_dlg_reactivate', 'Reactivate member')}
      confirmLabel={suspending ? memberText(t, 'pm_act_suspend', 'Suspend') : memberText(t, 'pm_act_reactivate', 'Reactivate')}
      danger={suspending}
      canConfirm
      items={[
        row(memberText(t, 'pm_member', 'Member'), memberLine(member)),
        row(memberText(t, 'before', 'Before'), suspending ? memberText(t, 'active', 'Active') : textOf(t, CHIP_TEXT.suspended)),
        row(memberText(t, 'after', 'After'), suspending ? textOf(t, CHIP_TEXT.suspended) : memberText(t, 'active', 'Active')),
        ...(suspending ? [row(memberText(t, 'pm_signs_out', 'Signed out'), memberText(t, 'pm_signs_out_value', 'All their sessions end'))] : []),
      ]}
      run={() => (suspending ? suspendMember(member.id, note.trim()) : reactivateMember(member.id, note.trim()))}
    >
      <NoteField value={note} onChange={setNote} t={t} placeholder={memberText(t, 'pm_why_ph', 'Short reason (optional)')} />
    </ActionShell>
  )
}

// --- Reset password -----------------------------------------------------------------

export function ResetDialog({ member, viewer, ...shared }: Shared & { member: StaffMember; viewer: MemberViewer }) {
  const { t } = shared
  const [evidence, setEvidence] = useState<MemberEvidence | null>(null)
  const [note, setNote] = useState('')
  const placeholder = evidence === 'called_number_on_file'
    ? memberText(t, 'pm_reset_note_call_ph', 'Which number you called and what the member confirmed')
    : memberText(t, 'pm_reset_note_ph', 'How you identified the member (who, where, which number)')
  return (
    <ActionShell
      {...shared}
      title={memberText(t, 'pm_dlg_reset', 'Reset password')}
      confirmLabel={memberText(t, 'pm_act_reset', 'Reset password')}
      danger
      canConfirm={evidence !== null && note.trim() !== ''}
      items={[
        row(memberText(t, 'pm_member', 'Member'), memberLine(member)),
        row(memberText(t, 'phone', 'Phone'), phoneLabel(member.phone) || '—'),
        row(memberText(t, 'after', 'After'), memberText(t, 'pm_reset_after', 'New temporary password, shown once')),
        row(memberText(t, 'pm_signs_out', 'Signed out'), memberText(t, 'pm_signs_out_value', 'All their sessions end')),
      ]}
      run={() => resetMemberPassword(member.id, { evidence: evidence as MemberEvidence, note: note.trim() })}
    >
      <EvidenceFields viewer={viewer} evidence={evidence} onEvidence={setEvidence} code="" onCode={() => {}} t={t} withCode={false} />
      <NoteField value={note} onChange={setNote} t={t} required placeholder={placeholder} />
    </ActionShell>
  )
}

export function TempPasswordFloat({ password, member, t, onClose }: { password: string; member: StaffMember; t: MemberT; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  // Copies only when pressed: a one-time password is never put on the clipboard unasked.
  const copy = () => { void navigator.clipboard?.writeText(password).then(() => setCopied(true), () => setCopied(false)) }
  return (
    <Modal title={memberText(t, 'pm_temp_password', 'Temporary password')} onClose={onClose} size="sm" layer="nested" unsavedChanges="read-only">
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-500 dark:text-gray-400">{memberLine(member)}</p>
        <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
          <span data-member-temp-password="" className="select-all break-all font-mono text-lg font-semibold tracking-widest text-gray-900 dark:text-gray-100">{password}</span>
          <IconAction id="copy" label={copied ? memberText(t, 'copied', 'Copied') : memberText(t, 'copy', 'Copy')} icon={copied ? Check : Copy} onClick={copy} />
        </div>
        <p data-member-temp-note="" className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {memberText(t, 'pm_temp_password_note', 'Shown once. Give it to the member; every session was ended.')}
        </p>
      </div>
    </Modal>
  )
}

// --- Reject a link request ------------------------------------------------------------

export function RejectDialog({ request, ...shared }: Shared & { request: MemberLinkRequest }) {
  const { t } = shared
  const [note, setNote] = useState('')
  return (
    <ActionShell
      {...shared}
      title={memberText(t, 'pm_dlg_reject', 'Reject request')}
      confirmLabel={memberText(t, 'reject', 'Reject')}
      danger
      canConfirm={note.trim() !== ''}
      items={[
        row(memberText(t, 'pm_member', 'Member'), memberLine(request.member)),
        ...(request.note ? [row(memberText(t, 'pm_req_note', "Member's note"), request.note)] : []),
        row(memberText(t, 'after', 'After'), memberText(t, 'pm_rejected', 'Rejected')),
      ]}
      run={() => rejectLinkRequest(request.id, note.trim())}
    >
      <NoteField value={note} onChange={setNote} t={t} required placeholder={memberText(t, 'pm_reject_reason_ph', 'Reason for rejecting')} />
    </ActionShell>
  )
}
