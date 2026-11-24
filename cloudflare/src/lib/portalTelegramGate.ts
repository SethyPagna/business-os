import { botIdFromToken, isUsableSecret, parseWebhookCidrs, webhookSecretConfigured, type PortalTelegramEnv } from './portalTelegramToken'
import { getPlanLimits } from './planTier'
import type { D1Compat } from './db'

// G38 S3c: "is Telegram sign-in available", and the per-isolate memo of the two settings it needs.
// Design: AMEND-g38-lean-writes-1.2 sections 2.9, 8.1 and 8.3. Nothing imports this file until S3e mounts the routes.
//
// Settings keys read here (S5 adds them to the settings screen and its key lists):
//   customer_portal_telegram_signin_enabled  the switch; only the text 'true' (any case) turns it on
//   system_budget_stage                      0 normal, 1 to 3 paused; absent = 0, any other text = 3 (fail closed)

export const TELEGRAM_SIGNIN_SWITCH_KEY = 'customer_portal_telegram_signin_enabled'
export const BUDGET_STAGE_KEY = 'system_budget_stage'

// S-G1 (section 7): the one read the gate does.
const GATE_SQL = "SELECT key, value FROM settings WHERE key IN ('customer_portal_telegram_signin_enabled', 'system_budget_stage')"

export type PortalTelegramGate = { enabled: boolean; stage: number }

const GATE_OFF: PortalTelegramGate = { enabled: false, stage: 0 }

type GateDb = Pick<D1Compat, 'prepare'>

// Absent -> 0; '0' to '3' -> that stage; anything else -> 3, so a damaged value pauses rather than opens.
export function budgetStageFrom(value: unknown): number {
  if (value === undefined || value === null) return 0
  const text = String(value).trim()
  return /^[0-3]$/.test(text) ? Number(text) : 3
}

export function gateFromRows(rows: ReadonlyArray<{ key?: unknown; value?: unknown }>): PortalTelegramGate {
  let enabled = false
  let stageValue: unknown
  for (const row of rows) {
    if (row.key === TELEGRAM_SIGNIN_SWITCH_KEY) enabled = String(row.value ?? '').trim().toLowerCase() === 'true'
    else if (row.key === BUDGET_STAGE_KEY) stageValue = row.value
  }
  return { enabled, stage: budgetStageFrom(stageValue) }
}

type Memo = { value: PortalTelegramGate; at: number; graceUsed: boolean }
let memo: Memo | null = null

export function resetPortalTelegramGateMemo(): void {
  memo = null
}

// One S-G1 per memo period per isolate, once a value has resolved. A failed read keeps the previous value for one more period; with no previous
// value, or after that one period, the switch counts as off.
export async function readPortalTelegramGate(env: PortalTelegramEnv, db: GateDb, nowMs: number = Date.now()): Promise<PortalTelegramGate> {
  const periodMs = getPlanLimits(env).portalTelegramGateMemoSeconds * 1000
  if (memo && nowMs >= memo.at && nowMs - memo.at < periodMs) return memo.value
  // Only a resolved value is shared between requests. A read in flight belongs to the request that started it: awaiting
  // another request's promise can hang for good once that request answered or was cancelled (workerd), so a request that
  // finds no fresh value runs its own S-G1.
  // The memo object is its own version: every write makes a new one. A failure decides the grace only if the memo is still the
  // one this request found; if another outcome landed first (a success, or a failure that already took the grace), this one changes nothing.
  const seen = memo
  try {
    const rows = await db.prepare(GATE_SQL).all<{ key: unknown; value: unknown }>()
    const value = gateFromRows(rows)
    memo = { value, at: nowMs, graceUsed: false }
    return value
  } catch {
    if (memo !== seen) return memo ? memo.value : GATE_OFF
    if (memo && !memo.graceUsed) memo = { value: memo.value, at: nowMs, graceUsed: true }
    else memo = { value: GATE_OFF, at: nowMs, graceUsed: true }
    return memo.value
  }
}

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

export function normalizeBotUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const bare = value.startsWith('@') ? value.slice(1) : value
  return USERNAME_PATTERN.test(bare) ? bare : null
}

// True only when all six conditions hold (section 2.9). No default for any of them: a client that sets none stays dark.
export async function telegramSigninAvailable(env: PortalTelegramEnv & { PORTAL_TELEGRAM_BOT_USERNAME?: string }, gate: PortalTelegramGate): Promise<boolean> {
  if (!gate || gate.enabled !== true) return false
  if (!(await webhookSecretConfigured(env))) return false
  if (normalizeBotUsername(env.PORTAL_TELEGRAM_BOT_USERNAME) === null) return false
  if (!isUsableSecret(env.PORTAL_ABUSE_HMAC_SECRET)) return false
  if (botIdFromToken(env.PORTAL_TELEGRAM_BOT_TOKEN) === null) return false
  if (parseWebhookCidrs(env.PORTAL_TELEGRAM_WEBHOOK_CIDRS) === null) return false
  return true
}

// What /config reports as telegramSignin: available AND the budget stage is 0 (section 8.3).
export async function telegramSigninShown(env: PortalTelegramEnv & { PORTAL_TELEGRAM_BOT_USERNAME?: string }, gate: PortalTelegramGate): Promise<boolean> {
  return gate.stage === 0 && (await telegramSigninAvailable(env, gate))
}
