import { useEffect, useRef, useState, type ReactNode } from 'react'
import LinkIcon from 'lucide-react/dist/esm/icons/link.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Modal from '../../shared/Modal.tsx'
import { useDebouncedValue } from '../../../utils/useDebouncedValue.ts'
import {
  getMemberSuggestions,
  linkMember,
  newMemberRequestId,
  searchMemberCustomers,
  type MemberCustomerHit,
  type MemberEvidence,
  type MemberLinkRequest,
  type MemberSuggestion,
  type StaffMember,
} from '../../../api/portalMembersTransport.ts'
import {
  EVIDENCE_TEXT,
  SUGGESTION_BASIS_TEXT,
  customerLabel,
  memberReadErrorText,
  memberIdLabel,
  memberText,
  type MemberViewer,
} from './memberModel.ts'
import { ActionShell, customerValue } from './MemberActionDialogs.tsx'
import { EvidenceFields, NoteField, phoneLabel, textOf, type MemberT } from './memberUi.tsx'

// The Link float: link, change link and Move are ONE flow. It paints its real
// content at once (search, the identity check, the note and the main action);
// only the suggestions list waits for the server, with its own loading line.
// Nothing is pre-selected, ever: a suggestion is a hint, not a decision.

interface Picked {
  id: number
  name: string
  membershipNumber: string | null
  phone: string | null
  /** Who holds this customer now. Linking then needs Move. */
  holder: { id: number; memberCode: string | null; name: string } | null
  basis: { strength: 'strong' | 'possible'; basis: string[] } | null
}

interface Props {
  member: StaffMember
  viewer: MemberViewer
  /** Set when approving a member's own "request link": the request is decided by the link itself. */
  request?: MemberLinkRequest | null
  t: MemberT
  onDone: (member: StaffMember) => void
  onClose: () => void
  onRefusal: (error: unknown) => void
}

function CustomerRow({ name, membershipNumber, phone, chips, selected, disabled, onPick, id }: {
  name: string
  membershipNumber: string | null
  phone: string | null
  chips: ReactNode
  selected: boolean
  disabled?: boolean
  onPick: () => void
  id: string
}) {
  return (
    <li>
      <button
        type="button"
        data-member-pick={id}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left leading-relaxed disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{name}</span>
          <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{[membershipNumber, phoneLabel(phone)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{chips}</span>
        {selected ? <Check className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" /> : null}
      </button>
    </li>
  )
}

const pill = 'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-relaxed'

export default function MemberLinkFloat({ member, viewer, request = null, t, onDone, onClose, onRefusal }: Props) {
  const [suggestions, setSuggestions] = useState<MemberSuggestion[] | null>(null)
  const [suggestionError, setSuggestionError] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MemberCustomerHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [evidence, setEvidence] = useState<MemberEvidence | null>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const requestId = useRef(newMemberRequestId())
  const debounced = useDebouncedValue(query.trim(), 250)
  const searchToken = useRef(0)

  useEffect(() => {
    let cancelled = false
    getMemberSuggestions(member.id).then(
      (list) => { if (!cancelled) setSuggestions(list) },
      (error: unknown) => { if (!cancelled) { setSuggestions([]); setSuggestionError(memberReadErrorText(error, t)) } },
    )
    return () => { cancelled = true }
    // The suggestions belong to this member; a refreshed row must not refetch them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id])

  useEffect(() => {
    const token = ++searchToken.current
    if (debounced.length < 2) { setHits([]); setSearching(false); setSearchError(''); return }
    setSearching(true)
    setSearchError('')
    searchMemberCustomers(debounced).then(
      (list) => { if (searchToken.current === token) { setHits(list); setSearching(false) } },
      (error: unknown) => { if (searchToken.current === token) { setHits([]); setSearching(false); setSearchError(memberReadErrorText(error, t)) } },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const relinking = member.customer != null
  const move = picked?.holder != null
  const needsNote = evidence === 'owner_override'
  const codeOk = evidence !== 'called_number_on_file' || /^\d{6}$/.test(code.replace(/\s/g, ''))
  const ready = picked !== null && evidence !== null && codeOk && (!needsNote || note.trim() !== '')
  const dirty = picked !== null || note.trim() !== '' || evidence !== null || query.trim() !== ''

  const title = move ? memberText(t, 'pm_move_title', 'Move link')
    : relinking ? memberText(t, 'pm_relink_title', 'Change link')
      : memberText(t, 'pm_link_title', 'Link member')
  const pick = (next: Picked) => setPicked((current) => (current?.id === next.id ? null : next))

  const submit = () => linkMember(member.id, {
    customerId: picked!.id,
    expectedLinkVersion: member.linkVersion,
    evidence: evidence!,
    ...(evidence === 'called_number_on_file' ? { checkCode: code.replace(/\s/g, '') } : {}),
    note: note.trim() || undefined,
    ...(move ? { move: true } : {}),
    ...(picked!.basis ? { matchBasis: picked!.basis } : {}),
    clientRequestId: requestId.current,
    ...(request ? { linkRequestId: request.id } : {}),
  })

  // A taken customer the lists did not flag (someone linked it a moment ago):
  // the Worker names the holder, and the same dialog turns into a Move.
  const onReviewRefusal = (error: unknown) => {
    const holder = (error as { holder?: { id?: number; memberCode?: string | null; name?: string } | null } | null)?.holder
    if ((error as { code?: string } | null)?.code === 'member_link_customer_taken' && holder?.id) {
      setPicked((current) => current && { ...current, holder: { id: Number(holder.id), memberCode: holder.memberCode ?? null, name: String(holder.name ?? '') } })
    }
    onRefusal(error)
  }

  const holderText = picked?.holder
    ? [picked.holder.memberCode, picked.holder.name].filter(Boolean).join(' · ') || memberText(t, 'pm_another_member', 'Another member')
    : ''

  const hitHolder = (hit: MemberCustomerHit) => (hit.linkedMember && hit.linkedMember.id !== member.id ? hit.linkedMember : null)
  const holderPill = (label: string) => <span className={`${pill} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}>{label}</span>

  return (
    <>
      <Modal title={title} onClose={onClose} size="lg" unsavedChanges={{ dirty }}>
        <div className="space-y-3" data-member-link-float="">
          <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2 text-sm leading-relaxed dark:bg-zinc-900/60">
            <p className="truncate font-medium text-gray-900 dark:text-gray-100">{member.name}</p>
            <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
              {[memberIdLabel(member), phoneLabel(member.phone), relinking ? customerLabel(member.customer) : memberText(t, 'pm_not_linked', 'Not linked')].filter(Boolean).join(' · ')}
            </p>
            {request?.note ? <p data-member-request-note="" className="mt-1 text-xs text-gray-600 dark:text-gray-300">{request.note}</p> : null}
          </div>

          <section aria-label={memberText(t, 'pm_suggestions', 'Suggestions')} className="space-y-1.5">
            <h3 className="text-xs font-medium text-gray-600 dark:text-gray-300">{memberText(t, 'pm_suggestions', 'Suggestions')}</h3>
            {suggestions === null ? (
              <p className="text-xs text-gray-400">{memberText(t, 'loading', 'Loading...')}</p>
            ) : suggestionError ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{suggestionError}</p>
            ) : suggestions.length === 0 ? (
              <p data-member-no-suggestions="" className="text-xs text-gray-400">{memberText(t, 'pm_no_suggestions', 'No suggestions')}</p>
            ) : (
              <ul className="space-y-1">
                {suggestions.map((suggestion) => {
                  const holderId = suggestion.linkedMemberId && suggestion.linkedMemberId !== member.id ? suggestion.linkedMemberId : null
                  const current = member.customer?.id === suggestion.customerId
                  return (
                    <CustomerRow
                      key={suggestion.customerId}
                      id={`suggestion-${suggestion.customerId}`}
                      name={suggestion.name}
                      membershipNumber={suggestion.membershipNumber}
                      phone={suggestion.phone}
                      selected={picked?.id === suggestion.customerId}
                      disabled={current}
                      onPick={() => pick({
                        id: suggestion.customerId,
                        name: suggestion.name,
                        membershipNumber: suggestion.membershipNumber,
                        phone: suggestion.phone,
                        holder: holderId ? { id: holderId, memberCode: null, name: '' } : null,
                        basis: { strength: suggestion.strength, basis: suggestion.basis },
                      })}
                      chips={(
                        <>
                          <span data-member-strength={suggestion.strength} className={`${pill} ${suggestion.strength === 'strong' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                            {suggestion.strength === 'strong' ? memberText(t, 'pm_strong', 'Strong') : memberText(t, 'pm_possible', 'Possible')}
                          </span>
                          <span className={`${pill} bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300`}>{textOf(t, SUGGESTION_BASIS_TEXT(suggestion.basis))}</span>
                          {holderId ? holderPill(memberText(t, 'pm_linked_elsewhere', 'Linked')) : null}
                        </>
                      )}
                    />
                  )
                })}
              </ul>
            )}
          </section>

          <section className="space-y-1.5">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              data-member-customer-search=""
              placeholder={memberText(t, 'pm_customer_search_ph', 'Search customer by name, phone or LC number')}
              aria-label={memberText(t, 'pm_customer_search_ph', 'Search customer by name, phone or LC number')}
              className="input w-full"
            />
            {searching ? <p className="text-xs text-gray-400">{memberText(t, 'searching', 'Searching...')}</p> : null}
            {searchError ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{searchError}</p> : null}
            {!searching && !searchError && debounced.length >= 2 && hits.length === 0 ? (
              <p className="text-xs text-gray-400">{memberText(t, 'no_data', 'No data found')}</p>
            ) : null}
            {hits.length ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {hits.map((hit) => {
                  const holder = hitHolder(hit)
                  return (
                    <CustomerRow
                      key={hit.id}
                      id={`customer-${hit.id}`}
                      name={hit.name}
                      membershipNumber={hit.membershipNumber}
                      phone={hit.phone}
                      selected={picked?.id === hit.id}
                      disabled={member.customer?.id === hit.id}
                      onPick={() => pick({
                        id: hit.id,
                        name: hit.name,
                        membershipNumber: hit.membershipNumber,
                        phone: hit.phone,
                        holder: holder ? { id: holder.id, memberCode: holder.memberCode, name: holder.name } : null,
                        basis: null,
                      })}
                      chips={holder ? holderPill(holder.memberCode || memberText(t, 'pm_linked_elsewhere', 'Linked')) : null}
                    />
                  )
                })}
              </ul>
            ) : null}
          </section>

          <EvidenceFields viewer={viewer} evidence={evidence} onEvidence={setEvidence} code={code} onCode={setCode} t={t} />
          <NoteField
            value={note}
            onChange={setNote}
            t={t}
            required={needsNote}
            placeholder={needsNote ? memberText(t, 'pm_note_required', 'Note (required)') : memberText(t, 'note', 'Note')}
          />

          <div className="flex justify-end">
            <button
              type="button"
              data-member-link-submit=""
              disabled={!ready}
              onClick={() => setReviewing(true)}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            >
              <LinkIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{move ? memberText(t, 'pm_act_move', 'Move') : memberText(t, 'pm_act_link', 'Link')}</span>
            </button>
          </div>
        </div>
      </Modal>

      {reviewing && picked && evidence ? (
        <ActionShell
          t={t}
          title={title}
          confirmLabel={move ? memberText(t, 'pm_act_move', 'Move') : memberText(t, 'pm_act_link', 'Link')}
          canConfirm
          onClose={() => setReviewing(false)}
          onDone={(result) => { setReviewing(false); onDone((result as { member: StaffMember }).member) }}
          onRefusal={onReviewRefusal}
          run={submit}
          items={[
            { label: memberText(t, 'pm_member', 'Member'), value: `${memberIdLabel(member)} · ${member.name}` },
            { label: memberText(t, 'before', 'Before'), value: customerValue(member, viewer, t, member.customer) },
            { label: memberText(t, 'after', 'After'), value: customerLabel(picked) },
            ...(move ? [{ label: memberText(t, 'pm_also_unlinks', 'Also unlinks'), value: holderText }] : []),
            { label: memberText(t, 'pm_evidence', 'Identity check'), value: textOf(t, EVIDENCE_TEXT[evidence].label) },
            ...(note.trim() ? [{ label: memberText(t, 'note', 'Note'), value: note.trim() }] : []),
          ]}
        />
      ) : null}
    </>
  )
}
