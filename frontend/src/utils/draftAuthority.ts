import { captureActorWriteIdentity, isActorWriteIdentityCurrent, type ActorWriteIdentity } from '../api/actorReadScope.ts'
import { scopedWorkDraftKey } from './workDrafts.ts'

// The account and sync server a form was OPENED under. A kept-alive page (App's
// mounted pages) can still hold an open form after the person signs in as
// someone else or switches the sync server, and scopedWorkDraftKey() is read
// from the live account and server every time it is called - so a form that
// recomputes its draft key per render would write the old account's typed work
// under the new account's key, and a save would send it to the new server.
//
// A form (and the page hosting it) freezes this once, when the form opens:
// the draft key is the one captured here for as long as the form lives, writes
// and saves are allowed only while the account and server still match, and a
// form that no longer matches keeps its draft with the original owner.
//
// "Match" is the WRITE identity -- server, origin, signed-in user id and
// organization, the same one the Stock Session is fenced by -- not the read
// scope, which also moves on same-user churn (a session reset, a permission,
// profile or expiry rewrite, a reconnect's refresh). A change of account, server
// or organization retires it, and A -> B -> A never passes.
export type DraftAuthority = {
  baseKey: string
  draftKey: string
  identity: ActorWriteIdentity
}

// The sentence every surface says once its frozen authority is gone: the forms' notice (shared/DraftAuthorityNotice)
// and the hosting pages' toast. In both packs as product_draft_authority_changed.
export function draftAuthorityChangedText(t: (key: string) => string | undefined): string {
  return t('product_draft_authority_changed') || 'The account or server changed. Reopen this form to continue. Its draft stays with the original account and server.'
}

export function openDraftAuthority(baseKey: string): DraftAuthority {
  return { baseKey, draftKey: scopedWorkDraftKey(baseKey), identity: captureActorWriteIdentity() }
}

export function isDraftAuthorityCurrent(authority: DraftAuthority): boolean {
  return isActorWriteIdentityCurrent(authority.identity) && scopedWorkDraftKey(authority.baseKey) === authority.draftKey
}
