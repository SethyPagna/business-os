// The expense type vocabulary a component reads without importing api/feesTransport.ts: a host that replaces the transport with a fake (the
// record-report export test does) copies its functions and classes only, so a constant read from the transport is undefined there and the page
// fails to load.

/** The longest custom type name (migration 0292 and the Worker's normalizeFeeTypeName). */
export const FEE_TYPE_NAME_MAX_CHARS = 40

export type BuiltinFeeType = 'tax' | 'delivery' | 'change' | 'expense' | 'other'
/** The five built-in types: fixed, because the reports split on them. */
export const BUILTIN_FEE_TYPES: readonly BuiltinFeeType[] = ['tax', 'delivery', 'change', 'expense', 'other']
