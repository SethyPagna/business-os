// P3-L6: the frontend half of the condition-tag constants.
//
// The Worker's cloudflare/src/lib/stockCondition.ts is the definition; this
// file mirrors its LIST and ORDER exactly and frontend/tests/
// stockConditionTag.test.ts reads both sources and fails on any drift. The
// two packages cannot import from each other, so the parity test is the
// bridge -- not a comment asking the next person to remember.
//
// The tags are NOT translated. The owner's rule: "the tag remains english
// even in khmer". Every surface that renders a tag renders this token as-is
// and never routes it through t()/tr(); the test asserts that too, because a
// well-meaning later edit wrapping the label in tr() is exactly how this
// would quietly regress under km.

export const STOCK_CONDITION_TAGS = ['broken', 'damaged', 'expired', 'opened', 'other'] as const
export type StockConditionTag = (typeof STOCK_CONDITION_TAGS)[number]

export const STOCK_CONDITION_SOURCES = ['return', 'remove', 'restock'] as const
export type StockConditionSource = (typeof STOCK_CONDITION_SOURCES)[number]

export const DEFAULT_STOCK_CONDITION_TAG: StockConditionTag = 'damaged'

export function isStockConditionTag(value: unknown): value is StockConditionTag {
  return (STOCK_CONDITION_TAGS as readonly string[]).includes(String(value ?? ''))
}

/** The English tag exactly as it is stored and shown, in any language. */
export function stockConditionLabel(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  return isStockConditionTag(raw) ? raw : DEFAULT_STOCK_CONDITION_TAG
}
