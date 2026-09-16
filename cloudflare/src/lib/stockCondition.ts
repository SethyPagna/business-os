// P3-L6: the condition tags a held (non-sellable) stock row can carry, and the
// movement-type contract that keeps "held" and "lost" from being counted twice.
//
// ONE definition, two packages. frontend/src/utils/stockCondition.ts mirrors
// this file verbatim in its list and its order; frontend/tests/
// stockConditionTag.test.ts fails if the two ever drift. Nothing here is
// translated: the owner's rule is that the tag itself "remains english even in
// khmer", so the token that is stored, sent, rendered on the tagged child row
// and printed into the movement's reason text is the same English word in
// every language. Only the surrounding chrome (the control's label, the row
// actions) goes through the packs.

export const STOCK_CONDITION_TAGS = ['broken', 'damaged', 'expired', 'opened', 'other'] as const
export type StockConditionTag = (typeof STOCK_CONDITION_TAGS)[number]

/** Who created a damaged_stock_lots row (migration 0162 `source`). */
export const STOCK_CONDITION_SOURCES = ['return', 'remove', 'restock'] as const
export type StockConditionSource = (typeof STOCK_CONDITION_SOURCES)[number]

/** The tag a row gets when a writer records one without naming a tag -- the
 *  identity 0074's returns rows always had implicitly, and what migration
 *  0162 backfilled them with. */
export const DEFAULT_STOCK_CONDITION_TAG: StockConditionTag = 'damaged'

/**
 * The movement type written when units LEAVE sellable stock but stay owned as
 * a tagged row, and the one written when a tagged row is finally destroyed.
 *
 * These are deliberately different, and the difference is the whole
 * double-count guard. A keep-as-tagged removal is not a loss: the goods are
 * still in the building, still on the books, and the owner can still sell,
 * restore or dispose of them. The loss is booked exactly once, at disposal.
 * Any loss report that counts stock outflow at cost must therefore count
 * TAGGED_DISPOSAL_MOVEMENT_TYPE (and a plain untagged `remove`), and must NOT
 * count TAGGED_HOLD_MOVEMENT_TYPE -- otherwise a keep-then-dispose of the same
 * unit is charged to the business twice.
 */
export const TAGGED_HOLD_MOVEMENT_TYPE = 'damage_out'
export const TAGGED_DISPOSAL_MOVEMENT_TYPE = 'write_off'
/** The movement type that puts a held unit back into sellable stock. */
export const TAGGED_RESTORE_MOVEMENT_TYPE = 'in'

/**
 * reference_id marker on every movement this feature writes. The Stock Change
 * ledger's revert (lib/stockRevert.ts) is an allowlist on movement_type alone,
 * and 'in' IS on that allowlist -- so without this marker a restore-to-sellable
 * could be "reverted" from the ledger, taking the units back out of sellable
 * stock while quantity_remaining on the tagged row stayed where the restore
 * left it. The units would exist in neither place. stockRevert refuses any
 * movement carrying this marker and points at the tagged row's own actions,
 * which are the real reversal for these transitions.
 */
export const DAMAGED_LOT_REFERENCE_PREFIX = 'damaged_lot:'

export function damagedLotReference(lotId: number | string): string {
  return `${DAMAGED_LOT_REFERENCE_PREFIX}${lotId}`
}

export function isDamagedLotReference(referenceId: unknown): boolean {
  return String(referenceId ?? '').startsWith(DAMAGED_LOT_REFERENCE_PREFIX)
}

export function isStockConditionTag(value: unknown): value is StockConditionTag {
  return (STOCK_CONDITION_TAGS as readonly string[]).includes(String(value ?? ''))
}

/**
 * Wire coercion for a request field. Absent/blank means "no tag" (an ordinary
 * removal or an ordinary receipt) and answers null; anything present that is
 * not one of the five constants is refused rather than silently defaulted,
 * because a defaulted tag would file units under a condition nobody chose.
 */
export function parseStockConditionTag(value: unknown): { ok: true; tag: StockConditionTag | null } | { ok: false; error: string } {
  if (value == null || String(value).trim() === '') return { ok: true, tag: null }
  const raw = String(value).trim().toLowerCase()
  if (!isStockConditionTag(raw)) {
    return { ok: false, error: `Unknown condition tag "${String(value)}". Use one of: ${STOCK_CONDITION_TAGS.join(', ')}.` }
  }
  return { ok: true, tag: raw }
}

/** The reason text a tagged movement carries, so the ledger shows the tag
 *  without a schema change on inventory_movements: "damaged: broke in transit". */
export function taggedReasonText(tag: StockConditionTag, reason: string | null | undefined): string {
  const trimmed = String(reason ?? '').trim()
  return trimmed ? `${tag}: ${trimmed}` : tag
}
