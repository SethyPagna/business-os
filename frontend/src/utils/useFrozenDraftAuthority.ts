import { useRef, useState } from 'react'
import { isDraftAuthorityCurrent, openDraftAuthority, type DraftAuthority } from './draftAuthority.ts'

// The one place a form (or the page hosting it) freezes the account and server it was OPENED under
// (draftAuthority.ts). The Expense form and page, the Branch form and page and the Product form each used to carry
// their own copy of this block and of its "the account or server changed" notice; a fix to one (H7: the fence moved
// from the read scope to the write identity) had to be found in all five.
//
//   baseKey      the draft's base key (feeFormDraftBaseKey(id), ...); null while no form is open, which is how a
//                hosting page says "nothing to freeze" -- the authority is then null
//   formIdentity re-freezes when it changes, so a page that opens another record (or the same one re-read) gets a
//                fresh authority; a form that lives and dies with its own mount leaves it out
//   adopt        the authority the hosting page already froze for this form (so its Minimize acts on the draft the form
//                wrote); the form uses it instead of opening its own
//
// Returned:
//   authority    frozen at the first render for this identity; never recomputed from the live account and server
//   current      does the frozen authority still match the live one? Re-evaluated on every render, so a form that
//                re-renders after a real account / server change sees it; true while there is no authority
//   refused      latched by an action that found the authority gone (a Save, or a save that finished after the change)
//   locked       !current || refused -- Save off, draft writer stopped, notice shown (DraftAuthorityNotice)
// A handler that outlives a render asks isDraftAuthorityCurrent(authority) again; this hook never caches an answer.
export type FrozenDraftAuthority<Authority extends DraftAuthority | null> = {
  authority: Authority
  current: boolean
  refused: boolean
  setRefused: (refused: boolean) => void
  locked: boolean
}

type FrozenDraftAuthorityOptions = { formIdentity?: string; adopt?: DraftAuthority }

export function useFrozenDraftAuthority(baseKey: string, options?: FrozenDraftAuthorityOptions): FrozenDraftAuthority<DraftAuthority>
export function useFrozenDraftAuthority(baseKey: string | null, options?: FrozenDraftAuthorityOptions): FrozenDraftAuthority<DraftAuthority | null>
export function useFrozenDraftAuthority(baseKey: string | null, options: FrozenDraftAuthorityOptions = {}): FrozenDraftAuthority<DraftAuthority | null> {
  const frozen = useRef<{ identity: string; authority: DraftAuthority } | null>(null)
  // The latch is tied to the exact authority it refused, so a form reopened later (a new authority) starts unrefused.
  const [refusedAuthority, setRefusedAuthority] = useState<DraftAuthority | null>(null)
  const identity = options.formIdentity ?? ''
  if (baseKey === null) frozen.current = null
  else if (frozen.current?.identity !== identity) frozen.current = { identity, authority: options.adopt ?? openDraftAuthority(baseKey) }
  const authority = frozen.current?.authority ?? null
  const current = authority === null || isDraftAuthorityCurrent(authority)
  const refused = authority !== null && refusedAuthority === authority
  return { authority, current, refused, setRefused: (value: boolean) => setRefusedAuthority(value ? authority : null), locked: !current || refused }
}
