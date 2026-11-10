// The configured online payment method ("ABA KHQR", setting online_order_payment_method) is not an ordinary tender (KHQR security review N6). The Worker lets it appear only as the
// locked online row of a Fulfil sale and refuses it on a plain sale, a settlement or a bulk relabel (online_method_requires_order), so no picker for those should offer it. The Fulfil
// row is added by the till itself (withOnlineTender), never chosen from a list.
//
// The Worker decides when its refusal is in force (the setting is stored, or the online_orders switch is on) and publishes the method name it then refuses as
// `online_order_method_in_force` ('' while it is not), so this reads that one answer and a shop that never configured online orders keeps "ABA KHQR" as the ordinary method name it may already use.
// An older answer without the key falls back to the stored setting.
const identity = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase()

export const ONLINE_METHOD_IN_FORCE_KEY = 'online_order_method_in_force'

/** The online method name the Worker refuses on ordinary sales right now, or '' when its refusal is not in force (then nothing is hidden). */
export function hiddenOnlineMethod(settings: unknown): string {
  if (!settings || typeof settings !== 'object') return ''
  const map = settings as Record<string, unknown>
  return String((ONLINE_METHOD_IN_FORCE_KEY in map ? map[ONLINE_METHOD_IN_FORCE_KEY] : map.online_order_payment_method) ?? '').trim()
}

/** The method names a picker may offer: the configured online method removed, order and everything else kept. */
export function withoutOnlineMethod<T>(methods: readonly T[], settings: unknown): T[] {
  const hidden = identity(hiddenOnlineMethod(settings))
  return hidden ? methods.filter((method) => typeof method !== 'string' || identity(method) !== hidden) : [...methods]
}
