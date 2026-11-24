import type { D1Compat } from './db'
import { getPlanLimits } from './planTier'
import { replyLanguage, type PortalTelegramLang } from './portalTelegramText'
import {
  isCorrectChoice,
  matchOptions,
  portalNowIso,
  secondsAgoModifier,
  ticketValue,
  verifyStartToken,
  type PortalTelegramEnv,
  type PortalTelegramReplyId,
  type VerifiedStartToken,
} from './portalTelegramToken'

// G38 S3c: a known member sends /start <token> (section 3.3) and taps a confirm button (section 3.7).
// Statements are section 7 "Known member (S3c)" word for word, each its own string with no comment.
// The route (S3e) turns an outcome into one Bot API reply with lib/portalTelegramText.ts. Nothing mounts this file yet.

type SignInDb = Pick<D1Compat, 'prepare' | 'batch'>

// S-K1
const S_K1 = 'SELECT id, name, status FROM portal_accounts WHERE telegram_user_id = @tg LIMIT 1'

// S-K2: read first, so ticket_exists is the state before the insert.
export const S_K2 = `SELECT a.id AS account_id, a.status,
       EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @ticket) AS ticket_exists,
       (SELECT COUNT(*) FROM (
          SELECT 1 FROM portal_sessions s
          WHERE s.account_id = a.id
            AND datetime(s.created_at) > datetime(@now, @cap_window)
          LIMIT @cap_max)) AS recent_sessions
FROM portal_accounts a
WHERE a.telegram_user_id = @tg`

// S-C3: the ticket row.
export const S_C3 = `INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at)
SELECT a.id, @ticket, @ticket_expires_at, @now, @now
FROM portal_accounts a
WHERE a.telegram_user_id = @tg
  AND a.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @ticket)
  AND (SELECT COUNT(*) FROM (
         SELECT 1 FROM portal_sessions s
         WHERE s.account_id = a.id
           AND datetime(s.created_at) > datetime(@now, @cap_window)
         LIMIT @cap_max)) < @cap_max`

// S-C4: the member's last_seen_at, at most daily, only when the ticket row exists.
export const S_C4 = `UPDATE portal_accounts SET last_seen_at = @now
WHERE telegram_user_id = @tg
  AND status = 'active'
  AND (last_seen_at IS NULL OR datetime(last_seen_at) < datetime(@now, @seen_window))
  AND EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = @ticket)`

export type ConfirmButton = { text: string; data: string }

export type SignInReply = {
  kind: 'reply'
  id: PortalTelegramReplyId
  lang: PortalTelegramLang
  // HH:MM in Cambodia time for the replies that show it; null otherwise.
  startedHm: string | null
  // R-CONFIRM only: the member's stored name, for "as <name>" (portalTelegramReplyText cleans it).
  memberName?: string | null
  // R-CONFIRM only: the three buttons in order; button i carries choice digit i.
  buttons?: ConfirmButton[]
}

export type StartOutcome =
  | SignInReply
  // S-K1 found no member: the route hands the verified token to the new shopper's join (S3d).
  | { kind: 'not-member'; verified: VerifiedStartToken; lang: PortalTelegramLang }

// Cambodia has no daylight saving: UTC+7 all year (Asia/Phnom_Penh).
export function phnomPenhHm(epochSeconds: number): string {
  const shifted = new Date((epochSeconds + 7 * 3600) * 1000)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

function reply(id: PortalTelegramReplyId, lang: PortalTelegramLang, startedHm: string | null = null, buttons?: ConfirmButton[]): SignInReply {
  return buttons ? { kind: 'reply', id, lang, startedHm, buttons } : { kind: 'reply', id, lang, startedHm }
}

export function confirmButtons(token: string, verified: Pick<VerifiedStartToken, 'code' | 'firstMacByte'>): ConfirmButton[] {
  return matchOptions(verified.code, verified.firstMacByte).map((option, index) => ({ text: String(option), data: `c${token}${index}` }))
}

// Section 3.3: calls 2 for the route (M, S-K1), writes 0. A bad or expired token makes 0 D1 calls here.
export async function startForKnownMember(
  env: PortalTelegramEnv,
  db: SignInDb,
  input: { token: unknown; fromId: number; languageCode: string | null },
  nowMs: number = Date.now(),
): Promise<StartOutcome> {
  const verified = await verifyStartToken(env, input.token, nowMs)
  if (!verified) return reply('R-STALE', replyLanguage(null, input.languageCode))
  const lang = replyLanguage(verified.locale, input.languageCode)
  const member = await db.prepare(S_K1).get<{ id: number; name: string | null; status: string }>({ tg: input.fromId })
  if (!member) return { kind: 'not-member', verified, lang }
  if (member.status !== 'active') return reply('R-PAUSED', lang)
  const startedHm = phnomPenhHm(verified.startedAtSeconds)
  return { ...reply('R-CONFIRM', lang, startedHm, confirmButtons(input.token as string, verified)), memberName: typeof member.name === 'string' ? member.name : null }
}

type BatchResult = { results?: Array<Record<string, unknown>>; meta?: { changes?: number } }

// Section 3.7: a known member taps a number. One D1 call (the batch); a bad MAC, an expired token and a wrong
// number make none. Writes: the ticket row (3 with its index entries and sequence), plus 2 when the daily stamp is due.
export async function confirmKnownMember(
  env: PortalTelegramEnv,
  db: SignInDb,
  input: { token: unknown; choice: number; fromId: number; languageCode: string | null },
  nowMs: number = Date.now(),
): Promise<SignInReply> {
  const verified = await verifyStartToken(env, input.token, nowMs)
  if (!verified) return reply('R-STALE', replyLanguage(null, input.languageCode))
  const lang = replyLanguage(verified.locale, input.languageCode)
  if (!isCorrectChoice(verified.code, verified.firstMacByte, input.choice)) return reply('R-WRONG-CODE', lang)
  const ticket = await ticketValue(env, verified)
  if (!ticket) return reply('R-STALE', lang)

  const limits = getPlanLimits(env)
  const capMax = limits.portalTelegramSessionsPerMemberMax
  const params = {
    tg: input.fromId,
    ticket,
    now: portalNowIso(nowMs),
    ticket_expires_at: new Date(verified.expiry * 1000).toISOString(),
    cap_window: secondsAgoModifier(limits.portalTelegramSessionsPerMemberWindowSeconds),
    cap_max: capMax,
    seen_window: secondsAgoModifier(limits.portalMemberSeenIntervalSeconds),
  }
  const [read, insert] = (await db.batch([
    { sql: S_K2, params },
    { sql: S_C3, params },
    { sql: S_C4, params },
  ])) as BatchResult[]

  const row = read?.results?.[0]
  if (!row) return reply('R-STALE', lang)
  if (row.status !== 'active') return reply('R-PAUSED', lang)
  if (Number(row.ticket_exists) === 1) return reply('R-USED', lang)
  if (Number(row.recent_sessions) >= capMax) return reply('R-CAP', lang)
  // At least 1, not exactly 1 (errata E9). A 0 here means another tap won the race between the read and the insert.
  if (Number(insert?.meta?.changes ?? 0) < 1) return reply('R-USED', lang)
  return reply('R-SIGNED-IN', lang, phnomPenhHm(verified.startedAtSeconds))
}
