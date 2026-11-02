import { recordAnalytics } from './analytics'
import { resolvePlanTier } from './planTier'
import { readSwitchState } from './readSwitches'
import { ReportMoneyPrecisionError } from './reportMoneyPrecision'
import type { Env } from '../index'

// The `report_atomic` switch for the report chain (P1.4). OFF is the exact pre-chain reader, kept in salesAnalytics.ts as
// the *Legacy functions; ON is the bounded atomic batch. `shadow:<rate>` serves OFF and, on a sampled request, also runs ON
// and compares the two final results. A shadow never doubles calls on the Free plan, where 50 calls is the whole budget.
export const REPORT_ATOMIC_SWITCH = 'report_atomic'
export type ReportAtomicMode = 'off' | 'on' | 'shadow'

let sampler: () => number = Math.random
export function setReportShadowSamplerForTests(next: (() => number) | null): void {
  sampler = next ?? Math.random
}

export async function reportAtomicMode(env: Env): Promise<ReportAtomicMode> {
  const reading = await readSwitchState(env, REPORT_ATOMIC_SWITCH)
  if (reading.state === 'on') return 'on'
  if (reading.state !== 'shadow' || resolvePlanTier(env) === 'free') return 'off'
  return sampler() < reading.rate ? 'shadow' : 'off'
}

export function reportCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return '[' + value.map(reportCanonicalJson).join(',') + ']'
  const record = value as Record<string, unknown>
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + reportCanonicalJson(record[key])).join(',') + '}'
}

// Field names only, never values: the log line and the datapoint must not carry business data.
function differingPaths(left: unknown, right: unknown, path: string, depth: number, out: string[]): void {
  if (out.length >= 8 || reportCanonicalJson(left) === reportCanonicalJson(right)) return
  const objects = left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)
  if (!objects || depth === 0) { out.push(path || '(root)'); return }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differingPaths(a[key], b[key], path ? `${path}.${key}` : key, depth - 1, out)
}

async function shadowCompare<T>(env: Env, route: string, served: T, legacy: () => Promise<T>, atomic: () => Promise<T>): Promise<void> {
  let outcome = 'match'
  let detail: string[] = []
  const servedJson = reportCanonicalJson(served)
  try {
    const candidate = await atomic()
    if (reportCanonicalJson(candidate) !== servedJson) {
      // A write between the two reads is not a difference: read the served side again and call it a mismatch only if that held still.
      const again = await legacy()
      if (reportCanonicalJson(again) === servedJson) {
        outcome = 'mismatch'
        differingPaths(served, candidate, '', 2, detail)
      } else outcome = 'write_between'
    }
  } catch (error) {
    outcome = error instanceof ReportMoneyPrecisionError ? `refused:${error.code}` : 'error'
  }
  recordAnalytics(env, { kind: 'report_atomic_shadow', labels: [route, outcome, ...detail.slice(0, 6)], values: [servedJson.length] })
  if (outcome === 'mismatch' || outcome === 'error') console.error(`[report_atomic] shadow ${route}: ${outcome} ${detail.join(',')}`)
}

/** OFF and unsampled shadow run `legacy`; ON runs `atomic`; a sampled shadow serves `legacy` and checks it against `atomic`. */
export async function routeReportRead<T>(
  env: Env, route: string, legacy: () => Promise<T>, atomic: () => Promise<T>, options: { compare?: boolean } = {},
): Promise<T> {
  const mode = await reportAtomicMode(env)
  if (mode === 'on') return atomic()
  const served = await legacy()
  if (mode === 'shadow' && options.compare !== false) await shadowCompare(env, route, served, legacy, atomic)
  return served
}
