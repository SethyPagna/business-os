// The configured online payment method ("ABA KHQR", setting online_order_payment_method) is not an ordinary tender (KHQR security review N6). The Worker lets it appear only as the
// locked online row of a Fulfil sale and refuses it on a plain sale, a settlement or a bulk relabel (online_method_requires_order), so no picker for those should offer it. The Fulfil
// row is added by the till itself (withOnlineTender), never chosen from a list.
//
// The Worker applies its refusal when the setting is stored or the online_orders switch is on; this reads the stored setting, so a shop that never configured online orders keeps "ABA KHQR"
// as the ordinary method name it may already use.
const identity = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase()

/** The stored online method name, or '' when none is configured (then nothing is hidden). */
export const hiddenOnlineMethod = (settings: unknown): string =>
  settings && typeof settings === 'object' ? String((settings as Record<string, unknown>).online_order_payment_method ?? '').trim() : ''

/** The method names a picker may offer: the configured online method removed, order and everything else kept. */
export function withoutOnlineMethod<T>(methods: readonly T[], settings: unknown): T[] {
  const hidden = identity(hiddenOnlineMethod(settings))
  return hidden ? methods.filter((method) => typeof method !== 'string' || identity(method) !== hidden) : [...methods]
}
