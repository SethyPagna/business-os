import type { PortalTelegramEnv, PortalTelegramReplyId } from './portalTelegramToken'
import { contactVerdict, decodeStartFlags, portalNowIso, secondsAgoModifier } from './portalTelegramToken'
import { isMemberCodeCollision, mintMemberCode } from './memberCode'
import { PORTAL_CONSENT_VERSION } from './portalAccounts'
import { getPlanLimits } from './planTier'
import { cleanTelegramName, TELEGRAM_NAME_STORED_MAX } from './portalTelegramName'

// The new shopper's join (G38 S3d; AMEND-g38-lean-writes-1.2 sections 3.4, 3.5, 5.6, 7 "New shopper", 8.4).
// Nothing here is mounted: S3e calls these from the webhook route. Every function returns a reply id; the texts live in S3c's
// table and are looked up by the route, so this file shares only the name cleaner (portalTelegramName) with it. Every time written is portalNowIso (24 characters).

type Bind = Record<string, unknown>
export type JoinDb = {
  prepare(sql: string): {
    get<T = Record<string, unknown>>(params?: Bind): Promise<T | undefined>
    run(params?: Bind): Promise<{ changes: number }>
  }
  batch(statements: Array<{ sql: string; params?: Bind }>): Promise<Array<{ meta?: { changes?: number } | null }>>
}

export type JoinReply = { reply: PortalTelegramReplyId; removeKeyboard?: boolean }

// S-P1: the pending upsert with the per-user limit (one row, no secondary index). changes = 0 means over the limit.
const PENDING_UPSERT_SQL = `INSERT INTO portal_telegram_pending (id, ticket_hash, flags, attempts, window_started_at, created_at, expires_at)
VALUES (@tg, @ticket, @flags, 1, @now, @now, @ticket_expires_at)
ON CONFLICT(id) DO UPDATE SET
  ticket_hash = excluded.ticket_hash,
  flags = excluded.flags,
  created_at = excluded.created_at,
  expires_at = excluded.expires_at,
  attempts = CASE
    WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @attempt_window) THEN 1
    ELSE portal_telegram_pending.attempts + 1 END,
  window_started_at = CASE
    WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @attempt_window) THEN @now
    ELSE portal_telegram_pending.window_started_at END
WHERE datetime(portal_telegram_pending.window_started_at) <= datetime(@now, @attempt_window)
   OR portal_telegram_pending.attempts < @attempts_max`

// S-P2
const PENDING_READ_SQL = `SELECT ticket_hash, flags, expires_at FROM portal_telegram_pending
WHERE id = @tg AND datetime(expires_at) > datetime(@now)`

// S-P3
const PENDING_DELETE_SQL = 'DELETE FROM portal_telegram_pending WHERE id = @tg'

// S-J1
const PHONE_HOLDER_SQL = 'SELECT id FROM portal_accounts WHERE phone = @phone LIMIT 1'

// S-K1 (S3c owns its own copy; the race decision here reads the same fact)
const TELEGRAM_MEMBER_SQL = 'SELECT id, status FROM portal_accounts WHERE telegram_user_id = @tg LIMIT 1'

// S-J2 with the breaker S-J4 inside it. The newest @joins_max rows by rowid, no index; created_at compared through datetime()
// so a row written with the column default (space form) counts the same as an ISO row.
export const MEMBER_INSERT_SQL = `INSERT INTO portal_accounts (
  name, phone, member_code, status, link_version,
  telegram_user_id, telegram_verified_at,
  consent_version, consent_at, consent_locale, age_confirmed_at,
  created_at, updated_at, last_seen_at
)
SELECT @name, @phone, @member_code, 'active', 0,
       @tg, @now,
       @consent_version, @now, @consent_locale, @now,
       @now, @now, @now
WHERE (SELECT COUNT(*) FROM (
         SELECT created_at FROM portal_accounts ORDER BY id DESC LIMIT @joins_max
       ) WHERE datetime(created_at) > datetime(@now, @joins_window)) < @joins_max
  AND NOT EXISTS (SELECT 1 FROM portal_accounts WHERE phone = @phone)
  AND NOT EXISTS (SELECT 1 FROM portal_accounts WHERE telegram_user_id = @tg)
  AND NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @ticket)`

// S-J3: the ticket for exactly the row S-J2 just inserted, identified by its fresh random member_code.
export const TICKET_INSERT_SQL = `INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at)
SELECT a.id, @ticket, @ticket_expires_at, @now, @now
FROM portal_accounts a
WHERE a.telegram_user_id = @tg
  AND a.member_code = @member_code
  AND a.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @ticket)`

// S-J5: the pending row goes only when the member exists.
const PENDING_CLEAR_SQL = `DELETE FROM portal_telegram_pending
WHERE id = @tg
  AND EXISTS (SELECT 1 FROM portal_accounts WHERE telegram_user_id = @tg AND member_code = @member_code)`

// Section 3.5 step 5: at most three batches (the first plus two retries), then R-LATER.
const JOIN_BATCH_TRIES = 3

export const PORTAL_TELEGRAM_JOIN_SQL = {
  pendingUpsert: PENDING_UPSERT_SQL,
  pendingRead: PENDING_READ_SQL,
  pendingDelete: PENDING_DELETE_SQL,
  phoneHolder: PHONE_HOLDER_SQL,
  telegramMember: TELEGRAM_MEMBER_SQL,
  memberInsert: MEMBER_INSERT_SQL,
  ticketInsert: TICKET_INSERT_SQL,
  pendingClear: PENDING_CLEAR_SQL,
} as const

function isoFromSeconds(seconds: number): string {
  return portalNowIso(seconds * 1000)
}

// Section 3.4 steps 3 and 4: the unknown user sent /start <token>. `ticket` is ticketValue() for the key set that verified
// the token; `flags` and `expirySeconds` are the verified token's. Over the per-user limit -> R-TOO-MANY with nothing written.
export async function recordPendingStart(
  db: JoinDb,
  env: PortalTelegramEnv,
  args: { tg: number; ticket: string; flags: number; expirySeconds: number },
  nowMs: number = Date.now(),
): Promise<JoinReply> {
  const limits = getPlanLimits(env)
  const result = await db.prepare(PENDING_UPSERT_SQL).run({
    tg: args.tg,
    ticket: args.ticket,
    flags: args.flags,
    now: portalNowIso(nowMs),
    ticket_expires_at: isoFromSeconds(args.expirySeconds),
    attempt_window: secondsAgoModifier(limits.portalTelegramPendingWindowSeconds),
    attempts_max: limits.portalTelegramPendingAttemptsMax,
  })
  if (result.changes < 1) return { reply: 'R-TOO-MANY' }
  return { reply: 'R-SHARE' }
}

// Telegram first name + last name through the shared cleaner (controls, bidi and zero-width characters removed, trimmed, at
// most 80 code points); empty -> the member code.
export function joinMemberName(firstName: unknown, lastName: unknown, memberCode: string): string {
  const parts = [firstName, lastName].filter((part): part is string => typeof part === 'string')
  const name = cleanTelegramName(parts.join(' '), TELEGRAM_NAME_STORED_MAX)
  return name === '' ? memberCode : name
}

export type JoinContactUpdate = { fromId: number; contact: { userId: unknown; phoneNumber: unknown; firstName?: unknown; lastName?: unknown } }
export type JoinDeps = { mintCode?: () => string }

// Section 3.5: the unknown user shared the contact. Any pure refusal returns before any D1 call.
export async function joinFromContact(
  db: JoinDb,
  env: PortalTelegramEnv,
  update: JoinContactUpdate,
  nowMs: number = Date.now(),
  deps: JoinDeps = {},
): Promise<JoinReply> {
  const verdict = contactVerdict(update.fromId, update.contact)
  if (!verdict.ok) return { reply: verdict.reply }

  const tg = update.fromId
  const now = portalNowIso(nowMs)

  const pending = await db.prepare(PENDING_READ_SQL).get<{ ticket_hash: string; flags: number; expires_at: string }>({ tg, now })
  if (!pending) return { reply: 'R-STALE' }

  const flags = decodeStartFlags(Number(pending.flags))
  if (!flags) return { reply: 'R-STALE' }
  if (!flags.termsAccepted || !flags.ageConfirmed) return { reply: 'R-TERMS' }

  const holder = await db.prepare(PHONE_HOLDER_SQL).get({ phone: verdict.phone })
  if (holder) {
    await db.prepare(PENDING_DELETE_SQL).run({ tg })
    return { reply: 'R-PHONE-HELD' }
  }

  const limits = getPlanLimits(env)
  const mint = deps.mintCode ?? (() => mintMemberCode())
  for (let attempt = 0; attempt < JOIN_BATCH_TRIES; attempt += 1) {
    const memberCode = mint()
    const params = {
      tg,
      phone: verdict.phone,
      name: joinMemberName(verdict.firstName, verdict.lastName, memberCode),
      member_code: memberCode,
      ticket: pending.ticket_hash,
      ticket_expires_at: pending.expires_at,
      now,
      consent_version: PORTAL_CONSENT_VERSION,
      consent_locale: flags.locale ?? 'en',
      joins_max: limits.portalTelegramJoinsPerWindowMax,
      joins_window: secondsAgoModifier(limits.portalTelegramJoinsWindowSeconds),
    }
    let results: Awaited<ReturnType<JoinDb['batch']>>
    try {
      results = await db.batch([
        { sql: MEMBER_INSERT_SQL, params },
        { sql: TICKET_INSERT_SQL, params },
        { sql: PENDING_CLEAR_SQL, params },
      ])
    } catch (error) {
      if (isMemberCodeCollision(error)) continue
      const message = String((error as { message?: unknown } | null)?.message ?? error ?? '')
      if (!/UNIQUE constraint failed/i.test(message)) throw error
      // A race on the phone or the Telegram id: one read decides.
      const member = await db.prepare(TELEGRAM_MEMBER_SQL).get({ tg })
      return { reply: member ? 'R-DONE-ALREADY' : 'R-LATER' }
    }
    if (Number(results[0]?.meta?.changes ?? 0) < 1) return { reply: 'R-BUSY' }
    return { reply: 'R-JOINED', removeKeyboard: true }
  }
  return { reply: 'R-LATER' }
}
