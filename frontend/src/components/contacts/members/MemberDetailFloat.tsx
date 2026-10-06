import type { ComponentType, SVGProps } from 'react'
import LinkIcon from 'lucide-react/dist/esm/icons/link.js'
import Unlink from 'lucide-react/dist/esm/icons/unlink.js'
import HistoryIcon from 'lucide-react/dist/esm/icons/history.js'
import Pause from 'lucide-react/dist/esm/icons/pause.js'
import Play from 'lucide-react/dist/esm/icons/play.js'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import Repeat from 'lucide-react/dist/esm/icons/repeat.js'
import Modal from '../../shared/Modal.tsx'
import CopyableId from '../../shared/CopyableId.tsx'
import type { StaffMember } from '../../../api/portalMembersTransport.ts'
import { fmtDate, fmtDateTime24 } from '../../../utils/formatters.ts'
import {
  CONFLICT_TEXT,
  customerHidden,
  customerLabel,
  linkStateOf,
  memberActions,
  memberText,
  showsProvenance,
  type MemberAction,
  type MemberViewer,
} from './memberModel.ts'
import { ChipBadge, ConflictLine, Detail, IconAction, phoneLabel, textOf, type MemberT } from './memberUi.tsx'

// One member, every fact the list row cannot fit, and every action this viewer
// may take. Painted from the row already on screen, so it has real content from
// the first frame; an action's result replaces the row it came from.

const ICON_ACTIONS: Record<Exclude<MemberAction, 'link'>, { icon: ComponentType<SVGProps<SVGSVGElement>>; key: string; fallback: string; danger?: boolean }> = {
  relink: { icon: Repeat, key: 'pm_act_relink', fallback: 'Change link' },
  unlink: { icon: Unlink, key: 'pm_act_unlink', fallback: 'Unlink', danger: true },
  history: { icon: HistoryIcon, key: 'history', fallback: 'History' },
  suspend: { icon: Pause, key: 'pm_act_suspend', fallback: 'Suspend', danger: true },
  reactivate: { icon: Play, key: 'pm_act_reactivate', fallback: 'Reactivate' },
  reset: { icon: KeyRound, key: 'pm_act_reset', fallback: 'Reset password', danger: true },
}

interface Props {
  member: StaffMember
  viewer: MemberViewer
  t: MemberT
  onAction: (action: MemberAction) => void
  onClose: () => void
}

export default function MemberDetailFloat({ member, viewer, t, onAction, onClose }: Props) {
  const hidden = customerHidden(member, viewer)
  const provenance = showsProvenance(member, viewer)
  const actions = memberActions(member, viewer)
  const state = linkStateOf(member)
  const customerText = member.customer
    ? customerLabel(member.customer)
    : hidden && state !== 'not_linked'
      ? memberText(t, 'pm_customer_hidden_hint', 'Customer hidden: needs Contacts access')
      : memberText(t, 'pm_not_linked', 'Not linked')
  return (
    <Modal title={member.name || memberText(t, 'pm_members', 'Members')} onClose={onClose} size="md" unsavedChanges="read-only">
      <div className="space-y-3" data-member-detail="">
        <div className="flex flex-wrap items-center gap-2">
          <ChipBadge chip={member.chip} t={t} />
          {member.pendingRequest ? (
            <span data-member-in-review="" className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold leading-relaxed text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              {memberText(t, 'pm_in_review', 'In review')}
            </span>
          ) : null}
        </div>
        <dl className="divide-y divide-gray-100 dark:divide-zinc-800">
          <Detail label={memberText(t, 'pm_member_id', 'Member ID')}>
            {member.memberCode ? <CopyableId value={member.memberCode} copyLabel={memberText(t, 'copy', 'Copy')} copiedLabel={memberText(t, 'copied', 'Copied')} className="font-mono text-xs" /> : '—'}
          </Detail>
          {member.legacyMembershipId && !hidden ? <Detail label={memberText(t, 'pm_old_lc', 'Old LC number')}><span className="font-mono text-xs">{member.legacyMembershipId}</span></Detail> : null}
          <Detail label={memberText(t, 'phone', 'Phone')}>{phoneLabel(member.phone) || '—'}</Detail>
          <Detail label={memberText(t, 'email', 'Email')}>{member.email || '—'}</Detail>
          <Detail label={memberText(t, 'pm_customer', 'Customer')}><span data-member-customer="">{customerText}</span></Detail>
          <Detail label={memberText(t, 'pm_joined', 'Joined')}>{member.createdAt ? fmtDate(member.createdAt) : '—'}</Detail>
          <Detail label={memberText(t, 'last_seen', 'Last seen')}>{member.lastSeenAt ? fmtDateTime24(member.lastSeenAt) : '—'}</Detail>
        </dl>
        {member.pendingRequest?.note ? (
          <p data-member-request-note="" className="rounded-lg bg-violet-50/60 px-3 py-2 text-xs leading-relaxed text-gray-700 dark:bg-violet-900/10 dark:text-gray-200">{member.pendingRequest.note}</p>
        ) : null}
        {member.conflicts.map((conflict) => <ConflictLine key={conflict} text={textOf(t, CONFLICT_TEXT[conflict] ?? CONFLICT_TEXT.customer_unavailable)} />)}
        {provenance && member.legacyClaim ? <ConflictLine text={memberText(t, 'pm_marker_legacy_claim', 'Linked by the old sign-up, check')} /> : null}
        {provenance && member.createdFromSignup ? (
          <p data-member-marker="created" className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{memberText(t, 'pm_marker_created_signup', 'Customer made by the old sign-up')}</p>
        ) : null}

        <div className="flex items-center gap-1 border-t border-gray-100 pt-3 dark:border-zinc-800">
          {actions.includes('link') ? (
            <button
              type="button"
              data-member-action="link"
              onClick={() => onAction('link')}
              className="mr-1 inline-flex h-9 items-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <LinkIcon className="h-4 w-4 shrink-0" />
              <span>{memberText(t, 'pm_act_link', 'Link')}</span>
            </button>
          ) : null}
          {actions.filter((action): action is Exclude<MemberAction, 'link'> => action !== 'link').map((action) => {
            const spec = ICON_ACTIONS[action]
            return <IconAction key={action} id={action} label={memberText(t, spec.key, spec.fallback)} icon={spec.icon} danger={spec.danger} onClick={() => onAction(action)} />
          })}
        </div>
      </div>
    </Modal>
  )
}
