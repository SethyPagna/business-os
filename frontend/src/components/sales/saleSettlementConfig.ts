import { apiFetch } from '../../api/http.ts'
import { configuredSettlementMethods } from './saleSettlement.ts'

export type SettlementConfig = { configuredMethods: string[]; exchangeRate: number }

/** Missing or malformed metadata is not a verified empty method registry. */
export function parseSettlementConfig(value: unknown): SettlementConfig {
  if (!value || typeof value !== 'object' || !('pos_payment_methods' in value)) throw new Error('Payment configuration is unavailable.')
  const raw = value.pos_payment_methods
  let methods: unknown = raw
  if (typeof raw === 'string') {
    try { methods = JSON.parse(raw) } catch { throw new Error('Payment configuration is unavailable.') }
  }
  if (!Array.isArray(methods) || methods.some((method) => typeof method !== 'string')) throw new Error('Payment configuration is unavailable.')
  const rate = 'exchange_rate' in value ? Number(value.exchange_rate) : NaN
  return { configuredMethods: configuredSettlementMethods(methods), exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 4100 }
}

export function readSettlementConfig(signal: AbortSignal): Promise<SettlementConfig> {
  // A point read must not race the local settings mirror or a stale route key.
  return apiFetch('GET', `/api/settings?_settlement=${Date.now()}`, undefined, 8000, { signal }).then(parseSettlementConfig)
}

export function startSettlementConfigRead(
  read: (signal: AbortSignal) => Promise<SettlementConfig>,
  accept: (config: SettlementConfig) => void,
  fail: () => void,
): () => void {
  const controller = new AbortController()
  let cancelled = false
  void read(controller.signal).then((config) => { if (!cancelled) accept(config) }).catch(() => { if (!cancelled) fail() })
  return () => { cancelled = true; controller.abort() }
}
