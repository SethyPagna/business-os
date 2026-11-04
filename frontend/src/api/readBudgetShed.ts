// The Worker's read-budget governor refuses a class of request with 429 before it reads anything:
//   read_budget_shed      red    big reports and the stock check are paused
//   read_budget_reserved  black  only selling, payments, returns and sign-in are served
// A 429 is not an outage. The server answered, so it never reaches the health probe, never clears a cache and never starts
// a refresh. It raises one banner, rejects that one call with a typed error that says when the pause ends, and the identical
// GET is not sent again before Retry-After. Writes are never held here: selling must never stop, and the Worker decides.
import { BUSINESS_TIME_ZONE } from '../constants.ts'
import type { ServerBudget } from './serverSignals.ts'

export const READ_BUDGET_SHED_CODE = 'read_budget_shed'
export const READ_BUDGET_RESERVED_CODE = 'read_budget_reserved'
export const READ_BUDGET_EVENT = 'server:read-budget'
export const READ_BUDGET_PAUSED_KEY = 'read_budget_paused'
export const READ_BUDGET_PAUSED_MESSAGE = 'Paused until {time} to keep selling running.'
export const READ_BUDGET_BANNER_KEYS = {
  [READ_BUDGET_SHED_CODE]: 'read_budget_shed_banner',
  [READ_BUDGET_RESERVED_CODE]: 'read_budget_reserved_banner',
} as const
export const READ_BUDGET_BANNER_MESSAGES = {
  [READ_BUDGET_SHED_CODE]: 'Big reports and the stock check are paused until {time} to keep selling running.',
  [READ_BUDGET_RESERVED_CODE]: 'Only selling, payments, returns and sign-in work until {time}.',
} as const

const DEFAULT_RETRY_SECONDS = 60
const MAX_RETRY_SECONDS = 86_400
const MAX_HELD_REQUESTS = 200

export type ReadBudgetCode = typeof READ_BUDGET_SHED_CODE | typeof READ_BUDGET_RESERVED_CODE
export type ReadBudgetPause = { code: ReadBudgetCode; timeText: string; expiresAt: number }
type Hold = { until: number; pause: ReadBudgetPause }

let pause: ReadBudgetPause | null = null
let pauseTimer: ReturnType<typeof setTimeout> | null = null
const holds = new Map<string, Hold>()

export function isReadBudgetCode(code: unknown): code is ReadBudgetCode {
  return code === READ_BUDGET_SHED_CODE || code === READ_BUDGET_RESERVED_CODE
}

/** Seconds to wait: the Retry-After header, else the body's retryAfterSeconds, else a minute; never under 1 or over a day. */
export function retryAfterSeconds(header: string | null | undefined, body: unknown): number {
  for (const candidate of [header, body]) {
    const seconds = typeof candidate === 'number' ? candidate : /^\d{1,7}$/.test(String(candidate ?? '').trim()) ? Number(String(candidate).trim()) : NaN
    if (Number.isFinite(seconds) && seconds >= 1) return Math.min(Math.floor(seconds), MAX_RETRY_SECONDS)
  }
  return DEFAULT_RETRY_SECONDS
}

/** HH:MM on the business clock (Cambodia), so the sentence matches the 07:00 the owner knows. */
export function businessClockText(at: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BUSINESS_TIME_ZONE }).formatToParts(new Date(at))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00'
  return `${part('hour')}:${part('minute')}`
}

export function readBudgetSentence(template: string, timeText: string): string {
  return template.split('{time}').join(timeText)
}

const requestKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(READ_BUDGET_EVENT, { detail: { active: pause !== null, code: pause?.code ?? null, timeText: pause?.timeText ?? null } }))
}

function setPause(next: ReadBudgetPause | null): void {
  const changed = (pause?.code ?? null) !== (next?.code ?? null) || (pause?.timeText ?? null) !== (next?.timeText ?? null)
  pause = next
  if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null }
  if (next) {
    pauseTimer = setTimeout(() => { pauseTimer = null; setPause(null) }, Math.max(1_000, next.expiresAt - Date.now()))
    ;(pauseTimer as { unref?: () => void } | null)?.unref?.()
  }
  if (changed) announce()
}

/**
 * Records one 429. The pause (and its banner) lasts until the Worker's resetsAt, else until Retry-After; the identical
 * request is held until Retry-After. Returns what the typed error needs.
 */
export function noteReadBudgetShed(input: { code: ReadBudgetCode; method: string; path: string; resetsAt?: unknown; retryAfter: number }, now: number = Date.now()): ReadBudgetPause {
  const retryUntil = now + input.retryAfter * 1000
  const reset = typeof input.resetsAt === 'string' ? Date.parse(input.resetsAt) : NaN
  const expiresAt = Number.isFinite(reset) && reset > now ? Math.min(reset, now + MAX_RETRY_SECONDS * 1000) : retryUntil
  const next: ReadBudgetPause = { code: input.code, timeText: businessClockText(expiresAt), expiresAt }
  if (String(input.method).toUpperCase() === 'GET' || String(input.method).toUpperCase() === 'HEAD') {
    if (holds.size >= MAX_HELD_REQUESTS) for (const [key, hold] of holds) if (hold.until <= now) holds.delete(key)
    if (holds.size < MAX_HELD_REQUESTS) holds.set(requestKey(input.method, input.path), { until: retryUntil, pause: next })
  }
  setPause(next)
  return next
}

/** The shed answer still standing for this exact request, or null: only then is the request not sent. */
export function readBudgetHold(method: string, path: string, now: number = Date.now()): { pause: ReadBudgetPause; retryAfter: number } | null {
  const key = requestKey(method, path)
  const hold = holds.get(key)
  if (!hold) return null
  if (hold.until <= now) { holds.delete(key); return null }
  return { pause: hold.pause, retryAfter: Math.max(1, Math.ceil((hold.until - now) / 1000)) }
}

export function getReadBudgetPause(now: number = Date.now()): ReadBudgetPause | null {
  return pause !== null && pause.expiresAt > now ? pause : null
}

/** A response whose own X-BOS-Budget says green or amber ends the pause; a missing header says nothing. */
export function observeReadBudgetZone(budget: ServerBudget | null): void {
  if (!budget || (budget.zone !== 'green' && budget.zone !== 'amber') || pause === null) return
  holds.clear()
  setPause(null)
}

export function __resetReadBudgetForTests(): void {
  holds.clear()
  pause = null
  if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null }
}
