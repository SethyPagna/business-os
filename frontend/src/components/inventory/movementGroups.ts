type MovementRecord = Record<string, unknown>

type MovementGroup = {
  id: string
  movement_type: string
  movementLabel: string
  created_at: string | null
  latest_at: string | null
  reference_id: unknown
  reason: string
  branch_name: string
  user_name: string
  totalQuantity: number
  totalCostUsd: number
  totalCostKhr: number
  signedQuantity: number
  signedCostUsd: number
  signedCostKhr: number
  totalQuantityIn: number
  totalQuantityOut: number
  totalCostUsdIn: number
  totalCostUsdOut: number
  totalCostKhrIn: number
  totalCostKhrOut: number
  items: MovementRecord[]
  recordCount?: number
  productCount?: number
  productNames?: string[]
  productSummary?: string
  branchSummary?: string
  userSummary?: string
  reasonSummary?: string
}

type MovementGroupPageOptions = {
  page?: number
  pageSize?: number
}

function isMovementRecord(value: unknown): value is MovementRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMovementTimeValue(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalizedBase = raw.includes('T') ? raw : raw.replace(' ', 'T')
  if (/Z$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{4}$/i.test(normalizedBase)) {
    return normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  }
  if (/[+-]\d{2}$/i.test(normalizedBase)) return `${normalizedBase}:00`
  return `${normalizedBase}Z`
}

function minuteBucket(value: unknown): string {
  const normalized = normalizeMovementTimeValue(value)
  const date = new Date(normalized || Date.now())
  if (Number.isNaN(date.getTime())) return 'unknown'
  date.setSeconds(0, 0)
  return date.toISOString()
}

function normalizeText(value: unknown): string {
  const raw = String(value || '').trim().replace(/\s+/g, ' ')
  const lowered = raw.toLowerCase()
  if (!raw || lowered === 'undefined' || lowered === 'null' || lowered === 'nan') return ''
  return raw
}

function canonicalMovementType(type: unknown): string {
  const key = String(type || '').toLowerCase()
  if (key === 'transfer_in' || key === 'transfer_out') return 'transfer'
  return key
}

function buildGroupKey(movement: MovementRecord): string {
  const normalizedType = canonicalMovementType(movement.movement_type)
  const referenceId = movement.reference_id ? `ref:${movement.reference_id}` : ''
  if (referenceId) return `${normalizedType}|${referenceId}`

  const reason = normalizeText(movement.reason)
  const user = normalizeText(movement.user_id || movement.user_name)
  const time = minuteBucket(movement.created_at)

  if (reason) return `${normalizedType}|reason:${reason}|user:${user}|time:${time}`
  if (['purchase', 'adjustment', 'supplier_return', 'return_reversal', 'transfer'].includes(normalizedType)) {
    return `${normalizedType}|user:${user}|time:${time}`
  }
  return `${normalizedType}|id:${movement.id}`
}

function describeMovementType(type: unknown): string {
  const key = String(type || '').toLowerCase()
  const labels = {
    row_move_in: 'row move in',
    row_move_out: 'row move out',
    csv_import: 'CSV import',
  } as Record<string, string>
  if (labels[key]) return labels[key]
  return key.replace(/_/g, ' ')
}

// Translation-aware sibling of describeMovementType above. That function
// (kept as-is, still used wherever no `t()` is in scope) only ever
// space-formats the raw DB value in English -- fine for the Movements
// tab's own group rows (which build their label through
// canonicalMovementType + the Activity filter's own translated chips
// alongside it), but ProductHistoryPreviewModal's compact per-movement
// list rendered `movement.movement_type` completely raw ("row_move_in",
// "csv_import", underscores and all, in every language) since it never
// went through either path. This maps every value the backend actually
// writes (see routes/inventory.ts, routes/sales.ts, routes/returns.ts,
// lib/importEngine.ts) onto the SAME translation keys the Movements tab's
// own Activity filter already uses (sale/purchase/adjustment/transfer/
// returns/return_type_writeoff) plus the existing top-level `import` key
// for csv_import, so a Khmer-language user sees the same words in both
// places. row_move_in/row_move_out have no equivalent anywhere else in
// the app (they're only ever emitted by the same-product multi-row-merge
// write path) so those two get their own small dedicated keys instead.
export function translateMovementType(type: unknown, t?: (key: string) => string | undefined): string {
  const key = String(type || '').toLowerCase()
  const T = (k: string, fallback: string): string => (typeof t === 'function' ? t(k) : undefined) || fallback
  const canonicalKey: Record<string, [string, string]> = {
    sale: ['sale', 'Sale'],
    purchase: ['purchase', 'Purchase'],
    adjustment: ['adjustment', 'Adjustment'],
    transfer: ['transfer', 'Transfer'],
    transfer_in: ['transfer', 'Transfer'],
    transfer_out: ['transfer', 'Transfer'],
    return: ['returns', 'Return'],
    supplier_return: ['returns', 'Return'],
    return_reversal: ['return_type_writeoff', 'Write-off'],
    write_off: ['return_type_writeoff', 'Write-off'],
    csv_import: ['import', 'Import'],
    row_move_in: ['movement_type_row_move_in', 'Row move in'],
    row_move_out: ['movement_type_row_move_out', 'Row move out'],
    // Part 553: the strings the backend actually writes for these effects
    // (move-row legs, damaged goods, exchange replacements, CSV in/out) --
    // previously rendered raw/underscored because they were absent here.
    move_in: ['movement_type_move_in', 'Moved in'],
    move_out: ['movement_type_move_out', 'Moved out'],
    damage_out: ['movement_type_damage_out', 'Damaged'],
    replacement_out: ['movement_type_replacement_out', 'Replacement'],
    'in': ['stock_in', 'Stock In'],
    out: ['stock_out', 'Stock Out'],
  }
  const mapped = canonicalKey[key]
  if (mapped) return T(mapped[0], mapped[1])
  if (!key) return T('other', 'Other')
  // Unknown/future movement_type value -- still better than a raw
  // underscored string: space it out and title-case each word.
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Part 553: this down-type list is pinned EQUAL to backend
// stockLedgerQuery.ts LEDGER_OUT_TYPES by test-stock-ledger-pure.cjs -- edit
// both in the same change (the test extracts the array below by regex, so
// keep it a single inline literal right after the key lookup).
// move_out/damage_out/replacement_out/'out' were added because they are
// genuine outflows the backend writes (the move-row out leg, damaged goods,
// exchange replacements, CSV-import removals) that were previously mis-signed
// as stock IN.
function movementSign(type: unknown): -1 | 1 {
  const key = String(type || '').toLowerCase()
  if (['remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out'].includes(key)) return -1
  return 1
}

// Semantic stock-movement color map, replacing the old scheme of 13
// unrelated hand-picked colors (one per raw movement_type, no shared
// logic between them -- add/remove/sale/purchase/return/supplier_return/
// return_reversal/adjust/adjustment/set/writeoff/transfer/row_move_in/
// row_move_out each had their own independent Tailwind color). The rule
// now: red when a movement nets stock down, green when it nets stock up,
// yellow specifically for return-type movements (return/supplier_return
// -- regardless of which direction that particular return happens to
// move stock, since a customer return and a supplier return move
// opposite directions but both read as "a return" to the person looking
// at the list), neutral/gray when the quantity delta is 0 (e.g. a
// set/correction that didn't actually change anything -- the backend
// writes exactly this case as `movementType: 'set', quantity: 0`).
// Precedence: return-type check first (overrides direction), then the
// zero-delta check, then the sign-based red/green split.
const MOVEMENT_COLOR_RETURN = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
const MOVEMENT_COLOR_UP = 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
const MOVEMENT_COLOR_DOWN = 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
const MOVEMENT_COLOR_NEUTRAL = 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'

// `signedQuantity` should already carry the movement's direction (positive
// = stock went up, negative = stock went down, 0 = no net change) --
// callers pass `group.signedQuantity` for a grouped row, or
// `movementSignedValue(movement, 'quantity')` for a single raw movement.
export function movementColorClass(movementType: unknown, signedQuantity: number): string {
  const canonical = canonicalMovementType(movementType)
  if (canonical === 'return' || canonical === 'supplier_return') return MOVEMENT_COLOR_RETURN
  if (!Number.isFinite(signedQuantity) || signedQuantity === 0) return MOVEMENT_COLOR_NEUTRAL
  return signedQuantity > 0 ? MOVEMENT_COLOR_UP : MOVEMENT_COLOR_DOWN
}

// Convenience wrapper for a single raw movement record (not a group) --
// used by ProductHistoryPreviewModal, which renders individual
// `inventory_movements` rows rather than grouped ones.
export function movementColorClassForRecord(movement: MovementRecord): string {
  return movementColorClass(movement?.movement_type, movementSignedValue(movement, 'quantity'))
}

function movementSignedValue(movement: MovementRecord, field: string): number {
  const value = Number(movement?.[field] || 0)
  if (!Number.isFinite(value)) return 0
  return Math.abs(value) * movementSign(movement?.movement_type)
}

function movementAbsoluteValue(movement: MovementRecord, field: string): number {
  const value = Number(movement?.[field] || 0)
  if (!Number.isFinite(value)) return 0
  return Math.abs(value)
}

function parseMovementTime(value: unknown): Date | null {
  const normalized = normalizeMovementTimeValue(value)
  if (!normalized) return null
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeMovementTimestamp(movement: MovementRecord = {}): string | null {
  const candidates = [
    movement.movement_date,
    movement.date,
    movement.imported_at,
    movement.created_at,
  ]
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim()
    if (!raw || raw.toLowerCase() === 'invalid date') continue
    if (parseMovementTime(raw)) return raw
  }
  return String(movement.created_at || '').trim() || null
}

export function buildMovementGroups(movements: unknown[] = []): MovementGroup[] {
  const groups = new Map<string, MovementGroup>()

  for (const movement of Array.isArray(movements) ? movements : []) {
    const movementRecord = isMovementRecord(movement) ? movement : {}
    const normalizedMovement: MovementRecord = {
      ...movementRecord,
      created_at: normalizeMovementTimestamp(movementRecord),
    }
    const key = buildGroupKey(normalizedMovement)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        id: key,
        movement_type: canonicalMovementType(normalizedMovement.movement_type) || 'adjustment',
        movementLabel: describeMovementType(canonicalMovementType(normalizedMovement.movement_type)),
        created_at: normalizeMovementTimestamp(normalizedMovement),
        latest_at: normalizeMovementTimestamp(normalizedMovement),
        reference_id: normalizedMovement.reference_id || null,
        reason: normalizeText(normalizedMovement.reason),
        branch_name: normalizeText(normalizedMovement.branch_name),
        user_name: normalizeText(normalizedMovement.user_name),
        totalQuantity: movementAbsoluteValue(normalizedMovement, 'quantity'),
        totalCostUsd: movementAbsoluteValue(normalizedMovement, 'total_cost_usd'),
        totalCostKhr: movementAbsoluteValue(normalizedMovement, 'total_cost_khr'),
        signedQuantity: movementSignedValue(normalizedMovement, 'quantity'),
        signedCostUsd: movementSignedValue(normalizedMovement, 'total_cost_usd'),
        signedCostKhr: movementSignedValue(normalizedMovement, 'total_cost_khr'),
        totalQuantityIn: movementSign(normalizedMovement.movement_type) > 0 ? movementAbsoluteValue(normalizedMovement, 'quantity') : 0,
        totalQuantityOut: movementSign(normalizedMovement.movement_type) < 0 ? movementAbsoluteValue(normalizedMovement, 'quantity') : 0,
        totalCostUsdIn: movementSign(normalizedMovement.movement_type) > 0 ? movementAbsoluteValue(normalizedMovement, 'total_cost_usd') : 0,
        totalCostUsdOut: movementSign(normalizedMovement.movement_type) < 0 ? movementAbsoluteValue(normalizedMovement, 'total_cost_usd') : 0,
        totalCostKhrIn: movementSign(normalizedMovement.movement_type) > 0 ? movementAbsoluteValue(normalizedMovement, 'total_cost_khr') : 0,
        totalCostKhrOut: movementSign(normalizedMovement.movement_type) < 0 ? movementAbsoluteValue(normalizedMovement, 'total_cost_khr') : 0,
        items: [normalizedMovement],
      })
      continue
    }

    existing.items.push(normalizedMovement)
    existing.totalQuantity += movementAbsoluteValue(normalizedMovement, 'quantity')
    existing.totalCostUsd += movementAbsoluteValue(normalizedMovement, 'total_cost_usd')
    existing.totalCostKhr += movementAbsoluteValue(normalizedMovement, 'total_cost_khr')
    existing.signedQuantity += movementSignedValue(normalizedMovement, 'quantity')
    existing.signedCostUsd += movementSignedValue(normalizedMovement, 'total_cost_usd')
    existing.signedCostKhr += movementSignedValue(normalizedMovement, 'total_cost_khr')
    if (movementSign(normalizedMovement.movement_type) > 0) {
      existing.totalQuantityIn += movementAbsoluteValue(normalizedMovement, 'quantity')
      existing.totalCostUsdIn += movementAbsoluteValue(normalizedMovement, 'total_cost_usd')
      existing.totalCostKhrIn += movementAbsoluteValue(normalizedMovement, 'total_cost_khr')
    } else {
      existing.totalQuantityOut += movementAbsoluteValue(normalizedMovement, 'quantity')
      existing.totalCostUsdOut += movementAbsoluteValue(normalizedMovement, 'total_cost_usd')
      existing.totalCostKhrOut += movementAbsoluteValue(normalizedMovement, 'total_cost_khr')
    }

    const created = parseMovementTime(normalizedMovement.created_at)
    const earliest = parseMovementTime(existing.created_at)
    const latest = parseMovementTime(existing.latest_at)
    if (created && (!earliest || created < earliest)) existing.created_at = normalizeMovementTimestamp(normalizedMovement)
    if (created && (!latest || created > latest)) existing.latest_at = normalizeMovementTimestamp(normalizedMovement)

    if (!existing.reason && normalizedMovement.reason) existing.reason = normalizeText(normalizedMovement.reason)
    if (!existing.branch_name && normalizedMovement.branch_name) existing.branch_name = normalizeText(normalizedMovement.branch_name)
    if (!existing.user_name && normalizedMovement.user_name) existing.user_name = normalizeText(normalizedMovement.user_name)
  }

  return Array.from(groups.values())
    .map((group): MovementGroup => {
      const uniqueProducts = Array.from(new Set(group.items.map((item) => {
        const displayName = normalizeText(item.product_name)
        if (displayName) return displayName
        const lotCode = normalizeText(item.lot_code)
        if (lotCode) return `Lot ${lotCode}`
        const productId = Number(item.product_id || 0)
        if (Number.isFinite(productId) && productId > 0) return `product #${productId}`
        return 'Inventory movement'
      }).filter(Boolean)))
      const uniqueBranches = Array.from(new Set(group.items.map((item) => normalizeText(item.branch_name)).filter(Boolean)))
      const uniqueUsers = Array.from(new Set(group.items.map((item) => normalizeText(item.user_name)).filter(Boolean)))
      const allReasons = Array.from(new Set(group.items.map((item) => normalizeText(item.reason)).filter(Boolean)))
      const displayQuantity = group.movement_type === 'transfer' && group.totalQuantityIn > 0 && group.totalQuantityOut > 0
        ? Math.max(group.totalQuantityIn, group.totalQuantityOut)
        : group.totalQuantity
      const displayCostUsd = group.movement_type === 'transfer' && group.totalCostUsdIn > 0 && group.totalCostUsdOut > 0
        ? Math.max(group.totalCostUsdIn, group.totalCostUsdOut)
        : group.totalCostUsd
      const displayCostKhr = group.movement_type === 'transfer' && group.totalCostKhrIn > 0 && group.totalCostKhrOut > 0
        ? Math.max(group.totalCostKhrIn, group.totalCostKhrOut)
        : group.totalCostKhr

      return {
        ...group,
        totalQuantity: displayQuantity,
        totalCostUsd: displayCostUsd,
        totalCostKhr: displayCostKhr,
        recordCount: group.items.length,
        productCount: uniqueProducts.length,
        productNames: uniqueProducts,
        productSummary: uniqueProducts.length <= 2 ? uniqueProducts.join(', ') : `${uniqueProducts.slice(0, 2).join(', ')} +${uniqueProducts.length - 2}`,
        branchSummary: uniqueBranches.length <= 1 ? (uniqueBranches[0] || '') : `${uniqueBranches[0]} +${uniqueBranches.length - 1}`,
        userSummary: uniqueUsers.length <= 1 ? (uniqueUsers[0] || '') : `${uniqueUsers[0]} +${uniqueUsers.length - 1}`,
        reasonSummary: allReasons[0] || '',
      }
    })
    .sort((a, b) => {
      const left = parseMovementTime(a.latest_at)?.getTime() || 0
      const right = parseMovementTime(b.latest_at)?.getTime() || 0
      return right - left
    })
}

export function getMovementGroupPage(group: { items?: unknown[] } | null | undefined, { page = 1, pageSize = 10 }: MovementGroupPageOptions = {}) {
  const safePage = Math.max(1, Number(page || 1) || 1)
  const safePageSize = Math.max(1, Number(pageSize || 10) || 10)
  const items = Array.isArray(group?.items) ? group.items : []
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize))
  const currentPage = Math.min(safePage, totalPages)
  const offset = (currentPage - 1) * safePageSize
  return {
    items: items.slice(offset, offset + safePageSize),
    page: currentPage,
    pageSize: safePageSize,
    total: items.length,
    totalPages,
  }
}

export function movementGroupHaystack(group: Partial<MovementGroup> = {}): string {
  return [
    group.movement_type,
    group.movementLabel,
    group.productSummary,
    group.branchSummary,
    group.userSummary,
    group.reasonSummary,
    group.reference_id,
    group.latest_at,
    ...(group.productNames || []),
    ...(group.items || []).flatMap((item) => [item.lot_code, item.expiry_date, item.created_at]),
  ].map((value) => String(value || '').toLowerCase()).join(' ')
}
