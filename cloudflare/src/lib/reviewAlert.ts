// One Telegram alert per review event (owner, 13 Oct 2026; slice C of the review-queue completion plan,
// OPUS-PLAN-REVIEW-QUEUE-COMPLETION.md section 3).
//
// THE FOUR EVENTS, and where each is fired -- always by the request whose write COMMITTED, so a replay, a refusal or
// a 409 sends nothing and two racing approvals send one message:
//   created      lib/reviewGate.ts maybeQueueForReview, after the pending row is inserted
//   approved     routes/reviewQueue.ts POST /:id/approve, after the transition (not for replayed answers)
//   rejected     routes/reviewQueue.ts POST /:id/reject, after markPendingActionRejected said it changed the row
//   resubmitted  routes/reviewQueue.ts POST /:id/resubmit, after resubmitPendingAction said it changed the row
//
// WHAT A MESSAGE CONTAINS: a heading and at most four rows, in this order --
//   Request: <fixed phrase> · <the record's name>
//   Merged:  <retired> → <kept>           (an approved merge only)
//   Reason:  <the reviewer's reason>      (a rejection only, cut at 120 characters)
//   Requested by: <username>              (and, for a decision)
//   By:           <username>
// Account USERNAMES only (actorSnapshot, N13) -- never a full name, a phone, an email, money or cost, and never the
// request's own `summary` (it holds amounts). The fixed phrases and every label are bilingual (telegramLang.ts).
//
// DELIVERY: the Alerts topic (event type `reviews`), the telegram_reviews_enabled switch (on when unset), the chat id
// and topic from THIS deployment's own settings and nothing else (one organization per deployment). Deferred through
// lib/requestDefer.ts so the user's response never waits on Telegram; one retry after a 429 or 5xx and none after a
// network error or a timeout (lib/telegram.ts). A Telegram failure never fails the request.
//
// HOW THE ROUTES REACH THIS FILE: through a global hook, not an import. lib/reviewGate.ts and routes/reviewQueue.ts
// are loaded in isolation, with hand-written require tables, by dozens of existing tests; one new relative import in
// either would break each of them. The Symbol.for hook is the same arrangement lib/requestMetrics.ts uses toward
// lib/db.ts for the same reason: a hook that is simply absent is a no-op, so those tests are unchanged. index.ts
// installs it with installReviewAlerts(). The key must stay identical in all three files (the native test pins it).

import { getDb } from './db'
import { sendTelegramEventWhenOn } from './telegram'
import { firstCharacters, REVIEW_REQUEST_SEPARATOR, type ReviewRequestPhrase } from './telegramLang'
import { deferRequestWork } from './requestDefer'
import { runBackground } from './requestMetrics'
import type { PendingActionRow } from './pendingActions'
import type { Env } from '../index'

export const REVIEW_ALERT_HOOK_KEY = 'business-os.review-alert.v1'

export type ReviewAlertKind = 'created' | 'approved' | 'rejected' | 'resubmitted'

/** The part of a pending_actions row an alert reads. `created` builds one before the row is read back. */
export type ReviewAlertRow = Pick<PendingActionRow, 'section' | 'action_type' | 'entity_type' | 'entity_id' | 'payload_json' | 'requested_by_name'>

export type ReviewAlertEvent = {
  kind: ReviewAlertKind
  row: ReviewAlertRow
  /** The deciding account's USERNAME (actorSnapshot of the session user): approved and rejected only. */
  by?: string | null
  /** A rejection's reason, as the reviewer typed it. */
  reason?: string | null
  /** An approval that merged two products: the names the applier supplied. */
  merged?: { retired?: string | null; kept?: string | null } | null
  /** The record's name read BEFORE the change, for a record the change removes (an expense delete). */
  recordName?: string | null
}

export type ReviewAlertHook = {
  /** Never rejects. Defers through the request scope, or awaits the send when there is none. */
  announce(env: Env, event: ReviewAlertEvent): Promise<void>
  /** Before an approval applies: the name of a record the approval is about to remove, else null with no read. */
  nameBeforeChange(env: Env, row: ReviewAlertRow): Promise<string | null>
}

// section:action:entity -> the fixed phrase. Every other queued kind is skipped (nothing is sent), and
// scripts/test-review-telegram-alerts-native.cjs pins that every applier in lib/reviewApply.ts is either here or listed
// there as never approvable (branches create/delete are refused at approval).
const REQUEST_PHRASES = new Map<string, ReviewRequestPhrase>([
  ['products:create:product', 'New product'],
  ['products:update:product', 'Edit product'],
  ['products:delete:product', 'Remove product'],
  ['fees:delete:fee', 'Delete expense'],
  ['inventory:update:inventory_reason', 'Edit stock reasons'],
  ['branches:update:branch', 'Edit branch'],
])
export const REVIEW_ALERT_REQUEST_KEYS: readonly string[] = [...REQUEST_PHRASES.keys()]

const requestKey = (row: Pick<ReviewAlertRow, 'section' | 'action_type' | 'entity_type'>): string => `${row.section}:${row.action_type}:${row.entity_type}`

export function reviewRequestPhrase(row: Pick<ReviewAlertRow, 'section' | 'action_type' | 'entity_type'>): ReviewRequestPhrase | null {
  return REQUEST_PHRASES.get(requestKey(row)) ?? null
}

// Each heading is a key of telegramLang.ts HEADINGS (emoji in front of both languages); the native test pins it.
export const REVIEW_ALERT_HEADINGS: Record<ReviewAlertKind, string> = {
  created: '🕒 Review requested',
  approved: '✅ Review approved',
  rejected: '❌ Review rejected',
  resubmitted: '🔁 Review resubmitted',
}

export const REVIEW_NAME_MAX = 80
export const REVIEW_REASON_ALERT_MAX = 120

const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** One line of plain text: direction controls are dropped (one could flip the row's order), other control characters and runs of whitespace become one space. */
function singleLine(value: unknown): string {
  return String(value ?? '').replace(BIDI_CONTROLS, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** An account name or a record name: one line, at most REVIEW_NAME_MAX characters. */
export function reviewAlertName(value: unknown): string | null {
  return firstCharacters(singleLine(value), REVIEW_NAME_MAX).trim() || null
}

/** A rejection reason: one line, at most REVIEW_REASON_ALERT_MAX characters, an ellipsis in the last place when cut. */
export function reviewAlertReason(value: unknown): string | null {
  const text = singleLine(value)
  if (!text) return null
  const characters = Array.from(text)
  return characters.length <= REVIEW_REASON_ALERT_MAX ? text : `${firstCharacters(text, REVIEW_REASON_ALERT_MAX - 1).trimEnd()}…`
}

function payloadName(row: ReviewAlertRow): string | null {
  try {
    const payload = JSON.parse(row.payload_json || 'null') as { name?: unknown } | null
    return payload && typeof payload === 'object' && typeof payload.name === 'string' ? reviewAlertName(payload.name) : null
  } catch { return null }
}

// One read, by the entity id the request carries. A product, expense or branch whose row is gone answers null.
const NAME_READS = new Map<string, string>([
  ['products:update:product', 'SELECT name FROM products WHERE id = @id'],
  ['products:delete:product', 'SELECT name FROM products WHERE id = @id'],
  ['fees:delete:fee', `SELECT COALESCE(NULLIF(trim(label), ''), fee_type) AS name FROM fees WHERE id = @id`],
  ['branches:update:branch', 'SELECT name FROM branches WHERE id = @id'],
])

async function readRecordName(env: Env, row: ReviewAlertRow): Promise<string | null> {
  const sql = NAME_READS.get(requestKey(row))
  const id = Number(row.entity_id)
  if (!sql || !Number.isSafeInteger(id) || id <= 0) return null
  try {
    return reviewAlertName((await getDb(env).prepare(sql).get<{ name?: unknown }>({ id }))?.name)
  } catch { return null }
}

/**
 * The record's name, with at most one read. A create has no record yet (the name is in the request); an approved merge
 * names the kept product from the applier; a removal's name was read before the change and handed in.
 */
async function recordNameFor(env: Env, event: ReviewAlertEvent): Promise<string | null> {
  const given = reviewAlertName(event.recordName)
  if (given) return given
  if (requestKey(event.row) === 'products:create:product') return payloadName(event.row)
  if (event.kind === 'approved') {
    const kept = reviewAlertName(event.merged?.kept)
    if (kept) return kept
  }
  return (await readRecordName(env, event.row)) ?? payloadName(event.row)
}

/** The message: a heading and at most four rows (see the header). Null for a request kind with no phrase. */
export function formatReviewAlert(event: ReviewAlertEvent, recordName: string | null): { heading: string; lines: string[] } | null {
  const phrase = reviewRequestPhrase(event.row)
  if (!phrase) return null
  const lines = [`Request: ${phrase}${recordName ? `${REVIEW_REQUEST_SEPARATOR}${recordName}` : ''}`]
  if (event.kind === 'approved') {
    const retired = reviewAlertName(event.merged?.retired)
    const kept = reviewAlertName(event.merged?.kept)
    if (retired && kept) lines.push(`Merged: ${retired} → ${kept}`)
    else if (retired || kept) lines.push(`Merged: ${retired || kept}`)
  }
  if (event.kind === 'rejected') {
    const reason = reviewAlertReason(event.reason)
    if (reason) lines.push(`Reason: ${reason}`)
  }
  const requestedBy = reviewAlertName(event.row.requested_by_name)
  if (requestedBy) lines.push(`Requested by: ${requestedBy}`)
  if (event.kind === 'approved' || event.kind === 'rejected') {
    const by = reviewAlertName(event.by)
    if (by) lines.push(`By: ${by}`)
  }
  return { heading: REVIEW_ALERT_HEADINGS[event.kind], lines }
}

const secretFree = (text: string): string => text.replace(/bot\d+:[\w-]+/g, 'bot<redacted>')

/** Composes and sends one alert. Resolves false when nothing was sent; never throws. */
export async function sendReviewAlert(env: Env, event: ReviewAlertEvent): Promise<boolean> {
  try {
    return await sendTelegramEventWhenOn(env, 'reviews', async () => formatReviewAlert(event, await recordNameFor(env, event)), { retryOnce: true })
  } catch (error) {
    console.warn(`[review-alert] ${event.kind} alert not sent:`, secretFree(error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'))
    return false
  }
}

/** The announce side of the hook: deferred through the request scope, under its own background metrics label. */
export function announceReviewEvent(env: Env, event: ReviewAlertEvent): Promise<void> {
  return deferRequestWork(() => runBackground(env, 'review-alert', () => sendReviewAlert(env, event)))
}

export async function reviewNameBeforeChange(env: Env, row: ReviewAlertRow): Promise<string | null> {
  return requestKey(row) === 'fees:delete:fee' ? readRecordName(env, row) : null
}

/** Registers the hook lib/reviewGate.ts and routes/reviewQueue.ts look up. Called once, from index.ts. */
export function installReviewAlerts(): void {
  const hook: ReviewAlertHook = { announce: announceReviewEvent, nameBeforeChange: reviewNameBeforeChange }
  ;(globalThis as unknown as Record<symbol, ReviewAlertHook>)[Symbol.for(REVIEW_ALERT_HOOK_KEY)] = hook
}
