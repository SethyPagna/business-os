// Which payment methods are drawer cash, for the frontend (owner, 27 Oct 2026: riel paid in cash is whole 100-riel
// notes, any riel by other methods). The declarations below are copied byte for byte from
// cloudflare/src/lib/paymentMethodRegistry.ts, the Worker's one definition (an explicit pos_payment_method_kinds pin
// wins, then a cash token in the name, else digital); tests/paymentMethodKindParity.test.ts enforces that they stay
// identical and drives both through the same fixtures.
import { rielCashAmountValid } from './saleStatusResolution.ts'

export function paymentMethodKey(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export type PaymentMethodKind = 'cash' | 'digital'

export type PaymentMethodKindMap = Record<string, PaymentMethodKind>

export const CASH_METHOD_TOKENS = ['cash', 'សាច់ប្រាក់'] as const

export function parsePaymentMethodKinds(raw: unknown): PaymentMethodKindMap {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return {}
    try { parsed = JSON.parse(text) } catch { return {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: PaymentMethodKindMap = {}
  for (const [method, kind] of Object.entries(parsed as Record<string, unknown>)) {
    const key = paymentMethodKey(method)
    if (!key) continue
    const value = String(kind ?? '').trim().toLowerCase()
    if (value === 'cash' || value === 'digital') out[key] = value
  }
  return out
}

export function resolvePaymentMethodKind(method: unknown, kinds: PaymentMethodKindMap = {}): PaymentMethodKind {
  const key = paymentMethodKey(method)
  if (!key) return 'digital'
  const declared = kinds[key]
  if (declared) return declared
  return CASH_METHOD_TOKENS.some((token) => key.includes(token)) ? 'cash' : 'digital'
}

export function isCashPaymentMethod(method: unknown, kinds: PaymentMethodKindMap = {}): boolean {
  return resolvePaymentMethodKind(method, kinds) === 'cash'
}

/** Is this riel amount, paid by this method, refused as cash that is not whole 100-riel notes? */
export function rielCashFieldInvalid(method: unknown, khr: unknown, kinds: PaymentMethodKindMap = {}): boolean {
  return !rielCashAmountValid(khr) && isCashPaymentMethod(method, kinds)
}
