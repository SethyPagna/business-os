// What the Worker last said about itself in response headers, kept in module memory only.
//   X-BOS-Switches  e=<epoch>;<name>=0|1;...   which server-side speed-ups are ON (lib/readSwitches.ts)
//   X-BOS-Budget    z=<zone>;p=<percent>;r=<ISO time>   the daily D1 budget zone (P0.5)
//   X-BOS-Build     the frontend build of the Worker version that answered
//   X-BOS-Epoch     8 hex characters naming the database's data epoch
// A header that is missing, malformed or older than SIGNAL_TTL_MS counts as nothing: every switch is OFF, which is the
// behaviour of a client that never heard of switches.
//
// Two of the headers are also news. A build that is not the one this tab runs, seen for the first time, fires SERVER_BUILD_EVENT
// once; index.tsx turns it into one service-worker update check, and the worker's own byte comparison stays the only thing that
// raises the "Restart now" bar (this module never restarts anything). A new data epoch fires DATA_EPOCH_EVENT once (api/dataEpoch.ts).
import { __resetDataEpochForTests, observeDataEpoch } from './dataEpoch.ts'

declare const __FRONTEND_BUILD_HASH__: string | undefined

// Three of the longest server memos (Free, 15 s); pinned against planTier.ts readSwitchMemoSeconds in cloudflare/scripts/test-plan-tier-pure.cjs.
export const SIGNAL_TTL_MS = 45_000
export const SERVER_BUILD_EVENT = 'sync:server-build'
const BUILD_TOKEN = /^[A-Za-z0-9._-]{1,64}$/
const SWITCH_NAME = /^[a-z][a-z0-9_]{0,39}$/
const BUDGET_ZONES = new Set(['green', 'amber', 'red', 'black'])

export type BudgetZone = 'green' | 'amber' | 'red' | 'black'
export type ServerBudget = { zone: BudgetZone; percent: number | null; resetsAt: string | null }

let switches: { epoch: number; on: Set<string>; at: number } | null = null
let budget: (ServerBudget & { at: number }) | null = null
let build: string | null = null
let dataEpoch: string | null = null
let announcedBuild: string | null = null

const runningBuild = (): string => (typeof __FRONTEND_BUILD_HASH__ !== 'undefined' ? String(__FRONTEND_BUILD_HASH__ || '') : 'dev')

function announceServerBuild(next: string): void {
  const running = runningBuild()
  if (next === running) { announcedBuild = null; return }
  if (!running || running === 'dev' || next === announcedBuild) return
  announcedBuild = next
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try { window.dispatchEvent(new CustomEvent(SERVER_BUILD_EVENT, { detail: { build: next, running, ts: Date.now() } })) } catch { /* an observer never fails a response */ }
}

export function parseSwitchesHeader(value: string | null | undefined): { epoch: number; on: Set<string> } | null {
  if (typeof value !== 'string' || !value || value.length > 400) return null
  const on = new Set<string>()
  let epoch: number | null = null
  for (const part of value.split(';')) {
    const pair = /^([a-z][a-z0-9_]{0,39})=(\d{1,15})$/.exec(part.trim())
    if (!pair) return null
    if (pair[1] === 'e') epoch = Number(pair[2])
    else if (pair[2] === '1') on.add(pair[1])
    else if (pair[2] !== '0') return null
  }
  if (epoch === null || !Number.isSafeInteger(epoch)) return null
  for (const name of on) if (!SWITCH_NAME.test(name)) return null
  return { epoch, on }
}

export function parseBudgetHeader(value: string | null | undefined): ServerBudget | null {
  if (typeof value !== 'string' || !value || value.length > 200) return null
  const fields = new Map<string, string>()
  for (const part of value.split(';')) {
    const pair = /^([a-z]{1,2})=(.{1,64})$/.exec(part.trim())
    if (!pair || fields.has(pair[1])) return null
    fields.set(pair[1], pair[2])
  }
  const zone = fields.get('z')
  if (!zone || !BUDGET_ZONES.has(zone)) return null
  const percent = fields.has('p') && /^\d{1,3}$/.test(fields.get('p') as string) ? Number(fields.get('p')) : null
  const resets = fields.get('r')
  const resetsAt = resets && Number.isFinite(Date.parse(resets)) ? resets : null
  return { zone: zone as BudgetZone, percent: percent !== null && percent <= 100 ? percent : null, resetsAt }
}

/** Reads the four headers of one /api response and returns the budget this response itself carried. A newer switch epoch wins; an older one from a lagging isolate is ignored. */
export function recordServerSignals(headers: { get(name: string): string | null } | null | undefined, now: number = Date.now()): ServerBudget | null {
  if (!headers || typeof headers.get !== 'function') return null
  const parsed = parseSwitchesHeader(headers.get('X-BOS-Switches'))
  if (parsed && (!switches || now - switches.at >= SIGNAL_TTL_MS || parsed.epoch >= switches.epoch)) switches = { ...parsed, at: now }
  const nextBudget = parseBudgetHeader(headers.get('X-BOS-Budget'))
  if (nextBudget) budget = { ...nextBudget, at: now }
  const nextBuild = headers.get('X-BOS-Build')
  if (nextBuild && BUILD_TOKEN.test(nextBuild)) { build = nextBuild; announceServerBuild(nextBuild) }
  const nextEpoch = headers.get('X-BOS-Epoch')
  if (nextEpoch && /^[0-9a-f]{8}$/.test(nextEpoch)) { dataEpoch = nextEpoch; observeDataEpoch(nextEpoch, 'header') }
  return nextBudget
}

export function isServerSwitchOn(name: string, now: number = Date.now()): boolean {
  return switches !== null && now - switches.at < SIGNAL_TTL_MS && switches.on.has(name)
}

export function serverSwitchEpoch(now: number = Date.now()): number | null {
  return switches !== null && now - switches.at < SIGNAL_TTL_MS ? switches.epoch : null
}

export function serverBudget(now: number = Date.now()): ServerBudget | null {
  return budget !== null && now - budget.at < SIGNAL_TTL_MS ? { zone: budget.zone, percent: budget.percent, resetsAt: budget.resetsAt } : null
}

export const serverBuild = (): string | null => build
export const serverDataEpoch = (): string | null => dataEpoch

export function __resetServerSignalsForTests(): void {
  switches = null
  budget = null
  build = null
  dataEpoch = null
  announcedBuild = null
  __resetDataEpochForTests()
}
