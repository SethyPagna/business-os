import LinkIcon from 'lucide-react/dist/esm/icons/link.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { MemberLinkRequest } from '../../../api/portalMembersTransport.ts'
import { fmtDateTime24 } from '../../../utils/formatters.ts'
import { memberIdLabel, memberText, type MemberViewer } from './memberModel.ts'
import { IconAction, phoneLabel, type MemberT } from './memberUi.tsx'

// The review section: members who pressed "Request link" on the website. Every
// one reads "In review" until staff decide. Approve IS the Link action (with an
// identity check); Reject needs a reason. Without Contacts view a viewer can
// reject but not approve, because approving links a customer they cannot see.

interface Props {
  requests: MemberLinkRequest[] | null
  error: string
  viewer: MemberViewer
  t: MemberT
  onApprove: (request: MemberLinkRequest) => void
  onReject: (request: MemberLinkRequest) => void
  onRetry: () => void
}

export default function MemberRequestsSection({ requests, error, viewer, t, onApprove, onReject, onRetry }: Props) {
  return (
    <section data-member-requests="" aria-label={memberText(t, 'pm_in_review', 'In review')} className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
        <span>{memberText(t, 'pm_in_review', 'In review')}</span>
        {requests ? <span className="text-gray-400">{requests.length}</span> : null}
      </h3>
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="min-w-0">{error}</span>
          <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={onRetry}>{memberText(t, 'retry', 'Retry')}</button>
        </div>
      ) : requests === null ? (
        <p className="py-6 text-center text-xs text-gray-400">{memberText(t, 'loading', 'Loading...')}</p>
      ) : requests.length === 0 ? (
        <div data-member-requests-empty="" className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">
          {memberText(t, 'pm_req_empty', 'No requests in review')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-zinc-800 dark:border-zinc-700">
          {requests.map((request) => (
            <li key={request.id} data-member-request={request.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1 leading-relaxed">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{request.member.name}</span>
                  <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{memberIdLabel(request.member)}</span>
                </p>
                <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {[phoneLabel(request.member.phone), fmtDateTime24(request.createdAt)].filter(Boolean).join(' · ')}
                </p>
                {request.note ? <p data-member-request-note="" className="break-words text-xs text-gray-600 dark:text-gray-300">{request.note}</p> : null}
              </div>
              {viewer.canLink ? (
                <button
                  type="button"
                  data-member-approve=""
                  onClick={() => onApprove(request)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 sm:text-sm"
                >
                  <LinkIcon className="h-4 w-4 shrink-0" />
                  <span>{memberText(t, 'approve', 'Approve')}</span>
                </button>
              ) : null}
              <IconAction id="reject" label={memberText(t, 'reject', 'Reject')} icon={X} danger onClick={() => onReject(request)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
