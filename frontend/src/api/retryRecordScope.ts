import { STORAGE_KEYS } from '../constants.ts'
import { getSyncServerUrl } from './httpState.ts'

// A retry record (a frozen request and its client_request_id) belongs to the
// page origin, server and organization it was saved against, the way work
// drafts are keyed (utils/workDrafts.ts): the same user id on another server or
// in another organization never loads it, so it is never sent there.

function pageOrigin(): string {
  try { return window.location?.origin || '' } catch { return '' }
}

function currentServer(origin: string): string {
  try { return new URL(getSyncServerUrl() || origin).origin } catch { return '' }
}

function retryRecordScope(): string {
  const origin = pageOrigin()
  let organization = ''
  try {
    const user = JSON.parse(window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER) || '{}') as Record<string, unknown> | null
    organization = String(user?.organization_public_id || user?.organizationId || user?.organization_id || '')
  } catch { /* no stored account */ }
  return encodeURIComponent(JSON.stringify([origin, currentServer(origin), organization]))
}

export function retryRecordKey(prefix: string, ...parts: unknown[]): string {
  return `${prefix}${retryRecordScope()}:${parts.map(String).join(':')}`
}

// A record saved before keys carried the scope names no server. Retry records
// live in this tab's sessionStorage, so such a record was saved by the build
// this tab ran before it reloaded, against the server it was started with. That
// server is noted once per tab at bootstrap (web-api.ts) in the tab's own
// sessionStorage, under a pending-record prefix so every reset keeps it; an old
// record loads only there.
const LEGACY_SERVER = 'businessos_pending_retry_server_v1'
type TabStore = Pick<Storage, 'getItem' | 'setItem'>

function tabStore(): TabStore | null {
  try { if (window.sessionStorage) return window.sessionStorage } catch { /* no window */ }
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

export function noteRetryRecordServer(store: TabStore | null | undefined = tabStore()): void {
  try {
    if (store && store.getItem(LEGACY_SERVER) == null) store.setItem(LEGACY_SERVER, currentServer(pageOrigin()))
  } catch { /* no tab storage */ }
}

export function legacyRetryRecordsReadable(store: TabStore | null | undefined = tabStore()): boolean {
  noteRetryRecordServer(store)
  try { return !!store && store.getItem(LEGACY_SERVER) === currentServer(pageOrigin()) } catch { return false }
}

/** On the tab's own server, a record saved before keys carried the scope moves,
 *  byte for byte, to the scope it is first read under; from then on only that
 *  scope reads it. On any other server it stays where it is, unread. */
export function adoptLegacyRetryRecord(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined, legacyKey: string, scopedKey: string): void {
  try {
    if (!storage || storage.getItem(scopedKey) != null || !legacyRetryRecordsReadable()) return
    const legacy = storage.getItem(legacyKey)
    if (legacy == null) return
    storage.setItem(scopedKey, legacy)
    if (storage.getItem(scopedKey) === legacy) storage.removeItem(legacyKey)
  } catch { /* unreadable storage adopts nothing */ }
}
