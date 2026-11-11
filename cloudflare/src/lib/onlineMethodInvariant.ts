// KHQR round 8: the ONE invariant on the stored online (KHQR) payment method M, shared by every writer of the three settings keys
// (`online_order_payment_method`, `pos_payment_methods`, `pos_payment_method_kinds`).
//
// Whenever M exists, after ANY write:
//   (a) M, folded with methodFold, is in the till's payment-method list          -> 'not_listed'
//   (b) M is not cash-kind (token rule or an explicit kind)                       -> 'cash_kind'
//   (c) no OTHER list entry folds to the same key as M                            -> 'duplicate'
//   (d) a write that changes M's identity, merges into or out of M, or changes M's kind is made by an administrator
//   (e) when M's identity changes, the new name is not used by recent ordinary sales (ONLINE_METHOD_IN_USE_GUARD_SQL in lib/onlineOrderFulfil.ts)
//
// How a writer uses it (the same three steps everywhere):
//   1. JS builds the state the write would leave behind (`after`) and asks judgeOnlineMethodWrite(before, after): a clause that the stored state already broke
//      (a stale method) is tolerated, so it never traps an unrelated edit; a NEW break is refused with its friendly code.
//   2. The writer appends onlineMethodFinalGuard(after, ...) as the LAST statement of its own write batch. It is evaluated in SQL at write time, after the writes, on the
//      rows the batch leaves behind: it aborts the batch unless the three keys read exactly the judged state (so a racing write to any of them cannot slip a method past the
//      judgement, the cash-kind clause included, which is JS-only knowledge) and (a) / (c) hold in SQL as well. No extra D1 call: it is one more statement in a batch.
//   3. The error text of the abort is mapped to a code by onlineMethodGuardCode.
// A method stored with stray ASCII whitespace (a restore or a direct write is the only way) is read through normalizeOnlineMethod on both sides, never trapping a save.
//
// Self-contained on purpose (only the payment-method registry): routes/settings.ts, routes/sales.ts and lib/backup.ts all import it.

import { isCashPaymentMethod, parsePaymentMethodKinds, paymentMethodKey, PAYMENT_METHOD_KINDS_SETTING, resolvePaymentMethodKind } from './paymentMethodRegistry'

export const ONLINE_METHOD_SETTING_KEY = 'online_order_payment_method'
export const PAYMENT_METHOD_LIST_SETTING_KEY = 'pos_payment_methods'
export const PAYMENT_METHOD_KINDS_SETTING_KEY = PAYMENT_METHOD_KINDS_SETTING
/** The three keys whose writers must keep the invariant. */
export const ONLINE_METHOD_INVARIANT_KEYS = [ONLINE_METHOD_SETTING_KEY, PAYMENT_METHOD_LIST_SETTING_KEY, PAYMENT_METHOD_KINDS_SETTING] as const

/** The fold SQLite's lower(trim(x)) applies: spaces trimmed, A-Z lower-cased, every other character as it is. JS toLowerCase() also folds non-ASCII capitals, so a comparison across JS and SQL must use this on both sides. */
export const methodFold = (value: unknown): string => String(value ?? '').replace(/^ +| +$/g, '').replace(/[A-Z]/g, (letter) => letter.toLowerCase())

/** M as it is READ: ASCII whitespace (space, tab, newline, vertical tab, form feed, CR) stripped from both ends, exactly what ONLINE_METHOD_NORMALIZED_SQL does in SQL. Writers store it already trimmed. */
export const normalizeOnlineMethod = (value: unknown): string => String(value ?? '').replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '')

/**
 * The ONE identity test between the online method and another name, used for the administrator check and the merge refusals alike: equal under methodFold (the SQL fold)
 * OR under paymentMethodKey (the fold the rename/merge loop and the kinds map use). Either match counts, so a non-ASCII capital ("ÉPay" / "épay") can never be
 * invisible to one of the checks and visible to the other (round 7, E1).
 */
export function sameOnlineIdentity(online: unknown, name: unknown): boolean {
  const a = normalizeOnlineMethod(online)
  const b = normalizeOnlineMethod(name)
  if (!a || !b) return false
  return methodFold(a) === methodFold(b) || paymentMethodKey(a) === paymentMethodKey(b)
}

/** The method a Fulfil rings while no method is stored (online ordering ON). */
export const ONLINE_METHOD_DEFAULT = 'ABA KHQR'

/**
 * KHQR round 9 (F1): the method actually IN FORCE as the online method, the single answer every check and refusal asks. The stored method, or the default while online ordering
 * is ON and nothing is stored (Fulfil rings that default, the till hides it); '' when there is none (OFF and nothing stored). The identity tests above run on this, never on the
 * stored row alone, so the reserved method is the one actually used.
 */
export function effectiveOnlineMethod(stored: unknown, onlineOrdersOn: boolean): string {
  const text = String(stored ?? '').trim()
  return text || (onlineOrdersOn ? ONLINE_METHOD_DEFAULT : '')
}

/**
 * KHQR round 9 (F3): does this payment-method NAME (a sale row, a relabel target, a settlement row) name the online method? ONE answer for create, settle, amend, exchange,
 * replacement and import: the same normalised identity the settlement planner resolves a typed name with (paymentMethodKey: JS trim of every Unicode white space + locale
 * lower-casing, so a name with a tab, no-break space or ideographic space at either end, a leading newline, or a non-ASCII case twin ("épay" for "ÉPay") all name it) OR the SQL fold (sameOnlineIdentity). False for an empty side.
 */
export const namesOnlineMethod = (online: unknown, name: unknown): boolean => sameOnlineIdentity(online, name)

export type OnlineMethodViolation ='not_listed' | 'cash_kind' | 'duplicate'
export type OnlineMethodState = { method: unknown; listRaw: unknown; kindsRaw: unknown }

/** The list entries as stored, strings only: no de-duplication, because clause (c) is about duplicates. Unreadable or non-array text reads as an empty list, as the SQL below does. */
function listEntries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string')
  const text = String(raw ?? '')
  if (!text.trim()) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/** The clauses (a)-(c) that a state breaks. No method stored means nothing to break. */
export function onlineMethodViolations(state: OnlineMethodState): OnlineMethodViolation[] {
  const method = normalizeOnlineMethod(state.method)
  if (!method) return []
  const key = methodFold(method)
  const matches = listEntries(state.listRaw).filter((entry) => methodFold(entry) === key).length
  const out: OnlineMethodViolation[] = []
  if (matches === 0) out.push('not_listed')
  if (matches > 1) out.push('duplicate')
  if (isCashPaymentMethod(method, parsePaymentMethodKinds(state.kindsRaw))) out.push('cash_kind')
  return out
}

/** True when the write changes which method is the online one (spelling-only changes keep the identity). */
export function onlineIdentityChanged(before: OnlineMethodState, after: OnlineMethodState): boolean {
  return methodFold(normalizeOnlineMethod(before.method)) !== methodFold(normalizeOnlineMethod(after.method))
}

/** True when the effective kind (cash / digital) of the online method differs between the two states: clause (d), "changes M's kind". */
export function onlineKindChanged(before: OnlineMethodState, after: OnlineMethodState): boolean {
  const method = normalizeOnlineMethod(after.method) || normalizeOnlineMethod(before.method)
  if (!method) return false
  return resolvePaymentMethodKind(method, parsePaymentMethodKinds(before.kindsRaw)) !== resolvePaymentMethodKind(method, parsePaymentMethodKinds(after.kindsRaw))
}

/**
 * The verdict on a write. A clause the BEFORE state already broke stays tolerated while the method keeps its identity (a stale method never traps an unrelated edit);
 * a changed identity, or a clause the write newly breaks, is refused. `tolerated` is what the SQL guard is told not to re-judge.
 */
export function judgeOnlineMethodWrite(before: OnlineMethodState, after: OnlineMethodState): { refused: OnlineMethodViolation | null; tolerated: OnlineMethodViolation[]; identityChanged: boolean } {
  const identityChanged = onlineIdentityChanged(before, after)
  const already = identityChanged ? new Set<OnlineMethodViolation>() : new Set(onlineMethodViolations(before))
  const post = onlineMethodViolations(after)
  return {
    refused: post.find((violation) => !already.has(violation)) ?? null,
    tolerated: post.filter((violation) => already.has(violation)),
    identityChanged,
  }
}

/** M as SQL reads it: the stored value with ASCII whitespace stripped from both ends (matches normalizeOnlineMethod). */
const ONLINE_METHOD_RAW_SQL = `COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_METHOD_SETTING_KEY}'), '')`
export const ONLINE_METHOD_NORMALIZED_SQL = `trim(${ONLINE_METHOD_RAW_SQL}, char(32, 9, 10, 11, 12, 13))`
const LIST_RAW_SQL = `COALESCE((SELECT value FROM settings WHERE key = '${PAYMENT_METHOD_LIST_SETTING_KEY}'), '')`
const KINDS_RAW_SQL = `COALESCE((SELECT value FROM settings WHERE key = '${PAYMENT_METHOD_KINDS_SETTING}'), '')`
const LIST_MATCHES_SQL = `(SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(${LIST_RAW_SQL}) AND json_type(${LIST_RAW_SQL}) = 'array' THEN ${LIST_RAW_SQL} ELSE '[]' END) entry WHERE entry.type = 'text' AND lower(trim(entry.value)) = lower(${ONLINE_METHOD_NORMALIZED_SQL}))`

export const ONLINE_METHOD_CHANGED_CODE = 'online_method_changed'
export const ONLINE_METHOD_NOT_LISTED_CODE = 'online_method_not_listed'
export const ONLINE_METHOD_DUPLICATED_CODE = 'online_method_duplicated'

/**
 * The invariant as the LAST statement of a write batch (see the header). `@expectedMethod`, `@expectedList`, `@expectedKinds` are the raw values the judged state leaves
 * behind; `@toleratedNotListed` / `@toleratedDuplicate` are 1 only for a clause the stored state already broke.
 */
export const ONLINE_METHOD_FINAL_GUARD_SQL = `SELECT CASE
  WHEN NOT (${ONLINE_METHOD_RAW_SQL} = @expectedMethod AND ${LIST_RAW_SQL} = @expectedList AND ${KINDS_RAW_SQL} = @expectedKinds) THEN json_extract('[1]', '$[${ONLINE_METHOD_CHANGED_CODE}]')
  WHEN ${ONLINE_METHOD_NORMALIZED_SQL} = '' THEN 1
  WHEN @toleratedNotListed = 0 AND ${LIST_MATCHES_SQL} = 0 THEN json_extract('[1]', '$[${ONLINE_METHOD_NOT_LISTED_CODE}]')
  WHEN @toleratedDuplicate = 0 AND ${LIST_MATCHES_SQL} > 1 THEN json_extract('[1]', '$[${ONLINE_METHOD_DUPLICATED_CODE}]')
  ELSE 1 END`

export function onlineMethodFinalGuard(after: OnlineMethodState, tolerated: readonly OnlineMethodViolation[]): { sql: string; params: Record<string, unknown> } {
  return {
    sql: ONLINE_METHOD_FINAL_GUARD_SQL,
    params: {
      expectedMethod: String(after.method ?? ''),
      expectedList: String(after.listRaw ?? ''),
      expectedKinds: String(after.kindsRaw ?? ''),
      toleratedNotListed: tolerated.includes('not_listed') ? 1 : 0,
      toleratedDuplicate: tolerated.includes('duplicate') ? 1 : 0,
    },
  }
}

export const ONLINE_METHOD_REQUIRES_ORDER_CODE = 'online_method_requires_order'

/** The online_orders switch read from D1 inside the statement that uses it: never the memo. */
export const ONLINE_ORDERS_SWITCH_ON_SQL = `(SELECT CASE WHEN json_valid(value) THEN json_extract(value, '$.switches.online_orders') END FROM system_flags WHERE key = 'read_switches') = 'on'`

/**
 * The in-batch twin of the create/import refusal (KHQR round 9, F5): ONE statement in the writer's own batch. A sale whose payment rows name the reserved method must not commit
 * even when the method was stored (or the switch turned ON) after the route read it. `@saleMethodKeys` is a JSON array of the sale's method names folded with methodFold; the
 * reserved name is the stored method, or the default, read inside the batch (SQL lower-cases ASCII only). `@pinMethod` = 1 also aborts (as ${ONLINE_METHOD_CHANGED_CODE}, a
 * retryable conflict) when the stored method is no longer the raw value the route read (`@readMethod`): the only way a non-ASCII case twin could slip past the ASCII fold.
 * No D1 call: a statement of the existing batch.
 */
export const ONLINE_METHOD_SALE_GUARD_SQL = `SELECT CASE
  WHEN EXISTS (SELECT 1 FROM json_each(@saleMethodKeys) k WHERE k.value = lower(trim(COALESCE(NULLIF(trim((SELECT value FROM settings WHERE key = '${ONLINE_METHOD_SETTING_KEY}'), char(32, 9, 10, 11, 12, 13)), ''), '${ONLINE_METHOD_DEFAULT}')))
      AND (trim(COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_METHOD_SETTING_KEY}'), '')) <> '' OR ${ONLINE_ORDERS_SWITCH_ON_SQL})) THEN json_extract('[1]', '$[${ONLINE_METHOD_REQUIRES_ORDER_CODE}]')
  WHEN @pinMethod = 1 AND COALESCE((SELECT value FROM settings WHERE key = '${ONLINE_METHOD_SETTING_KEY}'), '') <> @readMethod THEN json_extract('[1]', '$[${ONLINE_METHOD_CHANGED_CODE}]')
  ELSE 1 END`

/** The guard statement for a sale carrying `methods`; null when there is nothing to guard. `readMethodRaw` null = no read to pin (an import commit has none). */
export function onlineMethodSaleGuard(methods: readonly string[], readMethodRaw: string | null): { sql: string; params: Record<string, unknown> } | null {
  const names = methods.map((method) => String(method ?? '').trim()).filter(Boolean)
  if (!names.length) return null
  return {
    sql: ONLINE_METHOD_SALE_GUARD_SQL,
    params: {
      saleMethodKeys: JSON.stringify(names.map(methodFold)),
      pinMethod: readMethodRaw !== null && names.some((name) => [...name].some((ch) => ch.charCodeAt(0) > 127)) ? 1 : 0,
      readMethod: readMethodRaw ?? '',
    },
  }
}

/** The abort of ONLINE_METHOD_SALE_GUARD_SQL from a failed batch's error text: 'requires_order', 'changed', or null for any other error. */
export function onlineMethodSaleGuardOutcome(error: unknown): 'requires_order' | 'changed' | null {
  const text = String(error)
  if (text.includes(ONLINE_METHOD_REQUIRES_ORDER_CODE)) return 'requires_order'
  if (text.includes(ONLINE_METHOD_CHANGED_CODE)) return 'changed'
  return null
}

/** The abort of ONLINE_METHOD_FINAL_GUARD_SQL, from the error text a failed batch carries; null when it is another error. */
export function onlineMethodGuardCode(error: unknown): typeof ONLINE_METHOD_CHANGED_CODE | typeof ONLINE_METHOD_NOT_LISTED_CODE | typeof ONLINE_METHOD_DUPLICATED_CODE | null {
  const text = String(error)
  if (text.includes(ONLINE_METHOD_CHANGED_CODE)) return ONLINE_METHOD_CHANGED_CODE
  if (text.includes(ONLINE_METHOD_NOT_LISTED_CODE)) return ONLINE_METHOD_NOT_LISTED_CODE
  if (text.includes(ONLINE_METHOD_DUPLICATED_CODE)) return ONLINE_METHOD_DUPLICATED_CODE
  return null
}

/**
 * Restore (lib/backup.ts) replaces the whole settings table with the backup's rows, so the writer cannot be judged against a before state: the restored state itself must
 * hold. A backup whose stored method breaks (a)-(c) restores without it (the method row is removed after the restore) and the restore reports why, rather than refusing a
 * disaster recovery; the owner chooses a method again.
 */
export function onlineMethodAfterRestore(state: OnlineMethodState): { clear: boolean; violations: OnlineMethodViolation[] } {
  const violations = onlineMethodViolations(state)
  return { clear: violations.length > 0, violations }
}

/** The raw value of one setting among rows read as `{key, value}`; '' when absent. */
export function rawSettingValue(rows: ReadonlyArray<{ key: string; value: string | null }>, key: string): string {
  return String(rows.find((row) => row.key === key)?.value ?? '')
}
