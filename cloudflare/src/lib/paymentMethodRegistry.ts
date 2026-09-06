/**
 * paymentMethodRegistry -- keep Settings' configured payment methods in step
 * with the methods that are actually used on sales.
 *
 * Why this exists (user, Sep 4 2026): "the payment methods made and entered in
 * sales and so on did not get updated in the available payment methods".
 *
 * The POS method field is a free-text `<input list="pos-payment-method-options">`
 * (POS.tsx), not a `<select>` -- a cashier can type "ACLEDA" and check out with
 * it. That string is stored on `sales.payment_method` and inside
 * `sales.payment_details`, and it is what every report groups by
 * (salesAnalytics.getPaymentMethodBreakdown) -- but nothing ever wrote it back
 * into the `pos_payment_methods` setting. So the method existed everywhere
 * EXCEPT the one list that is supposed to enumerate them: Settings showed a
 * shorter list than the shop was really taking money through, the next cashier
 * got no datalist suggestion for it and re-typed it by hand (which is how
 * "ACLEDA" and "Acleda bank" become two reporting dimensions), and the daily
 * report's method filter could not offer it at all.
 *
 * The merge is deliberately server-side and shared by every writer -- the POS
 * checkout, the deferred-payment settle on the Sales page, and the sales
 * importer -- because the user's ask says "in sales and so on". A frontend-only
 * fix would have covered exactly one of the three.
 *
 * Everything here is pure so scripts/test-payment-method-registry-pure.cjs can
 * execute the rules rather than pattern-match a route file; the single I/O
 * wrapper lives in routes/sales.ts.
 */

/** Matches the trim+lowercase identity settings.ts already uses for rename/merge. */
export function paymentMethodKey(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

/**
 * The stored setting is a JSON array of strings. A malformed or absent value
 * reads as an empty list rather than throwing -- the same tolerance
 * settings.ts's own loadPaymentMethods() applies, because a checkout must
 * never fail on a settings-parse error.
 */
export function parseConfiguredMethods(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeMethodList(raw)
  const text = String(raw ?? '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? normalizeMethodList(parsed) : []
  } catch {
    return []
  }
}

export type StrictConfiguredMethodsResult =
  | { ok: true; methods: string[] }
  | { ok: false; methods: []; error: 'invalid_payment_methods_setting' }

/**
 * Strict mutation-time parser. Reads may tolerate a damaged setting, but a
 * money write must never reinterpret malformed JSON as an empty active list.
 */
export function parseConfiguredMethodsStrict(raw: unknown): StrictConfiguredMethodsResult {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return { ok: false, methods: [], error: 'invalid_payment_methods_setting' }
    try { parsed = JSON.parse(text) } catch {
      return { ok: false, methods: [], error: 'invalid_payment_methods_setting' }
    }
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || !String(value).trim() || String(value).trim().length > MAX_METHOD_LENGTH)) {
    return { ok: false, methods: [], error: 'invalid_payment_methods_setting' }
  }
  const suppliedKeys = parsed.map(paymentMethodKey)
  if (new Set(suppliedKeys).size !== suppliedKeys.length) {
    return { ok: false, methods: [], error: 'invalid_payment_methods_setting' }
  }
  const methods = normalizeMethodList(parsed)
  if (!methods.length || methods.length > MAX_CONFIGURED_METHODS) {
    return { ok: false, methods: [], error: 'invalid_payment_methods_setting' }
  }
  return { ok: true, methods }
}

function normalizeMethodList(values: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    // A non-string entry is corrupt settings, not a method. Coercing it would
    // put "7" or "null" in the shop's checkout list, where a cashier can then
    // select it and record a sale against it -- which is worse than the
    // corruption it came from, because it becomes real data. Skip it.
    if (typeof value !== 'string') continue
    const method = value.trim()
    const key = paymentMethodKey(method)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(method.length > MAX_METHOD_LENGTH ? method.slice(0, MAX_METHOD_LENGTH).trim() : method)
  }
  return out
}

/**
 * Retired methods must NOT be resurrected by a sale that still carries them.
 * POS.tsx already filters these two out of the datalist it renders; if the
 * merge re-added them from an old sale, the next settings save would write
 * them back and they would reappear as checkout choices -- the retirement
 * would silently undo itself. Kept as one list beside the merge that has to
 * honour it. (`pos.tsx`'s copy is the display filter; this one is the write
 * filter. Both are needed: neither position can cover the other.)
 */
export const RETIRED_PAYMENT_METHODS = new Set(['pi pay', 'transfer'])

/**
 * Hard ceiling on how many methods the setting may hold. A method name comes
 * from a free-text field, so a till with a typo-happy cashier (or a replayed
 * offline queue) could otherwise grow this list without bound -- and it is
 * read on every POS boot. 60 is far above any real shop's count and far below
 * anything that would matter to parse.
 */
export const MAX_CONFIGURED_METHODS = 60

/** Same cap the sale writer applies to a single method string. */
export const MAX_METHOD_LENGTH = 80

export interface MergePaymentMethodsResult {
  /** The list to store. Identical (by reference-free equality) to `configured` when nothing was added. */
  methods: string[]
  /** Exactly the methods this merge appended, in the order they were seen. */
  added: string[]
  /** False when the caller should skip the settings write entirely. */
  changed: boolean
}

/**
 * Append any used method that is not already configured, preserving the
 * configured order and the operator's own capitalisation for methods that
 * already exist.
 *
 * The identity is case-insensitive on purpose: a cashier typing "aba bank"
 * must NOT create a second entry beside "ABA Bank". When a method is new, the
 * spelling that reaches the list is the one that was typed -- there is no
 * title-casing here, because "KHQR" and "Wing" would both come out wrong.
 */
export function mergePaymentMethods(configured: string[], used: unknown[]): MergePaymentMethodsResult {
  const methods = normalizeMethodList(configured)
  const seen = new Set(methods.map(paymentMethodKey))
  const added: string[] = []

  for (const value of used) {
    const method = String(value ?? '').trim().slice(0, MAX_METHOD_LENGTH)
    const key = paymentMethodKey(method)
    if (!key) continue
    if (seen.has(key)) continue
    if (RETIRED_PAYMENT_METHODS.has(key)) continue
    if (methods.length >= MAX_CONFIGURED_METHODS) break
    seen.add(key)
    methods.push(method)
    added.push(method)
  }

  return { methods, added, changed: added.length > 0 }
}

/**
 * The methods one sale actually used. Reads the itemised tender list first
 * (that is the authoritative record and is what settings.ts's rename walks),
 * and falls back to the summary column.
 *
 * `payment_method` is a SUMMARY, not a method: the sale writer joins a split
 * payment with ' + ' ("Cash + ABA Bank"), so registering it verbatim would
 * create a phantom third method that no cashier ever chose and that no report
 * can ever group by. It is split back apart here, and only used at all when
 * there is no itemised list to read.
 */
export function saleMethodsUsed(input: {
  payment_method?: unknown
  payment_details?: unknown
}): string[] {
  const details = parsePaymentDetailMethods(input.payment_details)
  if (details.length) return details
  return String(input.payment_method ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}

function parsePaymentDetailMethods(raw: unknown): string[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return []
    try {
      list = JSON.parse(text)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((entry) => String((entry as { method?: unknown } | null)?.method ?? '').trim())
    .filter(Boolean)
}

/**
 * ---- Method KIND: which configured methods are drawer cash ----------------
 *
 * A shift reconciliation has to answer "how much of what was tendered is
 * physically in the drawer", and until now the only answer in the codebase was
 * two string literals inside lib/telegram.ts:
 *
 *     if (method === 'cash' || method === 'សាច់ប្រាក់')
 *
 * That is a name check masquerading as a type check. The POS method field is
 * free text merged into `pos_payment_methods` by mergePaymentMethods() above,
 * and settings.ts's /payment-methods/replace lets the operator rename a method
 * across the whole history -- so "Cash" becoming "Cash USD" silently turned a
 * full drawer into $0.00 of recorded cash, with no error and no review flag.
 *
 * The kind is therefore resolved in this order:
 *
 *   1. `pos_payment_method_kinds` -- an explicit {method: kind} map the
 *      operator can pin. It wins outright, so ANY rename can be made correct.
 *   2. A cash TOKEN in the name. This covers every rename that keeps the word
 *      ("Cash", "Cash (USD)", "Cash drawer", "សាច់ប្រាក់ដុល្លារ") instead of
 *      only the two exact spellings the literals matched.
 *   3. Otherwise digital -- a bank transfer is not drawer cash.
 *
 * And when NOTHING resolves to cash, the reconciliation says so
 * (`cash_method_unresolved`) rather than reporting an empty drawer: a shop
 * that renamed its cash method to "Drawer" gets a visible review flag, which
 * is the honest answer, not a $0.00 expectation that reads as theft.
 */
export type PaymentMethodKind = 'cash' | 'digital'
export type PaymentMethodKindMap = Record<string, PaymentMethodKind>

/** Substrings that make a method name drawer cash. Lowercased; Khmer has no case. */
export const CASH_METHOD_TOKENS = ['cash', 'សាច់ប្រាក់'] as const

/** The settings key holding the explicit override map. */
export const PAYMENT_METHOD_KINDS_SETTING = 'pos_payment_method_kinds'

/**
 * `{"Cash USD": "cash", "ABA": "digital"}` -> keyed by paymentMethodKey.
 * Malformed settings read as an empty map: an override that cannot be parsed
 * must fall back to the token rule, never make every method digital.
 */
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

/**
 * True when at least one CONFIGURED method is drawer cash. False is the
 * rename-broke-it signal: the shop is still taking cash, but no name in the
 * checkout list can be recognised as cash any more.
 */
export function hasConfiguredCashMethod(configured: string[], kinds: PaymentMethodKindMap = {}): boolean {
  return configured.some((method) => isCashPaymentMethod(method, kinds))
}
