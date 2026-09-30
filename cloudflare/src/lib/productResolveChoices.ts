// The Resolve grid's per-field choices for a products keep-mode merge (owner,
// 30 Sep 2026: "we should be able to select the segments we want, and the
// final column should show the final how it looks like"). Pure: no database,
// so the route, the undo applier's tests and the frontend parity fixture all
// run the same rules.
import { sellingPriceCeilCent } from './moneyPrecision'
import { compactSearchText, normalizeSearchText } from './searchMatch'

export const INVALID_RESOLVE_CHOICES_CODE = 'invalid_resolve_choices'
export const MERGE_FAILED_CODE = 'merge_failed'
export const RESOLVE_EDIT_PERMISSION_CODE = 'product_edit_permission_required'

export const PRODUCT_RESOLVE_CHOICE_FIELDS = [
  'name', 'barcode', 'brand', 'category', 'unit', 'selling_price_usd', 'wholesale_price_usd', 'image',
] as const
export type ProductResolveChoiceField = typeof PRODUCT_RESOLVE_CHOICE_FIELDS[number]

// A barcode or an image must be one a reviewed record really carries: typing
// one would mint an identity or a file reference nobody reviewed.
const CUSTOM_ALLOWED = new Set<ProductResolveChoiceField>(['name', 'brand', 'category', 'unit', 'selling_price_usd', 'wholesale_price_usd'])
const MONEY_FIELDS = new Set<ProductResolveChoiceField>(['selling_price_usd', 'wholesale_price_usd'])
export const RESOLVE_NAME_MAX = 200
export const RESOLVE_TEXT_MAX = 200

export type ProductResolveChoice = { source_id: number } | { custom: string | number }
export type ProductResolveChoices = Partial<Record<ProductResolveChoiceField, ProductResolveChoice>>

// The keeper columns a choice writes. Each group comes from ONE source (a
// brand never mixes one record's brand with another's list), and the derived
// search columns are recomputed exactly as every product write does.
export type ResolveChoiceValues = Partial<{
  name: string
  name_normalized: string
  barcode: string | null
  brand: string | null
  brands: string | null
  brand_compact: string
  category: string | null
  categories: string | null
  unit: string | null
  unit_normalized: string
  selling_price_usd: number
  selling_price_khr: number
  wholesale_price_usd: number
  wholesale_price_khr: number
  image_path: string | null
}>

export const RESOLVE_CHOICE_VALUE_COLUMNS = [
  'name', 'name_normalized', 'barcode', 'brand', 'brands', 'brand_compact', 'category', 'categories',
  'unit', 'unit_normalized', 'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'image_path',
] as const

export class ProductResolveChoiceError extends Error {
  readonly code = INVALID_RESOLVE_CHOICES_CODE
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ProductResolveChoiceError'
  }
}

export type ParsedProductResolveChoices =
  | { ok: true; choices: ProductResolveChoices }
  | { ok: false; code: typeof INVALID_RESOLVE_CHOICES_CODE; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function customText(field: ProductResolveChoiceField, value: unknown): string {
  if (typeof value !== 'string') throw new ProductResolveChoiceError(`The ${field} you typed must be text.`)
  const trimmed = value.trim()
  if (field === 'name' && (trimmed.length < 1 || trimmed.length > RESOLVE_NAME_MAX)) {
    throw new ProductResolveChoiceError(`The name must be 1 to ${RESOLVE_NAME_MAX} characters.`)
  }
  if (trimmed.length > RESOLVE_TEXT_MAX) throw new ProductResolveChoiceError(`The ${field} must be at most ${RESOLVE_TEXT_MAX} characters.`)
  // brands/categories are '||'-delimited lists (0033); a typed value is one entry.
  if ((field === 'brand' || field === 'category') && trimmed.includes('||')) {
    throw new ProductResolveChoiceError(`The ${field} cannot contain "||".`)
  }
  return trimmed
}

// Same policy as a product edit (productWrites nextMoney): USD selling and
// wholesale prices are stored rounded UP to the cent.
function customMoney(field: ProductResolveChoiceField, value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) {
    throw new ProductResolveChoiceError(`The ${field} must be a number of zero or more.`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new ProductResolveChoiceError(`The ${field} must be a number of zero or more.`)
  try {
    return sellingPriceCeilCent(typeof value === 'string' ? value.trim() : value)
  } catch {
    throw new ProductResolveChoiceError(`The ${field} is outside the supported range.`)
  }
}

/**
 * Reads `body.choices` of a keep-mode merge. Absent means no choices. The
 * result is in PRODUCT_RESOLVE_CHOICE_FIELDS order, so JSON of it is canonical
 * and can take part in the frozen-plan comparison.
 */
export function parseProductResolveChoices(body: unknown, groupIds: readonly number[]): ParsedProductResolveChoices {
  const raw = isRecord(body) ? body.choices : undefined
  if (raw === undefined || raw === null) return { ok: true, choices: {} }
  try {
    if (!isRecord(raw)) throw new ProductResolveChoiceError('Choices must be an object of fields.')
    const allowed = new Set<string>(PRODUCT_RESOLVE_CHOICE_FIELDS)
    const unknown = Object.keys(raw).filter((key) => !allowed.has(key))
    if (unknown.length) throw new ProductResolveChoiceError(`Unknown choice field: ${unknown.join(', ')}.`)
    const members = new Set(groupIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))
    const choices: ProductResolveChoices = {}
    for (const field of PRODUCT_RESOLVE_CHOICE_FIELDS) {
      if (!(field in raw) || raw[field] === undefined) continue
      const choice = raw[field]
      if (!isRecord(choice)) throw new ProductResolveChoiceError(`The ${field} choice must name a record or a typed value.`)
      const keys = Object.keys(choice)
      if (keys.length !== 1 || !['source_id', 'custom'].includes(keys[0])) {
        throw new ProductResolveChoiceError(`The ${field} choice must have exactly one of source_id or custom.`)
      }
      if (keys[0] === 'source_id') {
        const sourceId = choice.source_id
        if (typeof sourceId !== 'number' || !Number.isSafeInteger(sourceId) || !members.has(sourceId)) {
          throw new ProductResolveChoiceError(`The ${field} choice must come from a product in this group.`)
        }
        choices[field] = { source_id: sourceId }
        continue
      }
      if (!CUSTOM_ALLOWED.has(field)) throw new ProductResolveChoiceError(`The ${field} must come from one of the products.`)
      choices[field] = { custom: MONEY_FIELDS.has(field) ? customMoney(field, choice.custom) : customText(field, choice.custom) }
    }
    return { ok: true, choices }
  } catch (error) {
    if (error instanceof ProductResolveChoiceError) return { ok: false, code: INVALID_RESOLVE_CHOICES_CODE, error: error.message }
    throw error
  }
}

/**
 * True when the raw request types any Final value. That is a product edit, so
 * the route asks for the same tier as PUT /products/:id before it reads
 * anything; a merge-only user may only pick among the reviewed records' values.
 * Reads the raw body so an unauthorised caller learns nothing from validation.
 */
export function resolveChoicesTypeValues(body: unknown): boolean {
  const raw = isRecord(body) ? body.choices : undefined
  return isRecord(raw) && Object.values(raw).some((choice) => isRecord(choice) && Object.prototype.hasOwnProperty.call(choice, 'custom'))
}

const textOrNull = (value: unknown): string | null => {
  if (value == null) return null
  const text = String(value)
  return text.trim() ? text : null
}

function storedMoney(value: unknown, field: string, sourceId: number): number {
  if (value == null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ProductResolveChoiceError(`Product #${sourceId} has an invalid ${field}.`)
  }
  return parsed
}

/**
 * The Final column: every chosen value taken from the FROZEN reviewed rows
 * (the resolve plan's `rows`), never from live rows, so every step of a group
 * writes the same thing the reviewer saw. Throws ProductResolveChoiceError.
 */
export function resolveChoiceValues(
  choices: ProductResolveChoices,
  reviewedRows: ReadonlyArray<Record<string, unknown>>,
): ResolveChoiceValues {
  const fields = PRODUCT_RESOLVE_CHOICE_FIELDS.filter((field) => choices[field] !== undefined)
  if (!fields.length) return {}
  const byId = new Map(reviewedRows.map((row) => [Number(row.id), row]))
  const source = (field: ProductResolveChoiceField, id: number) => {
    const row = byId.get(id)
    if (!row) throw new ProductResolveChoiceError(`The ${field} choice names product #${id}, which was not reviewed.`)
    return row
  }
  const values: ResolveChoiceValues = {}
  for (const field of fields) {
    const choice = choices[field]!
    const custom = 'custom' in choice ? choice.custom : undefined
    const row = 'source_id' in choice ? source(field, choice.source_id) : null
    switch (field) {
      case 'name': {
        const name = row ? String(row.name ?? '').trim() : String(custom)
        if (!name) throw new ProductResolveChoiceError('The chosen name is empty.')
        values.name = row ? String(row.name) : name
        values.name_normalized = normalizeSearchText(values.name)
        break
      }
      case 'barcode':
        values.barcode = row!.barcode == null ? null : String(row!.barcode)
        break
      case 'brand': {
        const brand = row ? textOrNull(row.brand) : textOrNull(custom)
        values.brand = brand
        values.brands = row ? textOrNull(row.brands) : brand
        values.brand_compact = compactSearchText(brand)
        break
      }
      case 'category': {
        const category = row ? textOrNull(row.category) : textOrNull(custom)
        values.category = category
        values.categories = row ? textOrNull(row.categories) : category
        break
      }
      case 'unit': {
        const unit = row ? textOrNull(row.unit) : textOrNull(custom)
        values.unit = unit
        values.unit_normalized = normalizeSearchText(unit)
        break
      }
      case 'selling_price_usd':
        // A typed USD price has no KHR twin; 0 is the catalogue's "convert at
        // the current rate" (promotionRules: selling_price_khr || usd * rate).
        values.selling_price_usd = row ? storedMoney(row.selling_price_usd, 'selling price', Number(row.id)) : Number(custom)
        values.selling_price_khr = row ? storedMoney(row.selling_price_khr, 'selling price (KHR)', Number(row.id)) : 0
        break
      case 'wholesale_price_usd':
        values.wholesale_price_usd = row ? storedMoney(row.wholesale_price_usd, 'wholesale price', Number(row.id)) : Number(custom)
        values.wholesale_price_khr = row ? storedMoney(row.wholesale_price_khr, 'wholesale price (KHR)', Number(row.id)) : 0
        break
      case 'image':
        values.image_path = textOrNull(row!.image_path)
        break
    }
  }
  return values
}

/** The one UPDATE that makes the survivor match the Final column. */
export function keeperChoiceStatements(keeperId: number, values: ResolveChoiceValues): Array<{ sql: string; params: Record<string, unknown> }> {
  const columns = RESOLVE_CHOICE_VALUE_COLUMNS.filter((column) => Object.prototype.hasOwnProperty.call(values, column))
  if (!columns.length) return []
  if (!Number.isSafeInteger(keeperId) || keeperId <= 0) throw new ProductResolveChoiceError('A keeper id is required.')
  const params: Record<string, unknown> = { resolveKeeperId: keeperId }
  for (const column of columns) params[`choice_${column}`] = values[column] ?? null
  return [{
    sql: `UPDATE products SET ${columns.map((column) => `${column} = @choice_${column}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = @resolveKeeperId`,
    params,
  }]
}

// What undo needs to put the survivor back when a choice rewrote its name or
// catalog. Pricing, barcode and image before-images are captured by the fold.
export const KEEPER_CHOICE_BEFORE_SQL = `SELECT name, name_normalized, category, categories, brand, brands, brand_compact, unit, unit_normalized
  FROM products WHERE id = @id`

export type KeeperChoiceBefore = {
  keeperNameBefore?: string | null
  keeperNameNormalizedBefore?: string | null
  keeperCatalogBefore?: {
    category: string | null
    categories: string | null
    brand: string | null
    brands: string | null
    unit: string | null
    unit_normalized: string | null
    brand_compact: string | null
  }
}

export function keeperChoiceBefore(row: Record<string, unknown> | null | undefined, values: ResolveChoiceValues): KeeperChoiceBefore {
  if (!row) return {}
  const text = (value: unknown) => (value == null ? null : String(value))
  const before: KeeperChoiceBefore = {}
  if ('name' in values) {
    before.keeperNameBefore = text(row.name)
    before.keeperNameNormalizedBefore = text(row.name_normalized)
  }
  if ('brand' in values || 'category' in values || 'unit' in values) {
    before.keeperCatalogBefore = {
      category: text(row.category), categories: text(row.categories), brand: text(row.brand), brands: text(row.brands),
      unit: text(row.unit), unit_normalized: text(row.unit_normalized), brand_compact: text(row.brand_compact),
    }
  }
  return before
}

// B3: a fold whose atomic batch threw wrote nothing, so the answer is a
// definite refusal the client can show, not an unknown outcome.
export type MergeFailedBody = { success: false; code: typeof MERGE_FAILED_CODE; outcome: 'not_applied'; errorId: string; error: string }
export function mergeFailedBody(errorId: string): MergeFailedBody {
  return {
    success: false,
    code: MERGE_FAILED_CODE,
    outcome: 'not_applied',
    errorId,
    error: `The server could not merge these products. Nothing was changed. Reference: ${errorId}`,
  }
}
// The fold's history row carries its operation id; if it exists the batch
// committed and "not applied" would be false. The row was written a moment ago,
// so only the newest rows are read (no full scan on an error path), and CASE
// keeps json_extract off any row whose payload is not JSON (it would throw).
export const MERGE_APPLIED_PROBE_SQL = `SELECT 1 AS applied FROM (SELECT undo_payload FROM action_history ORDER BY id DESC LIMIT 500)
  WHERE CASE WHEN json_valid(undo_payload) THEN json_extract(undo_payload, '$.operation_id') END = @operationId LIMIT 1`
