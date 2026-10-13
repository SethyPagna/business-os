import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../api/actorReadScope.ts'
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
export type DraftAuthority = {
  baseKey: string
  draftKey: string
  scope: ActorReadScope
}

export function openDraftAuthority(baseKey: string): DraftAuthority {
  return { baseKey, draftKey: scopedWorkDraftKey(baseKey), scope: captureActorReadScope('draft') }
}

export function isDraftAuthorityCurrent(authority: DraftAuthority): boolean {
  return isActorReadScopeCurrent(authority.scope, false) && scopedWorkDraftKey(authority.baseKey) === authority.draftKey
}
