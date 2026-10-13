import { useEffect, useReducer, useRef, useState } from 'react'
import { subscribeActorSessionQuarantine } from '../api/actorReadScope.ts'
import { isDraftAuthorityCurrent, openDraftAuthority, type DraftAuthority } from './draftAuthority.ts'

// The one place a form (or the page hosting it) freezes the account and server it was OPENED under
// (draftAuthority.ts), shared by the Expense form and page, the Branch form and page and the Product form.
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
//   current      does the frozen authority still match the live one? Re-evaluated on every render, and the hook
//                re-renders its host when a sign-in check (quarantine) starts or lifts; true while there is no authority
//   refused      an action (a Save, or a save that finished after the change) found the authority gone and it still is
//   locked       !current -- Save off, draft writer stopped, notice shown (DraftAuthorityNotice); it leaves as soon as
//                the lock lifts, which a sign-in check does by itself once the same owner is confirmed
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
  const [refusedAuthority, setRefusedAuthority] = useState<DraftAuthority | null>(null)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const identity = options.formIdentity ?? ''
  if (baseKey === null) frozen.current = null
  else if (frozen.current?.identity !== identity) frozen.current = { identity, authority: options.adopt ?? openDraftAuthority(baseKey) }
  const authority = frozen.current?.authority ?? null
  const holdsAuthority = authority !== null
  // The check can start while some component is rendering; the host is told after that render, not during it.
  useEffect(() => (holdsAuthority ? subscribeActorSessionQuarantine(() => queueMicrotask(rerender)) : undefined), [holdsAuthority])
  const current = authority === null || isDraftAuthorityCurrent(authority)
  const refused = authority !== null && refusedAuthority === authority && !current
  return { authority, current, refused, setRefused: (value: boolean) => setRefusedAuthority(value ? authority : null), locked: !current }
}
