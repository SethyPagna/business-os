// Import job analyze/apply engine.
//
// WHAT THIS PORTS FAITHFULLY from backend/src/services/importJobs.ts:
// - CSV parsing (lib/importCsv.ts) and numeric/currency normalization
//   (lib/importNumbers.ts) -- both exact behavioral ports.
// - The overall job lifecycle: created -> analyzing -> awaiting_review ->
//   approved -> applying -> completed/failed, with cancel_requested and
//   retry support -- same phases, same columns on import_jobs.
// - Per-row error capture into import_job_errors, and the errors.csv export.
//
// WHAT THIS SIMPLIFIES (flagged in the section list, not hidden here):
// The original's per-row decision system supports barcode/SKU conflict
// resolution modes (allow_duplicate/clear_imported/fail) and name-grouped
// bulk decisions (__groups) -- roughly 700 lines of
// applyImportDecisionToRow()/getImportDecisionMap() logic. Replicating that
// exactly without misreading the original's edge cases risked silently
// wrong writes to a live products/inventory table, which is worse than a
// clearly-scoped gap. What IS implemented here: a per-row decision of
// { action: 'apply' | 'skip', field_overrides?: Record<string, unknown> }
// keyed by row number, which covers the common case (review flagged rows,
// operator decides to include/exclude/edit-then-include each one).
//
// UPDATE (this session, correcting the paragraph above -- it had gone
// stale and was actively misleading, having sent a full trace down a path
// that turned out to already be built): products import DOES have a real
import { normalizeProductGroupName, productDetailSignature, productIdentitySignature, resolveMergedPricing } from './productDetailRule'
import { sanitizeImportedDescription } from './productDescriptionSections'
// per-row mode system now, just via a different channel than
// decisionsByRowNumber/policy_json -- BulkImportModal.tsx's review step
// bakes the reviewer's per-row choice (IMPORT_DECISION_OPTIONS) directly
// into an `_action` CSV column on the materialized re-upload
// (buildCsvForImportJob), which classifyProducts below reads straight off
// each row (see requestedRowMode) into ImportRowResult.plannedMode, and
// runImportApply branches accordingly:
//   - 'merge_stock' -- touches only quantity/batch, no field UPDATE
//   - 'override_add' -- updates fields AND adds a batch (branch_stock +=)
//   - 'override_replace' -- updates fields, no stock/batch movement
//   - 'skip_row' -- genuinely skips the row (fixed this session -- this
//     value used to fall through to the same legacy full-update path as
//     an unrecognized `_action`, silently ignoring the reviewer's Skip
//     choice; see the `requestedRowMode === 'skip_row'` check below)
//   - anything else (no `_action`, 'new', or an unrecognized value) --
//     legacy/default: full field UPDATE + branch_stock quantity REPLACE
// Still genuinely NOT implemented: 'create_variant'/'link_variant' (a row
// marked "Variant" in the review UI has no dedicated server-side branch
// and currently falls through to the same legacy default as an
// unrecognized `_action` -- a real remaining gap, distinct from the three
// modes above which are wired end to end and covered in
// scripts/test-import-engine-pure.cjs).
//
// Sales import is new best-effort design (the schema has no natural
// "one row = one order" shape without a grouping column), not a port of
// existing logic -- see buildSalesGroups() below.

import type { Env } from '../index'
import { getDb, type D1Compat } from './db'
import { buildInClause, chunkForBinding } from './sqlBinding'
import {
  parseCsvRows,
  parseDelimitedRowsWindow,
  stripBom,
  detectCsvDelimiter,
  normalizeCsvHeaders,
  hasParsedCsvRowContent,
  csvValuesToRow,
  findDuplicateHeaderKeys,
  findBlankHeaderIndexes,
  type ParsedCsvRow,
} from './importCsv'
import { parseImportNumericValue, normalizeImportMoney } from './importNumbers'
import { buildImportedContactState } from './contactOptions'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { VALID_SALE_STATUSES, RETURN_STATUSES, normalizeSaleStatus } from './salesStatus'
import { dateToBatchCode } from './batchCode'
import { normalizeSearchText, compactSearchText } from './searchMatch'
import { classifyUnifiedStockActions, type StockActionImportResult } from './stockActionCatalog'
import { countUnifiedStockConfirmationRows, sealUnifiedStockAnalyzeConflicts } from './stockActionSeal'
import { applyUnifiedStockAdd, applyUnifiedStockSale, ensureUnifiedStockProduct, type UnifiedStockSaleLine } from './stockActionCommit'
import { parseStockAction, saleGroupKeyFor } from './stockActionResolver'
import { applyHistoricalSaleImport, MAX_HISTORICAL_SALE_LINES } from './salesImportCommit'
import type { UnifiedStockResolvedRow } from './stockActionImport'
import {
  normalizeImageMatchKey,
  MAX_IMAGES_PER_PRODUCT,
  matchImagesToProducts,
  buildAutoRenamePlan,
  type UploadedImageRef,
  type MatchCandidateProduct,
  type ImageMatchSummary,
} from './importImageMatch'
// NOTE: 'linked_existing' (see routes/importJobs.ts's /:id/images/assign-existing)
// marks an image the operator already attached directly to a live
// catalog product, outside this job's own CSV rows -- once that
// happens it must stop appearing as a match candidate/unmatched entry
// on every subsequent analyze, hence the status exclusion below.

export type ImportType = 'products' | 'customers' | 'suppliers' | 'delivery_contacts' | 'inventory' | 'sales' | 'stock_actions'

export type RowAction = 'create' | 'update' | 'skip' | 'error'

// Stable machine-readable tag for a row warning, distinct from `message`
// (the human-readable sentence). Grouping/reporting code (see
// summarizeImportWarnings below and GET /:id/warnings-summary in
// importJobs.ts) keys off `kind`, never off parsing `message` text -- the
// message can be reworded freely without breaking the report.
// 'other' is a deliberate escape hatch for any future rowWarnings.push()
// callsite that doesn't bother threading a specific kind through; the
// report still counts and lists it, just under a generic bucket instead of
// silently dropping it from the summary.
export type ImportWarningKind = 'negative_stock' | 'barcode_collision' | 'sku_collision' | 'name_match' | 'membership_mismatch' | 'membership_phone_conflict' | 'duplicate_row_match' | 'stock_action_conflict' | 'other'

export type ImportRowWarning = { kind: ImportWarningKind; message: string }

export type ImportRowResult = {
  rowNumber: number
  action: RowAction
  identifier: string | null
  existingId: number | null
  message: string | null
  // Structured form of `message` -- same content, kept as an array so a
  // row with more than one warning (e.g. negative stock AND a barcode
  // collision) doesn't lose the boundary between them the way joining into
  // one `message` string does. Optional/omittable so existing persisted
  // rows (written before this field existed) still parse fine as
  // `undefined` -- every reader treats that the same as an empty array.
  warnings?: ImportRowWarning[]
  changes: Record<string, { from: unknown; to: unknown }>
  data: Record<string, unknown>
  // Products-only refinement of an 'update' row, read off the CSV's own
  // `_action` column (see BulkImportModal.tsx's ROW_ACTIONS -- the
  // reviewer picks one of these per matched row before submitting).
  // Undefined covers every other import type, every 'create'/'skip'/
  // 'error' row, and any legacy/pre-this-feature row whose `_action` was
  // never set or wasn't one of these three -- runImportApply's write path
  // treats undefined as the original always-on behavior (full field
  // update + branch_stock quantity REPLACE), so old imports and every
  // other row shape keep writing exactly as before.
  plannedMode?: 'merge_stock' | 'override_add' | 'override_replace'
}

// Human-readable label for each warning kind, used as the group heading in
// the row-number notation report (see summarizeImportWarnings) -- e.g.
// "Same barcode, different name: rows 5, 12, 89". Kept centralized here so
// the wording only needs to change in one place.
export const IMPORT_WARNING_LABELS: Record<ImportWarningKind, string> = {
  negative_stock: 'Negative stock (clamped to 0)',
  barcode_collision: 'Same barcode, different name',
  sku_collision: 'Same SKU, different name',
  name_match: 'Matched an existing contact by name',
  membership_mismatch: 'Membership number belongs to a different name on file',
  membership_phone_conflict: 'Membership number and phone number belong to different customers on file',
  duplicate_row_match: 'Two rows in this file matched the same existing contact',
  stock_action_conflict: 'Stock action needs explicit confirmation',
  other: 'Other warning',
}

// Whether a warning kind represents something serious enough to call out
// specifically (as opposed to a routine "just so you know") -- used to
// decide what surfaces in the import report / dashboard / audit log
// without the caller needing its own copy of this list.
export const SERIOUS_IMPORT_WARNING_KINDS: ReadonlySet<ImportWarningKind> = new Set(['negative_stock', 'barcode_collision', 'sku_collision', 'name_match', 'membership_mismatch', 'membership_phone_conflict', 'duplicate_row_match', 'stock_action_conflict'])

// Counts DISTINCT rows that carry at least one warning whose kind is in
// `kinds` -- NOT the sum of summarizeImportWarnings' per-kind group counts.
// A single row can carry more than one warning kind at once (e.g. a
// products row that's both a negative-stock clamp AND a barcode collision),
// so summing group.count across kinds double-counts that row once per kind
// it triggered. That double-count is exactly what produced the reported
// "705 warnings" (this function's number -- rows) vs. a much larger
// "1000+ other warnings" (the old sum-of-groups number) on the same job:
// the two headline numbers were answering different questions (rows
// affected vs. warning instances raised) while both being labeled as if
// they meant "how many warnings". Use this for any headline/total figure;
// summarizeImportWarnings' per-group counts are still correct and
// unchanged for their own purpose (how many rows fall under this specific
// kind), just not safe to sum across kinds for a combined total.
export function countRowsWithWarningKinds(
  rows: Array<{ rowNumber: number; warnings?: ImportRowWarning[]; message?: string | null }>,
  kinds: ReadonlySet<ImportWarningKind>,
): number {
  let count = 0
  for (const row of rows) {
    const warnings = row.warnings && row.warnings.length ? row.warnings : (row.message ? [{ kind: 'other' as ImportWarningKind, message: row.message }] : [])
    if (warnings.some((w) => kinds.has(w.kind))) count += 1
  }
  return count
}

// Collapses a flat per-row warning list into the "notation" form requested
// for the import report: one entry per warning KIND, each carrying every
// row number it applies to, instead of repeating the same sentence once
// per row. E.g. 1,294 individual "Barcode X is already used by..." row
// messages become a single { kind: 'barcode_collision', rows: [5, 12, 89, ...] }
// entry. Rows are sorted ascending and de-duplicated (a row that pushed the
// same kind twice, which shouldn't normally happen, only appears once).
// Groups are returned in a fixed, stable order (IMPORT_WARNING_LABELS'
// declaration order) rather than first-seen order, so the report reads the
// same way import after import.
export function summarizeImportWarnings(rows: Array<{ rowNumber: number; warnings?: ImportRowWarning[]; message?: string | null }>): Array<{ kind: ImportWarningKind; label: string; count: number; rows: number[] }> {
  const rowsByKind = new Map<ImportWarningKind, Set<number>>()
  for (const row of rows) {
    const warnings = row.warnings && row.warnings.length ? row.warnings : (row.message ? [{ kind: 'other' as ImportWarningKind, message: row.message }] : [])
    for (const warning of warnings) {
      const set = rowsByKind.get(warning.kind) || new Set<number>()
      set.add(row.rowNumber)
      rowsByKind.set(warning.kind, set)
    }
  }
  const orderedKinds = Object.keys(IMPORT_WARNING_LABELS) as ImportWarningKind[]
  const out: Array<{ kind: ImportWarningKind; label: string; count: number; rows: number[] }> = []
  for (const kind of orderedKinds) {
    const set = rowsByKind.get(kind)
    if (!set || !set.size) continue
    const rowNumbers = [...set].sort((a, b) => a - b)
    out.push({ kind, label: IMPORT_WARNING_LABELS[kind], count: rowNumbers.length, rows: rowNumbers })
  }
  return out
}

// 'force_create' (contacts only, classifyContacts): overrides a NAME-based
// fold (either against an existing DB record or against an earlier row in
// the same file) back into its own separate contact -- see classifyContacts
// for why this only applies to a name match, never a phone/membership_number
// match (those identify a specific real account; a name match is only ever
// this app's best guess, and the reviewer may know two different people
// really do share a name).
export type RowDecision = { action?: 'apply' | 'skip' | 'force_create'; field_overrides?: Record<string, unknown> }

const MAX_SYNC_ROWS = 20000 // hard ceiling on total rows any one job will process, chunked or not

// How many rows (or, for sales, order_reference GROUPS) runImportAnalyze /
// runImportApply classify + write per queue invocation. See migration
// 0011_import_job_chunking.sql's header for the full "why" -- short
// version: the Workers Free plan caps actual CPU compute at 10ms per
// invocation, and classifying a row (Map lookups, diffFields, image
// resolution) plus, for apply, building its INSERT/UPDATE statements is
// real synchronous JS work that adds up linearly with row count. Small
// chunks + a fresh 10ms budget per invocation beats one giant pass that
// eventually exceeds it, at the cost of an import taking many queued
// invocations (seconds, not milliseconds) to finish end to end -- a
// trade worth making since nothing here is on a user-facing request path.
// Tune down further if wrangler tail still shows "Exceeded CPU Limit" on
// analyze/apply for a particular job; tune up if this account moves to
// Workers Paid and restores wrangler.toml's higher [limits] cpu_ms.
const ROWS_PER_IMPORT_CHUNK = 150

// POST /:id/preflight (importJobs.ts) is a synchronous HTTP request, not a
// queue invocation -- it can't self-continue across chunks the way
// runImportAnalyze/runImportApply do (a person's browser is waiting on the
// response), so it only ever classifies a bounded sample for a quick
// sanity check. The real, authoritative, complete pass is the (chunked)
// analyze phase that runs after POST /:id/start.
export const PREFLIGHT_MAX_ROWS = 500

// Phase timing, stored on the job row (summary_json.timings) so a slow
// import can actually be diagnosed after the fact -- which pipeline phase
// (CSV fetch from R2, parse, per-row classify DB queries, D1 batch write,
// queue pickup latency) is where the time went -- instead of guessing.
// Deliberately just Date.now() deltas, not a tracing lib: this runs inside
// a Worker invocation with a CPU-time budget, so the goal is "cheap enough
// to always leave on", not maximum precision.
export function makeStopwatch() {
  const marks: Record<string, number> = {}
  let last = Date.now()
  return {
    lap(label: string) {
      const t = Date.now()
      marks[label] = t - last
      last = t
    },
    marks,
  }
}

// Reserved marker (not a valid branch name a CSV could realistically
// contain) used in ImportRowResult.data.branch_name_pending to mean "no
// branch was named for this row AND no default branch exists yet" --
// distinct from a real pending name, which means "this specific name
// needs to be created". See resolveAndCreateBranches in runImportApply.
const DEFAULT_BRANCH_SENTINEL = '\u0000__default_branch__'


function str(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function lower(value: unknown): string {
  return str(value).toLowerCase()
}

function toBool01(value: unknown, fallback = 1): number {
  const text = lower(value)
  if (text === '') return fallback
  if (['0', 'false', 'no', 'inactive', 'n'].includes(text)) return 0
  if (['1', 'true', 'yes', 'active', 'y'].includes(text)) return 1
  return fallback
}

// Part 329: backend half of the Customer Portal description-column
// wiring request (Part 326/328 built the parser + portal UI; the
// import-side column mapping was explicitly left undone in Part 328's
// notes). An operator's spreadsheet can name these columns directly
// (`Introduction`, `Official Product Name`, `Features & Benefits`,
// `Who is it for?`, `Ingredients`) instead of hand-typing the labeled
// text into a single `description` cell -- this assembles the same
// labeled text `frontend/src/components/catalog/productDetailSections.ts`
// already knows how to parse back out, so the two sides of this feature
// (import-in, portal-display-out) agree on one label format rather than
// each inventing its own. `Product`/`Category`/`Brand` need no mapping
// here -- those are handled by the existing name/category/brand columns
// below (row.product is added as a `name` alias; category/brand already
// match a plain "Category"/"Brand" header via normalizeCsvKey).
//
// normalizeCsvKey (importCsv.ts) only lowercases + turns whitespace into
// underscores -- it does NOT strip punctuation -- so "Features & Benefits"
// becomes the row key `features_&_benefits` and "Who is it for?" becomes
// `who_is_it_for?`. A couple of punctuation-free fallbacks are also
// accepted (`features_and_benefits`, `who_is_it_for`) in case an
// operator's export tool strips punctuation from headers itself.
//
// Deliberately does NOT touch row.description: if the CSV also carries a
// plain `description` column with real content, that explicit column
// wins outright (handled by the caller, str(row.description) checked
// first) -- this function only ever supplies a description when the CSV
// has none, so an operator who already writes full descriptions by hand
// keeps doing exactly that with no behavior change.
const DESCRIPTION_COLUMN_KEYS = {
  introduction: ['introduction'],
  officialName: ['official_product_name'],
  featuresBenefits: ['features_&_benefits', 'features_and_benefits', 'features_benefits'],
  whoFor: ['who_is_it_for?', 'who_is_it_for'],
  ingredients: ['ingredients'],
} as const

function firstNonBlankColumn(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = str(row[key])
    if (value) return value
  }
  return ''
}

export function buildDescriptionFromColumns(row: Record<string, unknown>): string {
  const introduction = firstNonBlankColumn(row, DESCRIPTION_COLUMN_KEYS.introduction)
  const officialName = firstNonBlankColumn(row, DESCRIPTION_COLUMN_KEYS.officialName)
  const featuresBenefits = firstNonBlankColumn(row, DESCRIPTION_COLUMN_KEYS.featuresBenefits)
  const whoFor = firstNonBlankColumn(row, DESCRIPTION_COLUMN_KEYS.whoFor)
  const ingredients = firstNonBlankColumn(row, DESCRIPTION_COLUMN_KEYS.ingredients)

  // Leading, unlabeled text is read back as the intro paragraph by
  // parseProductDescription -- no "Introduction:" label needed as long
  // as it comes first, which also keeps a description built from just
  // an Introduction column (no other section columns) as plain
  // unlabeled text, identical to a hand-typed one-paragraph description.
  const parts: string[] = []
  if (introduction) parts.push(introduction)
  if (officialName) parts.push(`Official Product Name: ${officialName}`)
  if (featuresBenefits) parts.push(`Features & Benefits:\n${featuresBenefits}`)
  if (whoFor) parts.push(`Who is it for?:\n${whoFor}`)
  if (ingredients) parts.push(`Ingredients:\n${ingredients}`)
  return parts.join('\n\n')
}

// YYYY-MM-DD for today, matching the frontend's own
// CreatedDateFilterOptions.tsx todayIso() and the date-only shape every
// other date column here (expiry_date, discount_starts_at/ends_at) already
// stores. Used as the default for a new product's received_date when the
// CSV leaves that column blank (see normalizeProductImportRow below).
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Customer gender -- free-text CSV cell normalized to the same three
// values CustomerFormModal.tsx's dropdown writes ('male'/'female'/
// 'other'), so an imported value renders as a real selected option
// instead of an unrecognized free-text string the picker can't match.
// Blank/unrecognized -> null (unspecified), never a guess.
function normalizeContactGender(value: unknown): string | null {
  const text = lower(value)
  if (['m', 'male', 'man', 'boy'].includes(text)) return 'male'
  if (['f', 'female', 'woman', 'girl'].includes(text)) return 'female'
  if (['o', 'other', 'nonbinary', 'non-binary', 'nb'].includes(text)) return 'other'
  return null
}

// Mirrors frontend/src/utils/productGrouping.ts's normalizeProductGroupName
// exactly (trim + collapse internal whitespace + lowercase) so an import's
// "same name" decision lines up with what the Products/POS display grouping
// (buildProductGroups) will later treat as the same name.
// normalizeImageMatchKey (strip a leading path, drop the extension,
// lowercase, collapse whitespace -- so "Coca-Cola.jpg", an uploaded
// file's original name, and "coca cola", a CSV image_filename_1 value
// or a product's own name, resolve to the same key) now comes from
// importImageMatch.ts (imported above). This file used to carry its own
// second, separately-maintained copy of the exact same 4-line function
// -- imported from importImageMatch.ts under an alias specifically to
// dodge that name collision, then never actually called -- consolidated
// here so the two modules can't silently drift on what counts as "the
// same name".

const IMAGE_FILENAME_FIELDS = [
  'image_filename', 'image_filename_1', 'image_filename_2', 'image_filename_3', 'image_filename_4', 'image_filename_5',
  'image_1', 'image_2', 'image_3', 'image_4', 'image_5',
  'image_url_1', 'image_url_2', 'image_url_3', 'image_url_4', 'image_url_5',
]

// A job's uploaded images, keyed by normalized basename -> public path.
// Populated from import_job_files (kind='image'), which every image the
// operator attached to this job (via /:id/images) already has a row in --
// see routes/importJobs.ts's storeUpload. Exact-key only (fast, no
// ambiguity) -- resolveRowImagePath's first pass. matchImagesToProducts
// below covers the fuzzy/best-fit case this map alone can't.
async function loadImportJobImageMap(db: D1Compat, jobId: string): Promise<Map<string, string>> {
  const rows = await db.prepare(`
    SELECT original_name, relative_path, stored_path FROM import_job_files
    WHERE job_id = @jobId AND kind = 'image' AND status NOT IN ('rejected', 'linked_existing')
  `).all<{ original_name: string | null; relative_path: string | null; stored_path: string }>({ jobId })
  const map = new Map<string, string>()
  for (const row of rows) {
    const publicPath = `/${String(row.stored_path || '').replace(/^\/+/, '')}`
    const nameKey = normalizeImageMatchKey(row.original_name)
    const relKey = normalizeImageMatchKey(row.relative_path)
    if (nameKey && !map.has(nameKey)) map.set(nameKey, publicPath)
    if (relKey && !map.has(relKey)) map.set(relKey, publicPath)
  }
  return map
}

// Every image this job has uploaded (kind='image', not rejected), in the
// shape matchImagesToProducts needs. Reused by both the exact-key map
// above and the fuzzy/best-fit pass (computeImportImageMatch) so a single
// analyze/apply run doesn't hit import_job_files twice for the same data.
async function loadImportJobImages(db: D1Compat, jobId: string): Promise<UploadedImageRef[]> {
  const rows = await db.prepare(`
    SELECT id, original_name, relative_path, stored_path FROM import_job_files
    WHERE job_id = @jobId AND kind = 'image' AND status NOT IN ('rejected', 'linked_existing')
  `).all<{ id: number; original_name: string | null; relative_path: string | null; stored_path: string }>({ jobId })
  return rows.map((row) => ({
    id: row.id,
    originalName: row.original_name || '',
    relativePath: row.relative_path,
    publicPath: `/${String(row.stored_path || '').replace(/^\/+/, '')}`,
  }))
}

// Operator overrides recorded against a job's policy_json (see
// routes/importJobs.ts's POST /:id/images/:fileId/assign and
// POST /:id/images/resolve-limit):
//   imageOverrides: { [fileId]: rowNumber }        -- manual "this image
//     belongs to this row" assignment for an image that matched nothing
//     (or matched the wrong thing) automatically.
//   imageLimitDecisions: { [rowNumber]: fileId[] } -- which images win
//     when more than MAX_IMAGES_PER_PRODUCT matched the same row's
//     product name; overrides the engine's score-based auto-pick.
type ImagePolicyOverrides = {
  imageOverrides: Record<string, number>
  imageLimitDecisions: Record<string, Array<number | string>>
}

// A sales import earns loyalty points only when the operator explicitly
// opted in on the review screen (policy.accrue_loyalty === true). Anything
// else -- absent, false, malformed JSON -- keeps the safe historical default
// of no accrual, so a migrated ledger can never inflate point balances.
export function getSalesImportAccrueLoyalty(policyJson: string | null | undefined): boolean {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    return policy?.accrue_loyalty === true
  } catch (_) {
    return false
  }
}

function getImagePolicyOverrides(policyJson: string | null | undefined): ImagePolicyOverrides {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    return {
      imageOverrides: policy?.imageOverrides && typeof policy.imageOverrides === 'object' ? policy.imageOverrides : {},
      imageLimitDecisions: policy?.imageLimitDecisions && typeof policy.imageLimitDecisions === 'object' ? policy.imageLimitDecisions : {},
    }
  } catch (_) {
    return { imageOverrides: {}, imageLimitDecisions: {} }
  }
}

// Resolves the image (if any) a single CSV row should get. Two paths, in
// priority order:
// 1. An explicit image_filename_1 (etc.) column -- if it's already a
//    URL/data-URI/uploads path, use it as-is (a hosted image reference);
//    otherwise treat it as a bare filename and look it up in this job's
//    uploaded-images map.
// 2. No explicit column at all: fall back to matching the uploaded images
//    directly against the row's own product name -- this is what makes a
//    plain "drop a folder of images, no CSV image column" import work,
//    since image-only imports build their CSV rows with `name` set from
//    the image's filename (see BulkImportModal's buildImageOnlyCsv).
// Runs the full best-fit engine (exact key -> fuzzy -> per-product limit)
// against this job's uploaded images and the CSV's own rows (each row's
// `name` is the matching product, whether the row will create or update),
// then folds in any operator overrides recorded in policy_json. This is
// what powers: (a) images with no explicit image_filename_* column still
// getting attached via best-fit rather than exact-match-only, (b) the
// "Unmatched images" and "Too many images for one product" panels in the
// review UI, and (c) the auto-rename plan applied when the job commits.
export async function computeImportImageMatch(
  db: D1Compat,
  jobId: string,
  rows: ParsedCsvRow[],
  policyJson?: string | null,
): Promise<ImageMatchSummary & { rowImagePaths: Map<number, string>; rowGalleryPaths: Map<number, string[]>; renamePlan: Map<string | number, string> }> {
  const images = await loadImportJobImages(db, jobId)
  const candidates: MatchCandidateProduct[] = rows
    .map((row) => ({ id: row._rowNumber, name: str((row as Record<string, unknown>).name) }))
    .filter((c) => c.name)

  const summary = matchImagesToProducts(images, candidates)
  const overrides = getImagePolicyOverrides(policyJson)

  // Manual assignments: force-match an otherwise-unmatched (or wrongly
  // matched) image to a specific row, at score 1 (operator decision beats
  // any auto score). Pull it out of matched/unmatched first so it doesn't
  // appear twice.
  const manualIds = new Set(Object.keys(overrides.imageOverrides).map(Number))
  const filteredMatched = summary.matched.filter((m) => !manualIds.has(Number(m.image.id)))
  const filteredUnmatched = summary.unmatched.filter((img) => !manualIds.has(Number(img.id)))
  const imageById = new Map(images.map((img) => [Number(img.id), img]))
  const rowByNumber = new Map(rows.map((r) => [r._rowNumber, r]))
  for (const [fileId, rowNumber] of Object.entries(overrides.imageOverrides)) {
    const image = imageById.get(Number(fileId))
    const row = rowByNumber.get(Number(rowNumber))
    if (!image || !row) continue
    filteredMatched.push({
      image,
      productId: row._rowNumber,
      productName: str((row as Record<string, unknown>).name),
      score: 1,
      matchType: 'exact',
    })
  }

  // Limit-decision overrides: operator picked which images survive for a
  // row that had more than MAX_IMAGES_PER_PRODUCT auto-matched.
  const overLimit = summary.overLimit.map((entry) => {
    const decision = overrides.imageLimitDecisions[String(entry.productId)]
    if (!decision || !decision.length) return entry
    const keepIds = new Set(decision.map(Number))
    const winners = entry.all.filter((m) => keepIds.has(Number(m.image.id)))
    return { ...entry, winners: winners.length ? winners : entry.winners }
  })

  const overLimitProductIds = new Set(overLimit.map((e) => e.productId))
  const finalMatched = [
    ...filteredMatched.filter((m) => !overLimitProductIds.has(m.productId)),
    ...overLimit.flatMap((e) => e.winners),
  ]

  const rowImagePaths = new Map<number, string>()
  const rowGalleryPaths = new Map<number, string[]>()
  const byRow = new Map<string | number, ImageMatchSummary['matched']>()
  for (const match of finalMatched) {
    const list = byRow.get(match.productId) || []
    list.push(match)
    byRow.set(match.productId, list)
  }
  for (const [rowNumber, list] of byRow) {
    const ordered = [...list].sort((a, b) => b.score - a.score)
    if (ordered[0]) rowImagePaths.set(Number(rowNumber), ordered[0].image.publicPath)
    rowGalleryPaths.set(Number(rowNumber), ordered.map((m) => m.image.publicPath))
  }

  const renamePlan = buildAutoRenamePlan(finalMatched)

  return { matched: finalMatched, unmatched: filteredUnmatched, overLimit, rowImagePaths, rowGalleryPaths, renamePlan }
}

export function resolveRowImagePath(
  row: ParsedCsvRow,
  productName: string,
  imagesByKey: Map<string, string>,
  fuzzyFallback?: string | null,
): string | null {
  for (const field of IMAGE_FILENAME_FIELDS) {
    const raw = String((row as Record<string, unknown>)[field] ?? '').trim()
    if (!raw) continue
    if (/^data:image\//i.test(raw) || /^https?:\/\//i.test(raw) || raw.startsWith('/uploads/')) return raw
    if (raw.startsWith('uploads/')) return `/${raw}`
    const match = imagesByKey.get(normalizeImageMatchKey(raw))
    if (match) return match
  }
  const nameMatch = imagesByKey.get(normalizeImageMatchKey(productName))
  if (nameMatch) return nameMatch
  // Nothing matched exactly (no image_filename_* column resolved, and no
  // uploaded image's basename is byte-identical to the product name) --
  // fall back to the best-fit fuzzy match computeImportImageMatch already
  // worked out for this row, if any. This is the "system can automatically
  // rename/attach the images by checking what's available" path for lazy
  // CSVs and mismatched filenames.
  return fuzzyFallback || null
}

// normalizeProductGroupName now comes from lib/productDetailRule.ts (see the
// import at the top of this file) -- it is the same trim/collapse/lowercase
// rule, but owning one copy means the grouping key here can never drift from
// the one transfers, merge-duplicates and the Products page use.

async function fetchCsvText(env: Env, jobId: string): Promise<{ text: string; fileName: string } | null> {
  const db = getDb(env)
  const file = await db
    .prepare(`SELECT * FROM import_job_files WHERE job_id = @job_id AND kind = 'csv' ORDER BY id DESC LIMIT 1`)
    .get<{ stored_path: string; original_name: string }>({ job_id: jobId })
  if (!file) return null
  const object = await env.ASSETS.get(file.stored_path)
  if (!object) return null
  return { text: await object.text(), fileName: file.original_name || 'import.csv' }
}

// How many bytes one materialize window pulls from R2.
//
// Sized so a window comfortably contains far more than
// MATERIALIZE_ROWS_PER_CHUNK rows: the real file averages ~290 bytes/row, so
// 256 KB holds roughly 900 rows against a 100-row budget. Overshooting is
// nearly free (the unread remainder is simply not parsed and the next window
// re-reads from the exact byte where this one stopped), whereas undershooting
// costs an extra round trip, so the bias is deliberately generous.
const MATERIALIZE_WINDOW_BYTES = 256 * 1024

// Reads ONE byte range of the job's CSV instead of the whole object.
//
// This is the fix for the dominant CPU cost of importing a large file.
// fetchCsvText above pulls the entire object and calls `.text()` on it,
// which is a full UTF-8 decode of the whole file -- real synchronous CPU
// proportional to total size. ensureSourceRowsMaterialized called it once
// per WINDOW, so a 2.5 MB / 8,727-row file was fetched and decoded ~87
// times to parse itself once, on a Worker whose entire budget is 10ms per
// invocation.
//
// A range read decodes only the slice being parsed. A trailing partial
// multi-byte character at the end of the range decodes to U+FFFD, which is
// harmless here precisely BECAUSE of the sourceIsComplete guard: any such
// character sits inside the final, incomplete row, which the parser now
// refuses to emit and leaves to be re-read from its true byte offset.
async function fetchCsvRange(
  env: Env,
  jobId: string,
  offset: number,
  length: number,
): Promise<{ text: string; fileName: string; totalSize: number; bytesRead: number } | null> {
  const db = getDb(env)
  const file = await db
    .prepare(`SELECT * FROM import_job_files WHERE job_id = @job_id AND kind = 'csv' ORDER BY id DESC LIMIT 1`)
    .get<{ stored_path: string; original_name: string }>({ job_id: jobId })
  if (!file) return null
  const object = await env.ASSETS.get(file.stored_path, { range: { offset, length } })
  if (!object) return null
  const buffer = await object.arrayBuffer()
  // `size` on a ranged result is the FULL object size, which is what decides
  // whether this slice reaches EOF.
  const totalSize = Number((object as { size?: number }).size ?? 0)
  return {
    text: new TextDecoder('utf-8').decode(buffer),
    fileName: file.original_name || 'import.csv',
    totalSize,
    bytesRead: buffer.byteLength,
  }
}

const CSV_BYTE_ENCODER = new TextEncoder()

/** Byte length of a decoded prefix -- converts a char offset back to bytes. */
function byteLengthOf(text: string): number {
  return CSV_BYTE_ENCODER.encode(text).length
}

// ---------------------------------------------------------------------------
// Materialization: parses the job's CSV into import_job_source_rows ONCE per
// job, in small resumable windows, so analyze/apply never need to re-fetch
// or re-parse the raw file per chunk again -- see migration
// 0012_import_job_source_rows.sql's header for the full "why". Sits between
// fetchCsvText (raw R2 read) and runImportAnalyze/runImportApply (which now
// read exclusively from the materialized table via readMaterializedWindow/
// readAllMaterializedRows below).

type MaterializeState = {
  charOffset: number
  // Byte offset of charOffset within the stored CSV.
  //
  // charOffset alone is not enough to resume from a RANGED read: for UTF-8
  // (and this catalog is full of Khmer, which is 3 bytes per character) a
  // character offset and a byte offset are different numbers, and R2 ranges
  // are expressed in bytes. Tracked alongside rather than replacing
  // charOffset so an in-flight job written by the previous build still
  // resumes correctly -- see ensureSourceRowsMaterialized's fallback.
  byteOffset?: number
  inQuotes: boolean
  headers: string[] | null
  rawRowIndex: number // total raw CSV rows consumed so far (header + every data/blank row) -- gives each persisted row its true original CSV line number, matching parseCsvRows' `index + 1`
  rowsWritten: number // count of non-blank data rows persisted so far -- this run's `sequence` cursor into import_job_source_rows
  delimiter: string
  // Real gap closed here (Part 316, following up Part 315's frontend-only
  // fix): the backend's own csvValuesToRow silently drops any column whose
  // header is blank, same bug the frontend's parseCsvRows had. Detected
  // once, at header-parse time, from state.headers -- these are the
  // 1-based column indexes with a blank header, BEFORE we know whether any
  // of them actually carry data (that's confirmed incrementally below,
  // since the backend never has the whole file in memory at once).
  blankHeaderColumns?: number[]
  // Accumulates, across however many materialize windows this job takes,
  // which of blankHeaderColumns actually had a non-blank value in at least
  // one data row seen so far. Only columns that end up in here (once
  // materialize is done) are real warnings -- a blank header with no data
  // under it is a harmless ragged-edge spare column, not a bug.
  blankHeaderColumnsWithData?: number[]
  // Computed once at header-parse time, from the normalized header row --
  // see findDuplicateHeaderKeys' own comment for the two cases this
  // catches (exact-same-key collision, and Excel's `.1`/`.2` re-export
  // suffix artifact).
  duplicateHeaderKeys?: string[]
  // Sales templates use a compact multi-line invoice contract: only the
  // first item row repeats receipt/customer/order fields and following
  // rows leave them blank. Persist the last explicit receipt across the
  // 100-row materialization windows so a continuation row on the next
  // Worker invocation is still assigned to the same order in O(n) time.
  salesLastGroupKey?: string
}

// Kept separate from ROWS_PER_IMPORT_CHUNK: a materialize window only
// parses + does one INSERT OR REPLACE per row (no classify, no image-match,
// no branch resolution, no 1-3-statements-per-row apply logic), so per-row
// it's cheaper than analyze/apply's own chunk work. Still tuned to a
// smaller row count than ROWS_PER_IMPORT_CHUNK, not a larger one: measuring
// parseDelimitedRowsWindow against a real ~12,000-row/38-column export
// showed the worst single window roughly doubling from ~7ms to ~15ms going
// from 150 to 300 rows/window on ordinary dev hardware -- a cold Workers
// isolate (no JIT warmup yet) is not going to be faster than that, and
// 15ms already exceeds the Free plan's 10ms budget outright. 100 measured
// consistently under 7ms worst-case on the same file. Lower this further
// if wrangler tail shows a CPU-limit reset during the materializing phase
// on a very wide or heavily-quoted file; there's no correctness cost to
// going smaller, only more queue round-trips.
const MATERIALIZE_ROWS_PER_CHUNK = 100

async function getMaterializeState(db: D1Compat, jobId: string): Promise<{ state: MaterializeState; done: boolean; type: ImportType | null }> {
  const row = await db.prepare(`SELECT type, materialize_state_json, materialize_done FROM import_jobs WHERE id = @id`)
    .get<{ type: ImportType; materialize_state_json: string | null; materialize_done: number }>({ id: jobId })
  let state: MaterializeState = { charOffset: 0, byteOffset: 0, inQuotes: false, headers: null, rawRowIndex: 0, rowsWritten: 0, delimiter: ',' }
  try {
    if (row?.materialize_state_json) state = { ...state, ...JSON.parse(row.materialize_state_json) }
  } catch { /* keep default -- treat as not-yet-started */ }
  return { state, done: Boolean(row?.materialize_done), type: row?.type || null }
}

async function saveMaterializeState(db: D1Compat, jobId: string, state: MaterializeState, done: boolean): Promise<void> {
  await db.prepare(`UPDATE import_jobs SET materialize_state_json = @state, materialize_done = @done, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id: jobId, state: JSON.stringify(state), done: done ? 1 : 0 })
}

// Called by routes/importJobs.ts whenever a NEW CSV is uploaded to a job
// (fetchCsvText always reads the LATEST uploaded file) -- without this, a
// re-uploaded file would silently keep using the FIRST file's already-
// materialized rows. A no-op (cheap DELETE matching nothing) for a job that
// was never materialized yet, so it's safe to call unconditionally on every
// CSV upload rather than needing the caller to first check.
export async function resetMaterializeState(db: D1Compat, jobId: string): Promise<void> {
  await db.prepare(`DELETE FROM import_job_source_rows WHERE job_id = @id`).run({ id: jobId })
  await db.prepare(`UPDATE import_jobs SET materialize_state_json = NULL, materialize_done = 0 WHERE id = @id`).run({ id: jobId })
}

// One bounded window of parsing per call -- see parseDelimitedRowsWindow's
// header. Returns true if THIS invocation's budget went to materializing
// and the caller must return immediately (a continuation message of the
// same `kind` has already been queued, whether or not this window happened
// to be the last one -- always handing off to a fresh invocation rather
// than falling through into classify work in the same call keeps every
// invocation's CPU cost to one bounded thing). Returns false only when
// materialize_done was ALREADY true on entry (the common-case, cheap
// no-op check) -- the caller then proceeds to read import_job_source_rows.
async function ensureSourceRowsMaterialized(env: Env, db: D1Compat, jobId: string, kind: 'analyze' | 'apply'): Promise<boolean> {
  const { state, done, type } = await getMaterializeState(db, jobId)
  if (done) return false

  // A job that began materializing under the previous build has a
  // charOffset but no byteOffset. Deriving one would need the whole file
  // decoded, which is exactly the cost being removed, so instead such a job
  // restarts materialization from the top: import_job_source_rows is
  // rewritten by sequence anyway, and re-parsing is cheap next to getting a
  // resumed offset wrong. Only affects jobs mid-materialize across a deploy.
  if (state.byteOffset == null) {
    if (state.charOffset !== 0) {
      await db.prepare(`DELETE FROM import_job_source_rows WHERE job_id = @id`).run({ id: jobId })
    }
    state.byteOffset = 0
    state.charOffset = 0
    state.inQuotes = false
    state.headers = null
    state.rawRowIndex = 0
    state.rowsWritten = 0
    state.salesLastGroupKey = undefined
  }

  // A sales job caught mid-materialization across this deployment may
  // already have persisted rows without the new inherited key. Restart it
  // once instead of mixing old and new grouping rules in one review seal.
  if (type === 'sales' && state.rowsWritten > 0 && state.salesLastGroupKey === undefined) {
    await db.prepare(`DELETE FROM import_job_source_rows WHERE job_id = @id`).run({ id: jobId })
    state.byteOffset = 0
    state.charOffset = 0
    state.inQuotes = false
    state.headers = null
    state.rawRowIndex = 0
    state.rowsWritten = 0
    state.salesLastGroupKey = ''
  }
  if (type === 'sales' && state.rowsWritten === 0 && state.salesLastGroupKey === undefined) {
    state.salesLastGroupKey = ''
  }

  // Read ONE range rather than the whole object. `windowStart` is a byte
  // offset into the STORED file, which is why the BOM has to be handled by
  // byte count below rather than by stripping the decoded string on every
  // window -- stripping mid-file would shift every subsequent offset.
  let windowBytes = MATERIALIZE_WINDOW_BYTES
  let csv = await fetchCsvRange(env, jobId, state.byteOffset, windowBytes)
  if (!csv) throw new Error('No CSV file uploaded for this job')

  let source = csv.text
  let bomBytes = 0
  if (state.byteOffset === 0) {
    const stripped = stripBom(source)
    // stripBom removes the U+FEFF character; as UTF-8 that is 3 bytes, and
    // the byte cursor has to account for them or every later range is
    // misaligned by three.
    bomBytes = byteLengthOf(source) - byteLengthOf(stripped)
    source = stripped
    if (!state.headers) state.delimiter = detectCsvDelimiter(source)
  }

  // True only when this slice genuinely reaches the end of the object. When
  // false the parser must not flush a trailing partial row -- see
  // parseDelimitedRowsWindow's sourceIsComplete.
  let reachedEof = state.byteOffset + csv.bytesRead >= csv.totalSize
  let window = parseDelimitedRowsWindow(source, state.delimiter, 0, state.inQuotes, MATERIALIZE_ROWS_PER_CHUNK, reachedEof)

  // A single row longer than the whole window would parse to zero rows and
  // the job would never advance. Widen and retry rather than spin: real
  // exports do contain enormous description cells, and a silent stall is
  // far worse than one extra read.
  while (!window.rows.length && !reachedEof) {
    windowBytes *= 4
    const wider = await fetchCsvRange(env, jobId, state.byteOffset, windowBytes)
    if (!wider) break
    csv = wider
    source = state.byteOffset === 0 ? stripBom(csv.text) : csv.text
    reachedEof = state.byteOffset + csv.bytesRead >= csv.totalSize
    window = parseDelimitedRowsWindow(source, state.delimiter, 0, state.inQuotes, MATERIALIZE_ROWS_PER_CHUNK, reachedEof)
  }

  // The parser reports a CHARACTER offset into this slice; the cursor we
  // persist is a BYTE offset into the file. They differ for any non-ASCII
  // content, and this catalog is full of Khmer.
  const consumedBytes = byteLengthOf(source.slice(0, window.nextIndex))
  const nextByteOffset = state.byteOffset + bomBytes + consumedBytes

  let rawRows = window.rows
  let rawIndex = state.rawRowIndex
  if (!state.headers) {
    // First raw row of the file is the header -- consumed here exactly
    // once (never itself persisted to import_job_source_rows), same as
    // parseCsvRows treating rows[0] as headers. Guarded by rawRows.length
    // for the edge case of a window that starts (and, for a tiny/empty
    // file, ends) with zero rows -- state.headers still needs to become a
    // (possibly empty) array so this branch doesn't run again next window.
    state.headers = rawRows.length ? normalizeCsvHeaders(rawRows[0]) : []
    state.blankHeaderColumns = findBlankHeaderIndexes(state.headers)
    state.blankHeaderColumnsWithData = state.blankHeaderColumnsWithData || []
    state.duplicateHeaderKeys = findDuplicateHeaderKeys(state.headers)
    if (rawRows.length) {
      rawRows = rawRows.slice(1)
      rawIndex += 1
    }
  }

  const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
  let sequence = state.rowsWritten
  let cappedEarly = false
  // Confirm, incrementally across every window this job takes, which of
  // this file's blank-header columns actually carry data -- see
  // blankHeaderColumnsWithData's own comment on MaterializeState. Only
  // columns still unconfirmed are worth checking each row; skips the work
  // entirely on the (common) case of a file with no blank headers at all.
  const stillUncheckedBlankColumns = (state.blankHeaderColumns || []).filter(
    (col) => !(state.blankHeaderColumnsWithData || []).includes(col),
  )
  for (const values of rawRows) {
    rawIndex += 1
    if (stillUncheckedBlankColumns.length) {
      for (let i = stillUncheckedBlankColumns.length - 1; i >= 0; i -= 1) {
        const col = stillUncheckedBlankColumns[i]
        if (String(values[col - 1] ?? '').trim() !== '') {
          state.blankHeaderColumnsWithData = [...(state.blankHeaderColumnsWithData || []), col]
          stillUncheckedBlankColumns.splice(i, 1)
        }
      }
    }
    if (sequence >= MAX_SYNC_ROWS) { cappedEarly = true; break } // same hard ceiling fetchDecidedRows applied via `.slice(0, MAX_SYNC_ROWS)` -- preserved here so a huge file still stops materializing rather than growing import_job_source_rows unbounded
    const parsedRow = csvValuesToRow(values, state.headers, rawIndex)
    if (!hasParsedCsvRowContent(parsedRow)) continue // matches parseCsvRows' blank-row skip -- sequence must stay contiguous over non-blank rows only
    if (type === 'sales') {
      const explicitGroupKey = str(parsedRow.receipt_number || parsedRow.order_reference)
      if (explicitGroupKey) {
        state.salesLastGroupKey = explicitGroupKey
      } else if (state.salesLastGroupKey) {
        // Internal only: never part of the user-facing template and never
        // written to sales. It seals the file-order inheritance decision
        // once, before analyze/review/apply retries can diverge.
        parsedRow._sales_group_key = state.salesLastGroupKey
      }
    }
    statements.push({
      sql: `INSERT OR REPLACE INTO import_job_source_rows (job_id, sequence, row_number, data_json) VALUES (@job_id, @sequence, @row_number, @data_json)`,
      params: { job_id: jobId, sequence, row_number: rawIndex, data_json: JSON.stringify(parsedRow) },
    })
    sequence += 1
  }
  if (statements.length) await runD1BatchInChunks(db, statements)

  // The byte cursor is what the next range read resumes from. charOffset is
  // still tracked because it is what the parser speaks, but it is now an
  // offset within a SLICE, so it is only meaningful together with byteOffset.
  state.byteOffset = nextByteOffset
  state.charOffset = window.nextIndex
  state.inQuotes = window.nextInQuotes
  state.rawRowIndex = rawIndex
  state.rowsWritten = sequence
  const isDone = window.done || cappedEarly

  await saveMaterializeState(db, jobId, state, isDone)
  await env.IMPORT_QUEUE.send({ jobId, kind })
  return true
}

// Cheap metadata read for a materialized job -- no row data, just counts
// and the fields analyze/apply need alongside the rows themselves. Replaces
// fetchDecidedRows for these two callers (loadAndClassify's bounded preflight
// sample still uses fetchDecidedRows directly -- see that function's own
// "NOT chunked" comment, unaffected by any of this).
async function fetchMaterializedMeta(db: D1Compat, jobId: string): Promise<{ type: ImportType; policyJson: string | null; fileName: string; totalRows: number } | null> {
  const job = await db.prepare(`SELECT type, policy_json FROM import_jobs WHERE id = @id`).get<{ type: ImportType; policy_json: string | null }>({ id: jobId })
  if (!job) return null
  const fileRow = await db.prepare(`SELECT original_name FROM import_job_files WHERE job_id = @job_id AND kind = 'csv' ORDER BY id DESC LIMIT 1`)
    .get<{ original_name: string | null }>({ job_id: jobId })
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get<{ n: number }>({ id: jobId })
  return { type: job.type, policyJson: job.policy_json, fileName: fileRow?.original_name || 'import.csv', totalRows: countRow?.n || 0 }
}

// Bounded window read -- what analyze/apply's per-chunk classify pass runs
// against. A plain indexed SELECT (I/O-bound) over already-normalized rows,
// replacing the old decided.rows.slice(cursor, cursor+N) over a freshly
// reparsed full file.
async function readMaterializedWindow(db: D1Compat, jobId: string, cursor: number, limit: number, decisions: Record<string, RowDecision>): Promise<ParsedCsvRow[]> {
  const rows = await db.prepare(`SELECT data_json FROM import_job_source_rows WHERE job_id = @id AND sequence >= @cursor AND sequence < @end ORDER BY sequence ASC`)
    .all<{ data_json: string }>({ id: jobId, cursor, end: cursor + limit })
  return rows.map((r) => {
    const row = JSON.parse(r.data_json) as ParsedCsvRow
    return applyDecision(row, decisions[String(row._rowNumber)])
  })
}

// Full-file read -- still needed for the handful of genuinely cross-row
// computations (sales' order_reference grouping, products' image-match
// candidate list) that can't be windowed without changing their results
// (see ImportChunkState's own comments on both). Meaningfully cheaper than
// before (JSON.parse over already-normalized small per-row blobs, no CSV
// char-scan, no repeated NFC-normalize) but still O(total rows) in one
// invocation -- the one remaining place a sufficiently large + sufficiently
// wide file could still risk the CPU budget on products/sales imports
// specifically. Not chunked further in this pass; see progress.md.
async function readAllMaterializedRows(db: D1Compat, jobId: string, decisions: Record<string, RowDecision>): Promise<ParsedCsvRow[]> {
  const rows = await db.prepare(`SELECT data_json FROM import_job_source_rows WHERE job_id = @id ORDER BY sequence ASC`).all<{ data_json: string }>({ id: jobId })
  return rows.map((r) => {
    const row = JSON.parse(r.data_json) as ParsedCsvRow
    return applyDecision(row, decisions[String(row._rowNumber)])
  })
}

function applyDecision(row: ParsedCsvRow, decision: RowDecision | undefined): ParsedCsvRow {
  if (!decision) return row
  const next: ParsedCsvRow = { ...row }
  if (decision.field_overrides && typeof decision.field_overrides === 'object') {
    for (const [key, value] of Object.entries(decision.field_overrides)) {
      next[key] = value
    }
  }
  return next
}

function getDecisionMap(policyJson: string | null | undefined): Record<string, RowDecision> {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    const decisions = policy?.decisionsByRowNumber
    return decisions && typeof decisions === 'object' ? decisions : {}
  } catch (_) {
    return {}
  }
}

// Per-field CSV merge/conflict-decision system, ported from
// backend/src/routes/contacts.ts's resolveFieldValue/normalizeFieldRule.
// The frontend (ContactImportModal.tsx) already sends { conflictMode,
// fieldRules } as part of the job's `policy` at creation time -- this was
// previously stored in import_jobs.policy_json (alongside
// decisionsByRowNumber, which getDecisionMap above already reads) but never
// read back out, so classifyContacts always did a blind full-row overwrite
// on every matched row regardless of what the operator picked in the modal.
// This is the "per-FIELD merge/conflict-decision system isn't ported" gap
// flagged at the top of routes/contacts.ts.
type ContactFieldRule = 'keep_existing' | 'use_imported' | 'merge_blank_only' | 'clear_value'
type ContactConflictMode = 'skip' | 'merge' | 'overwrite'

function normalizeContactFieldRule(value: unknown, fallback: ContactFieldRule): ContactFieldRule {
  const rule = String(value || fallback || '').trim().toLowerCase()
  return (['keep_existing', 'use_imported', 'merge_blank_only', 'clear_value'] as string[]).includes(rule)
    ? (rule as ContactFieldRule)
    : fallback
}

// Mirrors resolveFieldValue exactly: merge_blank_only keeps the existing
// value unless it's falsy (null/''/0), in which case the imported value
// fills the gap -- it does NOT mean "never touch existing data".
function resolveContactFieldValue(existingValue: unknown, incomingValue: unknown, rule: unknown, defaultRule: ContactFieldRule): unknown {
  const effectiveRule = normalizeContactFieldRule(rule, defaultRule)
  const existing = existingValue ?? null
  const incoming = incomingValue ?? null
  if (effectiveRule === 'clear_value') return null
  if (effectiveRule === 'use_imported') return incoming
  if (effectiveRule === 'keep_existing') return existing
  return existing || incoming
}

function getContactMergePolicy(policyJson: string | null | undefined): { conflictMode: ContactConflictMode; fieldRules: Record<string, unknown> } {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    const conflictMode: ContactConflictMode = ['skip', 'merge', 'overwrite'].includes(policy?.conflictMode) ? policy.conflictMode : 'merge'
    const fieldRules = policy?.fieldRules && typeof policy.fieldRules === 'object' ? policy.fieldRules : {}
    return { conflictMode, fieldRules }
  } catch (_) {
    return { conflictMode: 'merge', fieldRules: {} }
  }
}

// 'merge' (default): add/update rows into the existing catalog, same
// create-vs-update matching classifyProducts already does (same name +
// same cost/price/barcode, branch excluded from the comparison -> merge
// into the existing row and add branch_stock; same name + a real
// cost/price/barcode difference -> a new row, which the frontend's
// existing name-based grouping already presents as a variant under that
// name). 'replace_all': the imported file IS the complete, current
// catalog going forward -- same create/update matching runs unchanged
// (so a row that matches an existing product still updates it in place
// rather than creating a duplicate), but at the end of the run every
// active product this import never touched gets soft-deactivated (see
// the 'replace_all' block at the end of runImportApply below). Not a
// hard DELETE -- same reasoning as products.ts's DELETE /:id and
// merge-duplicates route: sale_items/inventory_movements/audit rows can
// still reference an old product's id, and a soft is_active=0 keeps
// those valid instead of leaving dangling references.
// 'fill_blank': job-level, non-destructive mode -- for every column
// PRODUCT_REPLACE_COLUMNS covers, a matched row's imported value only
// lands when the existing product's own value is blank/0; an
// already-filled existing value is always kept, never overwritten. Stock
// (stock_quantity/branch_stock/product_batches) is never touched by this
// mode regardless of what the CSV's quantity column carries -- see
// applyFillBlankOnlyMode and the materializeImportChunk branch below.
// Meant for enriching an existing catalog's missing description/barcode/
// unit/etc. from a supplementary file without risking a stock or price
// clobber from a stale quantity column.
export type ProductImportMode = 'merge' | 'replace_all' | 'replace_columns' | 'fill_blank'

// Column-level replace's allow-list -- deliberately the exact same field
// set the exhaustive "override_replace" UPDATE below already writes
// (minus stock_quantity, which is a cross-branch aggregate handled via
// branch_stock/product_batches, not a plain column, and image_gallery,
// synced through its own side table) so a column-replace pick can never
// touch anything the existing full-replace path wouldn't also touch.
export const PRODUCT_REPLACE_COLUMNS = [
  'name', 'sku', 'barcode', 'category', 'categories', 'unit', 'description',
  'brand', 'brands', 'supplier',
  'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
  'cost_price_usd', 'cost_price_khr',
  'low_stock_threshold', 'out_of_stock_threshold',
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr',
  'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at',
  'expiry_date', 'expiry_alert_days', 'is_active', 'image_path',
] as const

/**
 * Whether this job may wire matched images onto products.
 *
 * Image matching used to run automatically on the first chunk of every
 * products import that had images attached. That is the wrong default for
 * the case it actually gets used in: a delete-and-reimport, where the
 * operator wants to see WHICH images matched WHICH rows -- and how many
 * matched nothing -- before any of it is attached. Once it has run
 * automatically there is no "not yet"; the only way back is another delete.
 *
 * So it is now opt-in per job. `policy.wire_images` is set by the explicit
 * "Wire images" action (POST /:id/images/wire); until then analyze and apply
 * run exactly as they would for a CSV with no images at all, which is a
 * genuinely safe state rather than a half-applied one.
 *
 * Absent policy means NOT wired. A job created before this existed therefore
 * needs the button pressed too -- deliberate, because silently wiring images
 * for an in-flight job is precisely the surprise this removes.
 */
export function shouldWireImages(policyJson: string | null | undefined): boolean {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    return policy?.wire_images === true
  } catch (_) {
    return false
  }
}

export function getProductImportMode(policyJson: string | null | undefined): ProductImportMode {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    if (policy?.import_mode === 'replace_all') return 'replace_all'
    if (policy?.import_mode === 'replace_columns') return 'replace_columns'
    if (policy?.import_mode === 'fill_blank') return 'fill_blank'
    return 'merge'
  } catch (_) {
    return 'merge'
  }
}

// Column-replace's own column selection, read the same way decisions/
// field_rules already are elsewhere in this file -- an unknown/invalid
// entry (typo, a column that isn't on the allow-list, a stale policy_json
// from before some column was added to/removed from the allow-list) is
// silently dropped rather than causing the whole import to error, same
// "don't let one bad value abort an otherwise-valid job" posture
// field_rules parsing already takes.
export function getProductImportReplaceColumns(policyJson: string | null | undefined): string[] {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    const requested = Array.isArray(policy?.replace_columns) ? policy.replace_columns : []
    const allowed = new Set<string>(PRODUCT_REPLACE_COLUMNS)
    return Array.from(new Set(requested.filter((col: unknown) => typeof col === 'string' && allowed.has(col))))
  } catch (_) {
    return []
  }
}

// ---------------------------------------------------------------------------
// Per-type classification. Each function takes the already CSV-parsed rows
// and existing DB rows (loaded once, up front) and returns a classification
// per row without writing anything -- used identically by analyze (preview
// only) and apply (preview + write).

export async function classifyProducts(
  db: D1Compat,
  rows: ParsedCsvRow[],
  jobId: string,
  policyJson?: string | null,
  // Chunked callers (runImportAnalyze/runImportApply) pass this in,
  // pre-computed ONCE over the full file by computeAndCacheImageMatch --
  // NOT recomputed here from `rows`, which for a chunked caller is only a
  // small window and would give wrong (window-scoped, not file-scoped)
  // over-limit resolution for computeImportImageMatch's cross-row scoring.
  // Only loadAndClassify's own (small, bounded) synchronous callers --
  // POST /:id/preflight -- leave this undefined and let this function
  // compute it the old way, over whatever `rows` they passed in.
  precomputedRowImagePaths?: Map<number, string>,
): Promise<ImportRowResult[]> {
  const imagesByKey = await loadImportJobImageMap(db, jobId)
  const rowImagePaths = precomputedRowImagePaths ?? (await computeImportImageMatch(db, jobId, rows, policyJson)).rowImagePaths
  const productImportMode = getProductImportMode(policyJson)
  // Columns beyond the original id/sku/barcode/name/cost/price/category/
  // brand/unit/supplier/description/low_stock_threshold set are only
  // needed for 'fill_blank' mode's field-by-field blank check
  // (applyFillBlankOnlyMode reads every PRODUCT_REPLACE_COLUMNS column off
  // `match`) -- selected unconditionally rather than gated on mode so this
  // query shape doesn't fork, and so `match`'s type stays the same
  // regardless of which mode a given import job happens to be running.
  const existing = await db
    .prepare(`SELECT id, sku, barcode, name, cost_price_usd, cost_price_khr, selling_price_usd, selling_price_khr, category, categories, brand, brands, unit, supplier, description, low_stock_threshold, special_price_usd, special_price_khr, out_of_stock_threshold, discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at, expiry_date, expiry_alert_days, is_active, image_path FROM products`)
    .all<{ id: number; sku: string | null; barcode: string | null; name: string | null; cost_price_usd: number | null; cost_price_khr: number | null; selling_price_usd: number | null; selling_price_khr: number | null; category: string | null; categories: string | null; brand: string | null; brands: string | null; unit: string | null; supplier: string | null; description: string | null; low_stock_threshold: number | null; special_price_usd: number | null; special_price_khr: number | null; out_of_stock_threshold: number | null; discount_enabled: number | null; discount_type: string | null; discount_percent: number | null; discount_amount_usd: number | null; discount_amount_khr: number | null; discount_label: string | null; discount_badge_color: string | null; discount_starts_at: string | null; discount_ends_at: string | null; expiry_date: string | null; expiry_alert_days: number | null; is_active: number | null; image_path: string | null }>()
  const bySku = new Map<string, typeof existing[number]>()
  // One barcode can now legitimately map to SEVERAL distinct products (see
  // the barcode-collision guard below) -- keep every candidate per barcode,
  // not just the last one seen, so a later classify pass (a re-import of
  // the same file, or any later chunk) can disambiguate by name instead of
  // being stuck with whichever candidate happened to load last. A plain
  // one-per-barcode Map here would make re-importing an already-collision-
  // split file keep creating yet another duplicate for whichever candidate
  // it couldn't "see" -- confirmed by actually re-running a real 11,890-row
  // file's import twice in a row against the same database: without this,
  // ~40 rows whose barcode is shared by 2+ real products created a fresh
  // duplicate on the second run instead of matching their own
  // already-imported product back up.
  const byBarcode = new Map<string, typeof existing[number][]>()
  const byName = new Map<string, typeof existing[number][]>()
  for (const record of existing) {
    if (str(record.sku)) bySku.set(lower(record.sku), record)
    if (str(record.barcode)) {
      const key = lower(record.barcode)
      if (!byBarcode.has(key)) byBarcode.set(key, [])
      byBarcode.get(key)!.push(record)
    }
    const nameKey = normalizeProductGroupName(record.name)
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey)!.push(record)
    }
  }

  // A product with no branch_stock row is invisible to any branch-filtered
  // POS/Inventory view -- resolve a branch for every row up front (matching
  // classifyInventory's lookup below) so runImportApply always has one to
  // write, instead of leaving new products branchless the way this used to.
  const branchRows = await db.prepare(`SELECT id, name, is_default FROM branches WHERE is_active = 1`).all<{ id: number; name: string; is_default: number }>()
  const importBranchByName = new Map<string, number>()
  for (const branch of branchRows) importBranchByName.set(lower(branch.name), branch.id)
  const importDefaultBranchId = (branchRows.find((b) => b.is_default) || branchRows[0] || null)?.id ?? null

  const results: ImportRowResult[] = []
  for (const row of rows) {
    // `row.product` covers the Customer Portal description-wiring
    // column set's own "Product" header (Part 329) -- matches by name,
    // same as the existing name/product_name aliases, not a new match
    // strategy.
    const name = str(row.name || row.product_name || row.product)
    const sku = str(row.sku || row.code || row.product_code)
    const barcode = str(row.barcode || row.upc || row.ean)
    if (!name) {
      results.push({ rowNumber: row._rowNumber, action: 'error', identifier: sku || barcode || null, existingId: null, message: 'Missing required field: name', changes: {}, data: row })
      continue
    }
    // '||' inside a category/brand CSV cell means "this product is in
    // more than one category/carries more than one brand tag" -- e.g.
    // "Skincare||Gift Set" -- same convention normalizeMultiValue uses on
    // the manual Add/Edit form path (see migrations/0033_product_multi_
    // category_brand.sql). The FIRST segment becomes the primary
    // category/brand (unchanged column, everything that already reads
    // p.category/p.brand keeps working exactly as before); the full,
    // deduped, `||`-rejoined list goes to the new categories/brands
    // columns. A cell with no '||' behaves exactly as it always has --
    // single value in, single value out, categories/brands ends up equal
    // to category/brand.
    const rawCategoryCell = str(row.category)
    const categoryParts = rawCategoryCell ? rawCategoryCell.split('||').map((v) => v.trim()).filter(Boolean) : []
    const rawBrandCell = str(row.brand)
    const brandParts = rawBrandCell ? rawBrandCell.split('||').map((v) => v.trim()).filter(Boolean) : []
    const dedupeJoin = (parts: string[]) => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const part of parts) {
        const key = part.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(part)
      }
      return out.join('||')
    }
    const data: Record<string, unknown> = {
      name,
      sku: sku || null,
      barcode: barcode || null,
      category: categoryParts[0] || null,
      categories: categoryParts.length ? dedupeJoin(categoryParts) : null,
      unit: str(row.unit) || 'pcs',
      // An explicit `description` column always wins outright; only
      // when the CSV has none do we assemble one from the named
      // Introduction/Official Product Name/Features & Benefits/Who is
      // it for?/Ingredients columns (see buildDescriptionFromColumns).
      // Only the five whitelisted sections survive an import; any other
      // `"Something":` block in the cell is dropped rather than imported.
      // See lib/productDescriptionSections.ts for why (supplier boilerplate
      // no display surface knows how to render), and note that Caution /
      // Need More Details are deliberately NOT importable -- those are
      // portal-wide defaults authored in the Customer Portal editor, and a
      // supplier's wording must not silently override the shop's own.
      description: sanitizeImportedDescription(str(row.description) || buildDescriptionFromColumns(row)).text || null,
      brand: brandParts[0] || null,
      brands: brandParts.length ? dedupeJoin(brandParts) : null,
      supplier: str(row.supplier) || null,
      selling_price_usd: normalizeImportMoney(row.selling_price_usd ?? row.price_usd),
      selling_price_khr: normalizeImportMoney(row.selling_price_khr ?? row.price_khr),
      // Accepts the current cost_price_usd/khr header, plus older
      // purchase_price_usd/khr and cost_usd/khr headers from files
      // exported before the product-cost fields were consolidated (see
      // migration 0016) -- an old export must still re-import cleanly.
      cost_price_usd: normalizeImportMoney(row.cost_price_usd ?? row.purchase_price_usd ?? row.cost_usd),
      cost_price_khr: normalizeImportMoney(row.cost_price_khr ?? row.purchase_price_khr ?? row.cost_khr),
      stock_quantity: parseImportNumericValue(row.stock_quantity ?? row.quantity, 0, { allowNegative: false, field: 'stock_quantity' }),
      low_stock_threshold: parseImportNumericValue(row.low_stock_threshold, 10),
      is_active: toBool01(row.is_active, 1),
    }
    // Track F parity (special pricing, discount/promotion fields,
    // out_of_stock_threshold, expiry_date/expiry_alert_days): these columns
    // were added to materializeImportChunk's INSERT/UPDATE statements and
    // to REQUIRED_PRODUCT_WRITE_COLUMNS's source-text regression guard, but
    // this `data` object itself never actually read the values off the row
    // -- every one of the columns below was bound as undefined on every
    // real import (confirmed via a live run: a row with every field set
    // produced a `data` object missing all of them). The source-text test
    // only checks the SQL string names each column, not that a value
    // reaches it, so it passed while the bug shipped. Fixed for real here,
    // mirroring frontend/productImportPlanner.ts's normalizeProductImportRow
    // defaults so a CSV row and the manual Add/Edit form produce the same
    // stored values for the same input.
    // VIP price (stored in the special_price_* columns -- the DB name is
    // unchanged; only the label is "VIP" now). Accepts the new `vip_price_*`
    // header AND the legacy `special_price_*` one so old export files still
    // import. A BLANK VIP price stores 0, NOT the selling price: defaulting
    // to selling silently set VIP = selling on every row without an explicit
    // value, which is exactly the "import didn't read the special price"
    // report, and the edit form then wrote that back. Every consumer
    // (POS, portal, detail) already treats 0 as "no VIP price, use selling",
    // so 0 is the correct absent value.
    const vipUsdRaw = row.vip_price_usd ?? row.special_price_usd
    const vipKhrRaw = row.vip_price_khr ?? row.special_price_khr
    data.special_price_usd = vipUsdRaw !== undefined && str(vipUsdRaw) !== ''
      ? normalizeImportMoney(vipUsdRaw)
      : 0
    data.special_price_khr = vipKhrRaw !== undefined && str(vipKhrRaw) !== ''
      ? normalizeImportMoney(vipKhrRaw)
      : 0
    data.out_of_stock_threshold = parseImportNumericValue(row.out_of_stock_threshold, 0, { allowNegative: false, field: 'out_of_stock_threshold' })
    data.discount_enabled = toBool01(row.discount_enabled ?? row.promotion_enabled ?? row.on_promotion, 0)
    const importDiscountAmountUsd = normalizeImportMoney(row.discount_amount_usd, 0)
    const importDiscountAmountKhr = normalizeImportMoney(row.discount_amount_khr, 0)
    data.discount_type = str(row.discount_type).toLowerCase() === 'fixed'
      ? 'fixed'
      : (str(row.discount_type).toLowerCase() === 'percent'
        ? 'percent'
        : ((importDiscountAmountUsd || importDiscountAmountKhr) ? 'fixed' : 'percent'))
    data.discount_percent = parseImportNumericValue(row.discount_percent, 0, { allowNegative: false, field: 'discount_percent' })
    data.discount_amount_usd = importDiscountAmountUsd
    data.discount_amount_khr = importDiscountAmountKhr
    data.discount_label = str(row.discount_label) || null
    data.discount_badge_color = str(row.discount_badge_color) || '#e11d48'
    data.discount_starts_at = str(row.discount_starts_at) || null
    data.discount_ends_at = str(row.discount_ends_at) || null
    data.expiry_date = str(row.expiry_date) || null
    // The batch/"Created" date a newly-imported product's initial stock
    // arrived -- separate from expiry_date (when it goes bad). Always
    // resolves to a real date: an explicit value from the CSV, or today's
    // date when the column is left blank (see the source-lock-in test's
    // comment for why this can't just be null -- a blank column still
    // means "received now", same as a manual Receive Stock action with no
    // date typed in). Only meaningful for brand-new products -- see
    // materializeImportChunk's create-row branch below, which is the only
    // place this creates a product_batches row; an UPDATE to an existing
    // product never touches its batch history from here.
    // Column consolidation (Aug 24 2026, explicit user direction): the
    // template used to ship two separate optional columns, a `date` a
    // person filled in AND a `batch` label that was silently ignored
    // (lot_code was always derived from `date`, never from whatever text
    // was typed into `batch` -- confusing, and the ignored column implied
    // control it didn't have). Now there is exactly one column,
    // `batch(mm/dd/yyyy)` -- its value (e.g. "08/24/2026") is read
    // directly as the received date, so the batch column and the date
    // column are the same input. `batch`/`date`/`received_date` (in that
    // order) are still accepted as fallbacks so an existing hand-built or
    // previously-downloaded CSV using any of the older column names isn't
    // broken by the rename. Either way, a blank cell still means
    // "received now" -- see the comment above on why this can't just be
    // null.
    data.received_date = str(row['batch(mm/dd/yyyy)'] || row.batch || row.date || row.received_date) || todayIso()
    // The stored/displayed batch code is always derived from
    // received_date directly above, never from a separately-typed label
    // -- "lot code can be removed... batch column is just a translated
    // version of received date": 08/22/2026 or 8/22/2026 becomes
    // AUG222026, 08/2/2026 becomes AUG022026 (see batchCode.ts's
    // dateToBatchCode). This is the date that decides which lot a
    // restock row tops up (see materializeImportChunk's
    // batchByProductAndLot matching below, and receiveBatchStock's
    // identical rule for the manual Receive Stock path) -- a row naming
    // the same received date as an earlier import (or a manual receive)
    // naturally lands in the same batch, without a person needing to
    // retype a matching label.
    data.lot_code = dateToBatchCode(data.received_date as string)
    data.expiry_alert_days = parseImportNumericValue(row.expiry_alert_days, 30, { allowNegative: false, field: 'expiry_alert_days' })
    // parseImportNumericValue's allowNegative:false silently falls back to
    // 0 -- correct for genuinely garbage input, but indistinguishable from
    // a source file deliberately tracking a negative (backorder) count.
    // Re-parse the same raw value WITH negatives allowed purely to detect
    // that specific case and surface a visible message instead of a
    // silent, unexplained 0 -- see the barcode-collision guard below for
    // the same "warn, don't silently lose information" principle. Doesn't
    // change the stored value: negative stock is still not something this
    // app supports today (branch_stock/POS assume >= 0 throughout), so 0
    // remains what's written -- this only makes the substitution visible.
    const rawStockValue = row.stock_quantity ?? row.quantity
    const stockWasNegative = str(rawStockValue) !== '' && parseImportNumericValue(rawStockValue, 0, { allowNegative: true, field: 'stock_quantity' }) < 0
    const rowWarnings: ImportRowWarning[] = []
    if (stockWasNegative) {
      // Strip a leading apostrophe purely for display -- a common Excel
      // "force this cell to text" artifact (seen on real files as `'-2`)
      // that workbookToDelimitedText carries straight through into the
      // CSV. Harmless to parsing (removeCurrencyNoise in importNumbers.ts
      // already strips it before the number is read), just noisy in a
      // message meant for a human to read.
      const displayValue = str(rawStockValue).replace(/^'/, '')
      rowWarnings.push({ kind: 'negative_stock', message: `Stock quantity "${displayValue}" is negative; imported as 0 (negative stock isn't supported).` })
    }
    // Only set image_path when this row actually resolved one, and only
    // then if the row didn't explicitly ask to keep whatever the existing
    // product already has (image_conflict_mode='keep_existing') -- see
    // resolveRowImagePath above for the "same filename = same product"
    // matching itself. Leaving it out of `data` entirely (rather than
    // null) means runImportApply's UPDATE statement skips the column and
    // an existing product's image survives an import that carried none.
    const conflictMode = str(row.image_conflict_mode).toLowerCase()
    if (conflictMode !== 'keep_existing') {
      const resolvedImage = resolveRowImagePath(row, name, imagesByKey, rowImagePaths.get(row._rowNumber) || null)
      if (resolvedImage) data.image_path = resolvedImage
    }
    const importBranchName = str(row.branch_name || row.branch)
    const explicitImportBranchId = importBranchName ? importBranchByName.get(lower(importBranchName)) ?? null : null
    // Extra keys here (branch_id, branch_id_explicit, branch_name_pending)
    // ride along in `data` purely for runImportApply to read -- they
    // aren't products columns, so the UPDATE/INSERT statements built from
    // named @placeholders simply never reference them.
    //
    // Three cases, matching the "create it if it's genuinely new, reuse
    // it if it's just a different case, fall back to default (creating
    // one if needed) if no branch was named at all" rule:
    // 1. CSV named a branch that already exists (case-insensitively) ->
    //    use its id, nothing to create.
    // 2. CSV named a branch that does NOT exist yet -> branch_id stays
    //    null here and branch_name_pending carries the name so
    //    runImportApply (the only place with write access -- see its own
    //    "no data-table writes" comment on analyze) can create it for
    //    real and resolve the id before building the INSERT/UPDATE batch.
    // 3. CSV named no branch at all -> use the org's default branch; if
    //    there isn't one yet either (brand-new deployment, zero branches),
    //    branch_name_pending is set to the reserved DEFAULT_BRANCH_SENTINEL
    //    so apply-time creates a first "Main Branch" and uses it.
    if (importBranchName && explicitImportBranchId == null) {
      data.branch_id = null
      data.branch_id_explicit = 1
      data.branch_name_pending = importBranchName
    } else if (!importBranchName && importDefaultBranchId == null) {
      data.branch_id = null
      data.branch_id_explicit = 0
      data.branch_name_pending = DEFAULT_BRANCH_SENTINEL
    } else {
      data.branch_id = explicitImportBranchId ?? importDefaultBranchId
      data.branch_id_explicit = explicitImportBranchId != null ? 1 : 0
    }

    const skuMatch = sku ? bySku.get(lower(sku)) || null : null
    const barcodeCandidates = !skuMatch && barcode ? byBarcode.get(lower(barcode)) || null : null
    // Prefer the candidate (if any) whose name is actually compatible with
    // this row -- when a barcode has been legitimately split across
    // several distinct products (see the guard below), this is what lets a
    // re-import correctly find "this specific one" back instead of only
    // ever seeing whichever candidate happened to be last in the list.
    const barcodeMatch = barcodeCandidates
      ? barcodeCandidates.find((c) => normalizeProductGroupName(c.name) === normalizeProductGroupName(name)) || barcodeCandidates[0]
      : null
    let match = skuMatch || barcodeMatch

    // An SKU match is no longer trusted unconditionally. Previously, a
    // matched SKU with a differing name was treated as a deliberate
    // rename-via-reimport and silently updated the existing product's
    // name/price/category. In practice an SKU can be reused/mistyped
    // across genuinely different products the same way a barcode can --
    // that's the exact same silent-data-loss shape the barcode guard
    // below exists to prevent, just via a different identifier. Flip the
    // policy to match: when the SKU matches but the existing product's
    // name is NOT compatible with the incoming row's name, don't merge --
    // flag it and import this row as its own separate product instead. A
    // genuine rename now requires the operator to confirm it manually
    // (same path as a flagged barcode collision) rather than an
    // accidental SKU collision silently overwriting the wrong product.
    if (skuMatch && normalizeProductGroupName(skuMatch.name) !== normalizeProductGroupName(name)) {
      rowWarnings.push({ kind: 'sku_collision', message: `SKU "${sku}" is already used by a different product ("${skuMatch.name || 'unnamed'}"). Imported as a separate product -- merge manually if this was meant to update it.` })
      match = null
    }

    // A barcode-only match is likewise not trusted blindly. Real-world
    // exports frequently reuse a barcode across genuinely different
    // products (a shared promotional/set barcode across several distinct
    // cosmetics items is common) -- confirmed against a real 11,890-row
    // file where 1,305 barcodes were each reused across 2+ different
    // product names. Matching on barcode alone let each later row with
    // that barcode silently overwrite the previous row's product
    // (name/price/category), with the earlier product's identity and
    // branch stock vanishing with no error or warning -- genuine silent
    // data loss, not the "update this product" behavior a barcode match
    // is meant to represent. Guard: only accept a barcode match when the
    // existing product's name is compatible (same after normalization)
    // with the incoming row's name. When it isn't, don't merge -- import
    // this row as its own separate product instead (barcode isn't unique
    // in the schema, see migrations/0001_init.sql's plain index, not a
    // UNIQUE constraint) and leave a visible message so the operator
    // notices the shared barcode and can merge it manually if that was
    // actually intended.
    if (barcodeMatch && match && normalizeProductGroupName(barcodeMatch.name) !== normalizeProductGroupName(name)) {
      rowWarnings.push({ kind: 'barcode_collision', message: `Barcode "${barcode}" is already used by a different product ("${barcodeMatch.name || 'unnamed'}"). Imported as a separate product -- merge manually if this was meant to update it.` })
      match = null
    }

    // Fallback when the CSV has no SKU/barcode match (often no SKU/barcode
    // at all, or a per-branch code that legitimately differs): look for an
    // existing product with the SAME NAME whose cost, selling price, and
    // barcode are ALSO all identical -- only then is this genuinely "the
    // same product" and safe to merge into one row. If a same-name product
    // exists but any of those differ (a real cost/price/barcode difference),
    // it's treated as a distinct row instead of silently overwriting the
    // existing one -- the existing name-based display grouping
    // (utils/productGrouping.ts on the frontend) already presents
    // same-name rows as one card with selectable options, so no extra
    // linkage is needed here, just the right create-vs-update decision.
    //
    // Branch is deliberately NOT part of this comparison. products is a
    // single global table; branch_stock (product_id, branch_id, quantity)
    // is the only per-branch thing that exists -- a product is meant to be
    // able to carry stock at several branches at once under the SAME row.
    // An earlier version of this rule required the existing product to
    // already be stocked at the incoming row's branch (or have no branch
    // stock at all) before it would merge, which inverted that: the single
    // most common real case -- an already-known product's first CSV row
    // for a branch it isn't carried at yet -- failed that check and forked
    // off a second, disconnected product row that only coincidentally
    // shared a name with the first, one per branch that ever imported it.
    // A real two-branch export (the whole catalog listed once per branch)
    // reproduced this exactly: same name and details, second branch's row
    // created a sibling product instead of adding branch_stock to the
    // first. Dropping the branch check means this fallback now only asks
    // "is this genuinely the same product" -- same name group, same DETAILS
    // (barcode + cost, see lib/productDetailRule.ts); whichever branch the
    // row named just gets its own branch_stock entry on that single product
    // via the existing update-path write below.
    if (!match) {
      const candidates = byName.get(normalizeProductGroupName(name)) || []
      const incomingDetails = productDetailSignature(data as Record<string, unknown>)
      for (const candidate of candidates) {
        if (productDetailSignature(candidate as unknown as Record<string, unknown>) === incomingDetails) { match = candidate; break }
      }
    }

    // Selling and special price are NOT identity (see productDetailRule.ts):
    // they are what we plan to charge, not what the item is. When this row
    // merges into an existing product and the two disagree, the HIGHEST of
    // each wins -- merging must never quietly drop a product below a price
    // one of the merged rows expected to charge. Applied before the changes
    // diff and before the write, so the reviewer sees the value that will
    // actually be stored.
    if (match) {
      Object.assign(data, resolveMergedPricing([
        match as unknown as Record<string, unknown>,
        data,
      ]))
    }

    // Reconcile the "Details" field-rule preset (see applyProductDetailFieldRules'
    // doc comment) before `data` is used for the changes diff below or for
    // the actual write in runImportApply -- both read off this same `data`
    // object, so mutating it here is what makes the reviewer's choice
    // actually take effect end-to-end instead of only in local UI state.
    applyProductDetailFieldRules(data, match, str(row._field_rules))
    // 'fill_blank' is a job-level mode (see its type comment) and runs
    // after the per-row Details field-rule preset above -- it's the
    // stronger, whole-import policy, so it's authoritative for every
    // field it covers regardless of whatever the per-row preset (if any
    // was even shown for this mode) decided. In practice the frontend
    // doesn't offer the per-row Details dropdown while this job-level
    // mode is active, so there's normally nothing to override.
    if (productImportMode === 'fill_blank') applyFillBlankOnlyMode(data, match)

    // The reviewer's chosen per-row mode, if any -- see ImportRowResult's
    // `plannedMode` comment. Only honored on a row that actually matched
    // an existing product; a row that ends up creating a new product
    // ignores whatever `_action` the CSV carried (merge/override modes
    // are inherently about reconciling with something that already
    // exists) and always takes the ordinary create path below.
    const requestedRowMode = lower(str(row._action))

    // BulkImportModal.tsx's review step lets the reviewer mark an
    // individual row 'skip_row' (IMPORT_DECISION_OPTIONS) without pulling
    // it out of the CSV -- baked into `_action` the same way merge_stock/
    // override_add/override_replace are (see buildCsvForImportJob). This
    // was never actually honored here: 'skip_row' isn't one of the three
    // modes plannedMode below recognizes, so a row marked Skip in the UI
    // fell through to an ordinary update/create and got applied anyway --
    // silently, with no error and no visible sign the reviewer's decision
    // was dropped. Checked and short-circuited before plannedMode/`data`
    // finalize below, same 'skip' RowAction runImportApply's `actionable`
    // filter already excludes writes for elsewhere in this file (e.g. the
    // inventory "already at target quantity" skip a few hundred lines up).
    if (requestedRowMode === 'skip_row') {
      results.push({
        rowNumber: row._rowNumber,
        action: 'skip',
        identifier: sku || barcode || name,
        existingId: match?.id ?? null,
        message: null,
        changes: {},
        data,
      })
      continue
    }

    const plannedMode = match && (requestedRowMode === 'merge_stock' || requestedRowMode === 'override_add' || requestedRowMode === 'override_replace')
      ? (requestedRowMode as 'merge_stock' | 'override_add' | 'override_replace')
      : undefined

    results.push({
      rowNumber: row._rowNumber,
      action: match ? 'update' : 'create',
      identifier: sku || barcode || name,
      existingId: match?.id ?? null,
      message: rowWarnings.length ? rowWarnings.map((w) => w.message).join(' ') : null,
      warnings: rowWarnings.length ? rowWarnings : undefined,
      changes: match ? diffFields(match as unknown as Record<string, unknown>, data) : {},
      data,
      plannedMode,
    })
  }
  return results
}

export async function classifyContacts(db: D1Compat, table: 'customers' | 'suppliers' | 'delivery_contacts', rows: ParsedCsvRow[], policyJson?: string | null): Promise<ImportRowResult[]> {
  // Full rows (not just id/name/phone) so a matched row can be merged
  // field-by-field against what's actually stored, per getContactMergePolicy.
  const existing = await db.prepare(`SELECT * FROM "${table}"`).all<Record<string, unknown> & { id: number; name: string | null; phone: string | null }>()
  const byPhone = new Map<string, Record<string, unknown> & { id: number; name: string | null; phone: string | null }>()
  const byName = new Map<string, Record<string, unknown> & { id: number; name: string | null; phone: string | null }>()
  // Customers only -- membership_number is the account's real identifier
  // (see the auto-generation block below), so a re-import that supplies
  // an existing membership_number should match that specific account even
  // if the name/phone on file has since changed, same as re-importing an
  // existing product by barcode does regardless of a name edit.
  const byMembership = table === 'customers'
    ? new Map<string, Record<string, unknown> & { id: number; name: string | null; phone: string | null }>()
    : null
  for (const record of existing) {
    if (str(record.phone)) byPhone.set(str(record.phone).replace(/\D/g, ''), record)
    if (str(record.name)) byName.set(lower(record.name), record)
    if (byMembership && str((record as { membership_number?: unknown }).membership_number)) {
      byMembership.set(lower(str((record as { membership_number?: unknown }).membership_number)), record)
    }
  }
  const policy = getContactMergePolicy(policyJson)
  // Reviewer overrides -- same decisionsByRowNumber policy_json blob the
  // 'skip' override already reads in runImportApply's post-classify loop,
  // consulted here instead (pre-match) so a 'force_create' override can
  // change *which* branch a row takes, not just skip it after the fact.
  const decisions = getDecisionMap(policyJson)

  // Customers only: "no such thing as no membership id" -- every customer
  // row this import creates, or merges into, ends up with a
  // membership_number, auto-generated when neither the imported row nor
  // the matched existing record has one. Same LCMN-XXXXXXXX shape as
  // routes/contacts.ts's generateMembershipNumber (manual add/edit path),
  // duplicated here rather than shared because that version is async
  // (queries D1 per candidate) and needs `env`, neither of which this
  // synchronous, already-batch-loaded classify pass has reason to add --
  // uniqueness here is checked against the full `existing` snapshot
  // already loaded above, plus every number this same pass has already
  // handed out (so two new customers in the same file, both blank, still
  // can't collide with each other before either one is written).
  const usedMembershipNumbers = table === 'customers'
    ? new Set(existing.map((record) => lower(str((record as { membership_number?: unknown }).membership_number))).filter(Boolean))
    : null
  const nextMembershipNumber = (): string => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${attempt.toString(36)}`.toUpperCase()
      const candidate = `LCMN-${entropy.slice(-8)}`
      if (!usedMembershipNumbers!.has(candidate.toLowerCase())) {
        usedMembershipNumbers!.add(candidate.toLowerCase())
        return candidate
      }
    }
    throw new Error('Could not generate a unique membership number')
  }

  // Same-name-can't-coexist rule applies within one file too, not just
  // against the existing DB: if two rows in the same import both end up
  // as "new contact" with the same name, the second one merges into the
  // first instead of both landing as two contacts sharing a name. Keyed
  // by lower(name) -> index into `results` of the first 'create' row for
  // that name (there's no DB id yet to key on -- the row hasn't been
  // written -- so later duplicates get folded into that pending row's
  // `data` directly instead of pointing at an existingId).
  const pendingCreateByName = new Map<string, number>()

  // Same idea as pendingCreateByName, but for rows that DO match an
  // existing DB record: two rows in this file that both resolve to the
  // same existingId (e.g. one matches by membership_number, another by
  // name; or the same identifier appears twice) used to each become their
  // own separate 'update' result applied sequentially -- not
  // corrupting (last write wins per field, no duplicate contact), but
  // silently inconsistent with how the create-path collision just above
  // is handled. Keyed by existingId -> index into `results` of the first
  // 'update' row for that id, so a later row in the file folds its field
  // changes into that row instead of shipping a second, separate update.
  const pendingUpdateByExistingId = new Map<number, number>()

  const results: ImportRowResult[] = []
  for (const row of rows) {
    const name = str(row.name)
    const phone = str(row.phone)
    if (!name) {
      results.push({ rowNumber: row._rowNumber, action: 'error', identifier: phone || null, existingId: null, message: 'Missing required field: name', changes: {}, data: row })
      continue
    }
    // Match priority for customers: membership_number (the account's real
    // id -- a re-import that supplies it should always find that exact
    // account, even if the name/phone on file has since changed) -> phone
    // -> name. Phone WAS deliberately excluded from customer matching in
    // an earlier revision on the theory that phone isn't unique per
    // customer (shared households etc.) -- superseded: contactDuplicates.ts
    // enforces phone as hard-unique across every contact table already (see
    // findContactDuplicates/findDuplicateContactClusters), and manual
    // add/edit already blocks on it. Excluding phone here just meant CSV
    // import was the one path that could still slip a colliding phone
    // number past that rule. Phone match is restored for customers, same
    // priority position suppliers/delivery contacts already used.
    const membershipRaw = table === 'customers' ? str(row.membership_number) : ''
    const membershipMatch = table === 'customers' && byMembership && membershipRaw ? byMembership.get(lower(membershipRaw)) || null : null
    // For suppliers/delivery contacts, phone IS a real match key (a shared
    // phone reliably means "the same business/driver re-submitted"). For
    // customers it deliberately is NOT a match key -- a shared phone number
    // commonly belongs to two different real people (a household, a family
    // plan), so matching on it here could silently merge two different
    // customers into one record. See customerPhoneMatch below for the
    // narrower thing customers DO get from phone: a review flag, not a
    // silent merge.
    const phoneMatch = table !== 'customers' && phone ? byPhone.get(phone.replace(/\D/g, '')) || null : null
    // Phone is still a hard-unique identifier for the app as a whole -- see
    // lib/contactDuplicates.ts's findContactDuplicates/
    // findDuplicateContactClusters, which block on a colliding phone for
    // the manual add/edit path and surface it in the Duplicates review
    // panel. CSV import used to have no equivalent check at all for
    // customers -- a phone already on file could import onto (or as) a
    // second customer with zero warning, the one path that could slip a
    // colliding number past that rule. Fixed here as a REVIEW FLAG only
    // (never auto-merges/auto-blocks, unlike phoneMatch above) so the
    // household-sharing case above still isn't broken by it -- just made
    // visible when it happens.
    const customerPhoneMatch = table === 'customers' && phone ? byPhone.get(phone.replace(/\D/g, '')) || null : null
    const rawNameMatch = !membershipMatch && !phoneMatch ? byName.get(lower(name)) || null : null
    // A name match is this app's best guess, not a real identifier the way
    // phone (suppliers/delivery contacts) or membership_number (customers)
    // is -- the reviewer can override it with a 'force_create' decision on
    // this row if two genuinely different people happen to share a name,
    // rather than this import silently merging them. Never overridable for
    // a membership/phone match, which identify one specific real account.
    const forceCreate = decisions[String(row._rowNumber)]?.action === 'force_create'
    const nameMatch = forceCreate ? null : rawNameMatch
    const match = membershipMatch || phoneMatch || nameMatch
    // membership_number is the strongest identifier for a customer (see
    // the match-priority comment above), so an explicit number on the row
    // always wins the match itself -- there's no way for this row to
    // resolve to some *other* record while also carrying a number that
    // belongs to a third existing customer; whichever record that number
    // belongs to simply becomes `match`. What CAN still happen is a typo'd
    // or copy-pasted membership_number that happens to belong to a real
    // account, silently redirecting this row's data onto the wrong
    // person. Defense-in-depth for that: if the match came from
    // membership_number and the row's own imported name doesn't resemble
    // the matched record's name at all, flag it -- not blocked, since a
    // legitimate name change is common (marriage, correction), but
    // surfaced so a reviewer can catch the "this really is someone else's
    // number" case before it merges in silently.
    const membershipNameMismatch = !!(membershipMatch && name && str(membershipMatch.name) && lower(name) !== lower(str(membershipMatch.name)))
    // True whenever this row's phone belongs to a customer OTHER than the
    // one this row itself resolved to (whichever match, if any, `match`
    // below ends up being -- including no match at all, i.e. a plain
    // 'create'). Covers both defense-in-depth cases in one flag: a
    // membership_number match whose phone actually belongs to someone else
    // (likely a typo'd/copy-pasted number), and a brand-new/name-matched
    // row whose phone was already on file under a different customer.
    const customerPhoneConflict = !!(
      table === 'customers' && customerPhoneMatch && Number(customerPhoneMatch.id) !== Number(membershipMatch?.id ?? rawNameMatch?.id ?? NaN)
    )
    // Contact Options (up to 3 extra name/phone/email/address-or-area
    // entries per contact -- see contactOptions.ts) come from either the
    // legacy indexed contact_label_1../contact_address_1.. CSV columns or a
    // single contact_options JSON cell matching serializeContactOptions()'s
    // own output. Falls back to the plain phone/email/address(/area)
    // columns when a row has neither, so existing CSVs import unchanged.
    const contactMode = table === 'delivery_contacts' ? 'area' : 'address'
    const contactState = buildImportedContactState(row, contactMode)
    const data: Record<string, unknown> = {
      name,
      phone: contactState.primary.phone || phone || null,
      address: contactState.serialized || str(row.address) || null,
      notes: str(row.notes) || null,
    }
    // Historical join/creation date -- see the Created/created_date/
    // created_at CSV column this reads from and the generic contacts
    // INSERT in runImportApply for why this only matters on a genuinely
    // new row (a matched/merged contact's existing created_at is never
    // touched by import). `created_date` is the column every contact
    // template now ships (plain-English header for CSVs coming from other
    // systems); `created_at`/`created`/`join_date`/`date_joined` stay
    // accepted too so existing hand-built CSVs aren't broken by the
    // rename. Same inline parse-and-validate pattern classifySales already
    // uses for its own `sale_date` column -- an unparseable/blank cell
    // just leaves this null, which falls back to "now" at write time
    // exactly like before this column existed, rather than failing the
    // row. Applies uniformly to customers/suppliers/delivery_contacts --
    // previously this was customers-only, silently dropping a supplier's
    // or delivery contact's own imported creation date even though the
    // generic INSERT already knew how to honor `d.created_at` for all
    // three tables.
    data.created_at = (() => {
      const raw = str(row.created_date) || str(row.created_at) || str(row.created) || str(row.join_date) || str(row.date_joined)
      if (!raw) return null
      const parsed = new Date(raw)
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    })()
    if (table === 'customers') {
      data.email = contactState.primary.email || str(row.email) || null
      data.membership_number = str(row.membership_number) || null
      data.gender = normalizeContactGender(row.gender)
      // New customer, no membership_number on the row -- assign one now
      // rather than leaving it null. Matched/merged customers are handled
      // further down, once we know whether the existing record already
      // has one (that always wins over generating a new one).
      if (!match && !str(data.membership_number)) data.membership_number = nextMembershipNumber()
    } else if (table === 'suppliers') {
      data.email = contactState.primary.email || str(row.email) || null
      data.company = str(row.company) || null
      data.contact_person = contactState.primary.name || str(row.contact_person) || null
      // Gender parity with customers (migration 0022) -- same normalizer,
      // same optional/single-value shape.
      data.gender = normalizeContactGender(row.gender)
    } else {
      data.area = contactState.primary.area || str(row.area) || null
      data.gender = normalizeContactGender(row.gender)
    }
    if (match) {
      // A name-only match (no phone match) means this row and the
      // existing record agree on name but nothing else was used to find
      // it -- surfaced as a warning either way (skip or merge) so the
      // person reviewing knows *why* this became an update instead of a
      // new row: same name already exists, and this app never creates a
      // second contact sharing an existing one's name (merges into it
      // instead, same as a phone match always has).
      const matchWarnings: ImportRowWarning[] = nameMatch
        ? [{ kind: 'name_match', message: `"${name}" already exists (id ${match.id}) -- merging into that record instead of creating a duplicate.` }]
        : []
      if (membershipNameMismatch) {
        matchWarnings.push({ kind: 'membership_mismatch', message: `Membership number "${membershipRaw}" belongs to "${match.name}" on file, but this row's name is "${name}" -- double-check this is the same person before applying.` })
      }
      if (customerPhoneConflict) {
        matchWarnings.push({ kind: 'membership_phone_conflict', message: `Phone "${phone}" already belongs to a different customer, "${customerPhoneMatch!.name}" (id ${customerPhoneMatch!.id}), not "${match.name}" (id ${match.id}) that this row matched -- double-check before applying, this row's phone will not be applied to the wrong account.` })
      }
      if (policy.conflictMode === 'skip') {
        results.push({
          rowNumber: row._rowNumber,
          action: 'skip',
          identifier: phone || name,
          existingId: match.id,
          message: matchWarnings[0]?.message || null,
          warnings: matchWarnings,
          changes: {},
          data,
        })
        continue
      }
      const defaultRule: ContactFieldRule = policy.conflictMode === 'overwrite' ? 'use_imported' : 'merge_blank_only'
      const merged: Record<string, unknown> = {}
      for (const key of Object.keys(data)) {
        merged[key] = resolveContactFieldValue(match[key], data[key], policy.fieldRules[key], defaultRule)
      }
      // name is required regardless of rule -- fall back to whichever side has it.
      if (!str(merged.name)) merged.name = data.name || match.name
      // customerPhoneConflict means this row's phone provably belongs to a
      // DIFFERENT existing customer than the one this row matched -- never
      // write it onto `match` regardless of conflictMode/fieldRules, or
      // import would either create a second customer sharing that phone (a
      // hard-unique field) or silently steal the number from its real
      // owner. The row's other fields still apply normally; only `phone`
      // is pinned to whatever `match` already has, and the warning above
      // tells the reviewer why.
      if (customerPhoneConflict) merged.phone = match.phone ?? null
      // Deliberately NOT auto-assigned on the merge path (only on true
      // creation, just above) -- a matched existing customer keeps
      // whatever membership_number it already had, blank or not; this
      // import never invents one for a record it didn't create. Backfilling
      // every legacy blank on its next unrelated import touch was the
      // original design here but is a separate decision (bulk-assign
      // numbers to existing blank customers) from "does creating a new
      // customer need one", which is the only thing this import is for.

      // A second (or third...) row in this same file that also resolves
      // to this same existingId used to become its own independent
      // 'update' result, applied sequentially against the DB -- not
      // corrupting, but inconsistent with how two brand-new rows sharing
      // a name already fold together above. Fold here too: later rows
      // merge their fields into the first pending update for this id
      // (using the same conflictMode/fieldRules resolution, treating the
      // pending row's current value as "existing") instead of shipping a
      // second update for the same record.
      const pendingUpdateIndex = pendingUpdateByExistingId.get(match.id)
      if (pendingUpdateIndex != null) {
        const pending = results[pendingUpdateIndex]
        const pendingData = pending.data as Record<string, unknown>
        for (const key of Object.keys(data)) {
          pendingData[key] = resolveContactFieldValue(pendingData[key], data[key], policy.fieldRules[key], defaultRule)
        }
        if (!str(pendingData.name)) pendingData.name = data.name || match.name
        pending.changes = diffFields(match as unknown as Record<string, unknown>, pendingData)
        const dupWarning: ImportRowWarning = { kind: 'duplicate_row_match', message: `Also matched "${match.name}" (id ${match.id}), already being updated earlier in this file (row ${pending.rowNumber}) -- merged into that row instead of applying separately.` }
        pending.warnings = [...(pending.warnings || []), dupWarning]
        results.push({
          rowNumber: row._rowNumber,
          action: 'skip',
          identifier: phone || name,
          existingId: match.id,
          message: dupWarning.message,
          warnings: [dupWarning],
          changes: {},
          data,
        })
        continue
      }
      pendingUpdateByExistingId.set(match.id, results.length)
      results.push({
        rowNumber: row._rowNumber,
        action: 'update',
        identifier: phone || name,
        existingId: match.id,
        message: matchWarnings[0]?.message || null,
        warnings: matchWarnings,
        changes: diffFields(match as unknown as Record<string, unknown>, merged),
        data: merged,
      })
      continue
    }
    // No DB match, but does this name collide with an earlier new row
    // from this same file? Fold into that pending row rather than
    // queuing up a second contact with the same name -- unless this row's
    // own 'force_create' override says these are genuinely two different
    // people who happen to share a name (same override as the DB-match
    // case above).
    const pendingIndex = forceCreate ? null : pendingCreateByName.get(lower(name))
    if (pendingIndex != null) {
      const pending = results[pendingIndex]
      const pendingData = pending.data as Record<string, unknown>
      // merge_blank_only-style fold: only fills fields the pending row
      // doesn't already have a value for, same rule as a real DB merge --
      // the earlier row in the file wins on anything both rows set.
      for (const key of Object.keys(data)) {
        if (!str(pendingData[key]) && str((data as Record<string, unknown>)[key])) pendingData[key] = (data as Record<string, unknown>)[key]
      }
      results.push({
        rowNumber: row._rowNumber,
        action: 'skip',
        identifier: phone || name,
        existingId: null,
        message: `"${name}" is already being created earlier in this file (row ${pending.rowNumber}) -- merged into that row instead of creating a duplicate.`,
        warnings: [{ kind: 'name_match', message: `"${name}" already appears earlier in this file (row ${pending.rowNumber}) -- merging into that row instead of creating a duplicate.` }],
        changes: {},
        data,
      })
      continue
    }
    // Note when 'force_create' actually changed the outcome (there really
    // was a same-name match/collision this row bypassed) -- kept as a
    // (non-serious) warning purely for the applied-results audit trail, not
    // to re-prompt review of something the reviewer just explicitly decided.
    const forcedNote: ImportRowWarning[] = forceCreate && (rawNameMatch || pendingCreateByName.has(lower(name)))
      ? [{ kind: 'other', message: `Created as a separate contact from "${name}" on file/record, per reviewer override.` }]
      : []
    // Brand-new customer whose phone is already on file under a different
    // customer -- not blocked (could be a legitimate shared household
    // number), but flagged so a reviewer notices instead of it silently
    // creating what might really be a duplicate account.
    const createPhoneConflictNote: ImportRowWarning[] = customerPhoneConflict
      ? [{ kind: 'membership_phone_conflict', message: `Phone "${phone}" already belongs to an existing customer, "${customerPhoneMatch!.name}" (id ${customerPhoneMatch!.id}) -- this row is still being created as a new, separate customer. Double-check this isn't the same person before applying.` }]
      : []
    const createWarnings = [...forcedNote, ...createPhoneConflictNote]
    if (!forceCreate) pendingCreateByName.set(lower(name), results.length)
    results.push({
      rowNumber: row._rowNumber,
      action: 'create',
      identifier: phone || name,
      existingId: null,
      message: createWarnings[0]?.message || null,
      warnings: createWarnings,
      changes: {},
      data,
    })
  }
  return results
}

// One template/job per action, instead of a single combined template with
// a free-text 'action' column mixing add/remove/set row-to-row (easy to
// mistype, easy to end up with an unintended mix). `null` is the legacy
// path: an older combined-template CSV, or a raw API call that doesn't set
// this -- classifyInventory falls back to reading row.movement_type /
// quantity sign per row exactly as it always did, so nothing already
// integrated against the old shape breaks.
export type InventoryImportAction = 'add' | 'remove' | 'set'

export function getInventoryImportAction(policyJson: string | null | undefined): InventoryImportAction | null {
  try {
    const policy = policyJson ? JSON.parse(policyJson) : {}
    return (['add', 'remove', 'set'] as string[]).includes(policy?.inventory_action) ? (policy.inventory_action as InventoryImportAction) : null
  } catch (_) {
    return null
  }
}

async function classifyInventory(db: D1Compat, rows: ParsedCsvRow[], inventoryAction?: InventoryImportAction | null): Promise<ImportRowResult[]> {
  const products = await db
    .prepare(`SELECT id, sku, barcode, name, stock_quantity, cost_price_usd, cost_price_khr FROM products`)
    .all<{ id: number; sku: string | null; barcode: string | null; name: string | null; stock_quantity: number; cost_price_usd: number | null; cost_price_khr: number | null }>()
  const branches = await db.prepare(`SELECT id, name FROM branches`).all<{ id: number; name: string }>()
  const bySku = new Map<string, (typeof products)[number]>()
  const byBarcode = new Map<string, (typeof products)[number]>()
  for (const product of products) {
    if (str(product.sku)) bySku.set(lower(product.sku), product)
    if (str(product.barcode)) byBarcode.set(lower(product.barcode), product)
  }
  const branchByName = new Map<string, number>()
  for (const branch of branches) branchByName.set(lower(branch.name), branch.id)

  const results: ImportRowResult[] = []
  for (const row of rows) {
    const sku = str(row.sku || row.product_sku)
    const barcode = str(row.barcode)
    const product = (sku && bySku.get(lower(sku))) || (barcode && byBarcode.get(lower(barcode))) || null
    if (!product) {
      results.push({ rowNumber: row._rowNumber, action: 'error', identifier: sku || barcode || null, existingId: null, message: 'Product not found for sku/barcode', changes: {}, data: row })
      continue
    }
    // 'add'/'remove' templates always carry a plain positive quantity (how
    // much came in / how much to take out) -- the sign is implied by which
    // template this is, not typed into the cell, so it's parsed
    // non-negative here rather than trusting a +/- a person might type.
    // 'set' carries a target absolute count. The legacy (null-action) path
    // is unchanged: signed quantity, sign or movement_type decides
    // in/out.
    const requireNonNegative = inventoryAction === 'add' || inventoryAction === 'remove' || inventoryAction === 'set'
    let quantity: number
    try {
      quantity = parseImportNumericValue(row.quantity, 0, { allowNegative: !requireNonNegative, field: 'quantity', strict: true })
    } catch (error) {
      results.push({ rowNumber: row._rowNumber, action: 'error', identifier: sku || barcode, existingId: product.id, message: (error as Error).message, changes: {}, data: row })
      continue
    }
    if (requireNonNegative && quantity < 0) {
      results.push({ rowNumber: row._rowNumber, action: 'error', identifier: sku || barcode, existingId: product.id, message: `Quantity must not be negative for a${inventoryAction === 'add' ? 'n' : ''} "${inventoryAction}" import -- use a positive number.`, changes: {}, data: row })
      continue
    }

    let movementType: string
    let signedQuantity: number
    if (inventoryAction === 'add') {
      movementType = 'in'
      signedQuantity = quantity
    } else if (inventoryAction === 'remove') {
      movementType = 'out'
      signedQuantity = -quantity
    } else if (inventoryAction === 'set') {
      // Target absolute count, not a delta -- the movement is whatever
      // gets the product from its current stock_quantity to this number.
      signedQuantity = quantity - (product.stock_quantity || 0)
      movementType = signedQuantity >= 0 ? 'in' : 'out'
      if (signedQuantity === 0) {
        results.push({ rowNumber: row._rowNumber, action: 'skip', identifier: sku || barcode, existingId: product.id, message: `Already at ${quantity} -- no movement needed.`, changes: {}, data: row })
        continue
      }
    } else {
      // Legacy combined-template path, unchanged.
      if (quantity === 0) {
        results.push({ rowNumber: row._rowNumber, action: 'error', identifier: sku || barcode, existingId: product.id, message: 'Quantity must be non-zero', changes: {}, data: row })
        continue
      }
      movementType = lower(row.movement_type) || (quantity >= 0 ? 'in' : 'out')
      signedQuantity = quantity
    }

    const branchName = str(row.branch_name || row.branch)
    const matchedBranchId = branchName ? branchByName.get(lower(branchName)) ?? null : null
    // Same three-case rule as classifyProducts above: a named branch that
    // doesn't exist yet gets created at apply time (branch_id null +
    // branch_name_pending set) rather than the movement silently landing
    // with no branch at all, which is what happened before -- a typo'd or
    // new branch name in the CSV used to just disappear from the record.
    // Optional per-row date -- same inline parse-and-validate pattern as
    // classifyContacts' `created_at` and classifySales' `sale_date`: an
    // unparseable or blank cell just leaves this null, which
    // materializeImportChunk below falls back to "now" for, exactly like
    // before this column existed. Lets a bulk stock-receiving file
    // backdate movements (e.g. "this was actually received last
    // Tuesday") instead of every imported movement silently landing at
    // today/now regardless of what the file says.
    const movementDate = (() => {
      const raw = str(row.date || row.received_date)
      if (!raw) return null
      const parsed = new Date(raw)
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    })()
    const data: Record<string, unknown> = {
      product_id: product.id,
      product_name: product.name,
      branch_id: matchedBranchId,
      branch_name: matchedBranchId ? branchName : null,
      movement_type: movementType,
      quantity: Math.abs(signedQuantity),
      signedQuantity,
      reason: str(row.reason) || 'import',
      created_at: movementDate,
    }
    if (branchName && matchedBranchId == null) {
      data.branch_name_pending = branchName
    }
    // 'add' only: an optional unit cost on the row updates the product's
    // cost price, same as receiving stock at a manual product edit
    // would -- blank cells leave the existing price untouched. 'remove'/
    // 'set' templates don't carry a cost column at all (removing or
    // recounting stock doesn't change what it's worth), so this never
    // fires for them regardless of what a raw API caller might send.
    if (inventoryAction === 'add') {
      const costUsd = row.unit_cost_usd != null && str(row.unit_cost_usd) !== '' ? normalizeImportMoney(row.unit_cost_usd) : null
      const costKhr = row.unit_cost_khr != null && str(row.unit_cost_khr) !== '' ? normalizeImportMoney(row.unit_cost_khr) : null
      if (costUsd != null) data.cost_price_usd = costUsd
      if (costKhr != null) data.cost_price_khr = costKhr
    }
    results.push({
      rowNumber: row._rowNumber,
      action: 'create',
      identifier: sku || barcode,
      existingId: product.id,
      message: null,
      changes: {},
      data,
    })
  }
  return results
}

// Groups CSV rows into orders. If an `order_reference` column is present,
// rows sharing the same reference become one sale with N line items;
// otherwise every row is its own single-line sale. New design (see file
// header) -- not a port of an existing grouping algorithm.
// Extracted so chunked callers (runImportAnalyze/runImportApply) can find
// GROUP boundaries -- which rows go together, and how many groups exist --
// over the FULL file before deciding a chunk window, without duplicating
// this partition logic. A group's rows must always classify together (an
// order's line items can't be split across two chunk windows), so sales
// chunking windows by whole GROUPS, not raw rows -- see how this is used
// below. Map iteration order is insertion order, so calling this twice
// against the identical rows array (same CSV, same decisions) always
// yields the same group order -- safe to call fresh per chunk rather than
// needing to cache it, unlike the image-match computation below.
function partitionSalesGroups(rows: ParsedCsvRow[]): Map<string, ParsedCsvRow[]> {
  const groups = new Map<string, ParsedCsvRow[]>()
  let lastExplicitKey = ''
  for (const row of rows) {
    // receipt_number is the real column on the sales-template.csv (see
    // downloadImportTemplate in frontend/src/api/methods.ts); order_reference
    // never shipped on any template but is kept as a fallback key so a
    // hand-built or externally-generated CSV using that name still groups
    // its line items into one order instead of each becoming its own
    // single-line sale.
    const explicitKey = str(row.receipt_number || row.order_reference)
    if (explicitKey) lastExplicitKey = explicitKey
    const key = explicitKey || str(row._sales_group_key) || lastExplicitKey || `__row_${row._rowNumber}`
    const list = groups.get(key) || []
    list.push(row)
    groups.set(key, list)
  }
  return groups
}

// Sales import records HISTORY, not live checkout activity -- these rows
// already happened, in whatever stock state the business was actually in
// at the time. Unlike POST /api/sales (routes/sales.ts), which deducts
// stock for a fresh 'completed'/'awaiting_delivery' sale because the sale
// is the event that removes the item from the shelf, an imported row of
// either status is not that event -- the item left the shelf whenever the
// real-world sale happened, long before this file was ever generated. If
// this also deducted stock, an import of last quarter's sales history
// against today's real stock counts would double-subtract everything
// that's already reflected in today's numbers.
//
// The one exception is a row already sitting in a RETURN_STATUSES status
// (see lib/salesStatus.ts's own comment on this): a return is stock
// physically coming BACK, and unlike a completed sale, nothing else in
// today's stock count already accounts for that unless this import adds
// it -- so this is the one case sales import does touch stock, and only
// for the quantity the row says actually came back (see returned_quantity
// below), never the full sold quantity by default for 'partial_return'.
// Matches routes/sales.ts's own round2 exactly (plain round-to-nearest-cent)
// -- deliberately NOT normalizeImportMoney's roundUpToDecimals, which is the
// right convention for a raw CSV-input value but would systematically bias
// a *computed* total/change figure upward on every fractional cent, unlike
// what a manual checkout actually records.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Historical spreadsheet timestamps are business wall-clock values. The
// app's canonical business timezone is Asia/Phnom_Penh (UTC+07, no DST),
// so a compact `2026-08-28 14:30` cell must render back as 14:30 rather
// than being interpreted differently by whichever Worker/runtime parses
// it. Explicit ISO offsets/Z remain authoritative. Date-only and US-style
// spreadsheet dates are accepted too; every component is range checked so
// JavaScript's silent rollover (2026-02-31 -> March) cannot corrupt books.
export function parseSalesImportDateTime(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null

  const explicitZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i
  if (explicitZone.test(raw)) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    throw new Error(`Invalid sale_date "${raw}". Use YYYY-MM-DD HH:mm (24-hour time) or ISO 8601 with a timezone.`)
  }

  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
    || raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) throw new Error(`Invalid sale_date "${raw}". Use YYYY-MM-DD HH:mm (24-hour time) or ISO 8601 with a timezone.`)

  const isoFirst = /^\d{4}-/.test(raw)
  const year = Number(isoFirst ? match[1] : match[3])
  const month = Number(isoFirst ? match[2] : match[1])
  const day = Number(isoFirst ? match[3] : match[2])
  const hour = Number(match[4] || 0)
  const minute = Number(match[5] || 0)
  const second = Number(match[6] || 0)
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0
  if (year < 1000 || year > 9999 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid sale_date "${raw}". Use a real date and 24-hour time from 00:00 to 23:59.`)
  }
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second)).toISOString()
}

export async function classifySales(db: D1Compat, rows: ParsedCsvRow[]): Promise<ImportRowResult[]> {
  const products = await db
    .prepare(`SELECT id, sku, barcode, name, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr FROM products`)
    .all<{ id: number; sku: string | null; barcode: string | null; name: string | null; selling_price_usd: number; selling_price_khr: number; cost_price_usd: number | null; cost_price_khr: number | null }>()
  const bySku = new Map<string, (typeof products)[number]>()
  const byBarcode = new Map<string, (typeof products)[number]>()
  const byName = new Map<string, (typeof products)[number] | null>()
  for (const product of products) {
    if (str(product.sku)) bySku.set(lower(product.sku), product)
    if (str(product.barcode)) byBarcode.set(lower(product.barcode), product)
    const nameKey = lower(product.name)
    if (nameKey) byName.set(nameKey, byName.has(nameKey) ? null : product)
  }

  const branches = await db.prepare(`SELECT id, name FROM branches`).all<{ id: number; name: string }>()
  const branchByName = new Map<string, number>()
  for (const branch of branches) branchByName.set(lower(branch.name), branch.id)

  // Track F parity: routes/sales.ts POST / (manual checkout) resolves and
  // stores a real customer_id whenever the cashier picked a customer at
  // checkout -- portal.ts's membership lookup (GET /membership/:number),
  // contacts.ts's per-customer sales/points history, and notifications.ts's
  // top-customer aggregation all key strictly off sales.customer_id with no
  // name-based fallback (only the portal's own order-history query has an
  // OR'd customer_name+phone fallback for rows with no customer_id). Without
  // this, an imported sale whose customer_name/phone match a real customer
  // would still record correctly as free text but silently never show up in
  // that customer's purchase history/points total anywhere else in the app.
  // No membership_number column exists on the sales import template (unlike
  // classifyContacts' own customer matching), so this matches the same two
  // signals classifyContacts already treats as identifying -- phone first
  // (more precise/unique), name only as a fallback -- and, same as
  // classifyContacts' byPhone/byName maps, only ever MATCHES an existing
  // customer, never creates one (a sales-history file isn't a customer
  // import; an unmatched name/phone just stays free text, same as today).
  const customers = await db.prepare(`SELECT id, name, phone FROM customers`).all<{ id: number; name: string | null; phone: string | null }>()
  const customerByPhone = new Map<string, number>()
  const customerByName = new Map<string, number | null>() // null = ambiguous (>1 customer shares this name)
  for (const customer of customers) {
    const phoneDigits = str(customer.phone).replace(/\D/g, '')
    if (phoneDigits) customerByPhone.set(phoneDigits, customer.id)
    const nameKey = lower(customer.name)
    if (nameKey) customerByName.set(nameKey, customerByName.has(nameKey) ? null : customer.id)
  }

  // Track F parity, part 70: the same gap existed for `cashier_id` and
  // `delivery_contact_id` -- both real FK columns a manual checkout
  // resolves and stores, neither ever read by classifySales even though
  // `cashier_name` was already a template column. Users have no phone
  // column worth matching on here (unlike customers), so this is name-only
  // -- same ambiguous-name-means-no-match rule as customers above, not a
  // guess. Only active users are eligible; a cashier account that's since
  // been deactivated shouldn't silently reattach historical sales to it.
  const cashiers = await db.prepare(`SELECT id, name FROM users WHERE is_active = 1`).all<{ id: number; name: string | null }>()
  const cashierByName = new Map<string, number | null>()
  for (const cashierRow of cashiers) {
    const nameKey = lower(cashierRow.name)
    if (nameKey) cashierByName.set(nameKey, cashierByName.has(nameKey) ? null : cashierRow.id)
  }

  // delivery_contacts matching mirrors customers exactly (phone first, name
  // fallback, ambiguous name -> no match, match-only/never-create) -- same
  // reasoning as the customer block above, just a different table.
  const deliveryContacts = await db.prepare(`SELECT id, name, phone FROM delivery_contacts`).all<{ id: number; name: string | null; phone: string | null }>()
  const deliveryContactByPhone = new Map<string, number>()
  const deliveryContactByName = new Map<string, number | null>()
  for (const contact of deliveryContacts) {
    const phoneDigits = str(contact.phone).replace(/\D/g, '')
    if (phoneDigits) deliveryContactByPhone.set(phoneDigits, contact.id)
    const nameKey = lower(contact.name)
    if (nameKey) deliveryContactByName.set(nameKey, deliveryContactByName.has(nameKey) ? null : contact.id)
  }

  // Existing, active batches/lots only -- an optional `batch_label` column
  // on a sales row MATCHES an existing product_batches row (by product +
  // normalized lot code), it never creates one. Inventing a lot from a
  // sales-history file would be backwards: batches are receiving records
  // (lib/productBatches.ts's receiveBatchStock), and a sale/return can only
  // ever reference stock that was actually received under a real lot at
  // some point. An unmatched label just means this line's restock (if any)
  // lands at the plain branch level instead of a specific batch -- same as
  // any row with no batch_label at all -- not an error.
  const batches = await db
    .prepare(`SELECT id, variant_product_id, lot_code, expiry_date FROM product_batches WHERE is_active = 1`)
    .all<{ id: number; variant_product_id: number; lot_code: string | null; expiry_date: string | null }>()
  const batchByProductAndLot = new Map<string, { id: number; expiry_date: string | null }>()
  for (const batch of batches) {
    if (!str(batch.lot_code)) continue
    batchByProductAndLot.set(`${batch.variant_product_id}\u0001${lower(batch.lot_code)}`, { id: batch.id, expiry_date: batch.expiry_date })
  }

  // `rows` may be the whole file (loadAndClassify's bounded/synchronous
  // callers) or a chunk window containing only whole groups (the chunked
  // callers below) -- partitioning a subset that already respects group
  // boundaries gives the identical result as partitioning the full file
  // and discarding groups outside the window, just cheaper.
  const groups = partitionSalesGroups(rows)

  const results: ImportRowResult[] = []
  for (const [, groupRows] of groups) {
    const first = groupRows[0]
    const identifier = str(first.receipt_number || first.order_reference) || `row ${first._rowNumber}`
    if (groupRows.length > MAX_HISTORICAL_SALE_LINES) {
      results.push({
        rowNumber: first._rowNumber,
        action: 'error',
        identifier,
        existingId: null,
        message: `Sale exceeds the ${MAX_HISTORICAL_SALE_LINES}-line Free-plan safety limit; split it into smaller receipts.`,
        changes: {},
        data: first,
      })
      continue
    }

    // Every line in one order shares one status -- a historical CSV row has
    // no mechanism to say "half this order's lines are still completed and
    // half already came back" (that's what per-item returned_quantity,
    // below, is for), so an inconsistent sale_status across lines sharing
    // one receipt_number would just be an ambiguous input, not a real
    // WYSIWYG case -- only `first`'s value is read.
    const rawStatus = str(first.sale_status)
    const saleStatus = rawStatus ? normalizeSaleStatus(rawStatus) : 'completed'
    if (rawStatus && !saleStatus) {
      results.push({ rowNumber: first._rowNumber, action: 'error', identifier, existingId: null, message: `Invalid sale_status "${rawStatus}". Must be one of: ${VALID_SALE_STATUSES.join(', ')}`, changes: {}, data: first })
      continue
    }
    const status = saleStatus || 'completed'
    const isReturnGroup = RETURN_STATUSES.has(status)

    let createdAt: string | null = null
    try {
      createdAt = parseSalesImportDateTime(first.sale_date)
    } catch (err) {
      results.push({ rowNumber: first._rowNumber, action: 'error', identifier, existingId: null, message: (err as Error).message, changes: {}, data: first })
      continue
    }

    const branchName = str(first.branch || first.branch_name)
    const matchedBranchId = branchName ? branchByName.get(lower(branchName)) ?? null : null

    // Phone first (more precise/unique -- and cheap to get right, unlike a
    // shared name), name only as a fallback; an ambiguous name (>1 customer
    // shares it, see the `null` case above) intentionally resolves to no
    // match rather than guessing -- same as leaving it unmatched today.
    const rowCustomerPhoneDigits = str(first.customer_phone).replace(/\D/g, '')
    const rowCustomerNameKey = lower(first.customer_name)
    const matchedCustomerId = (rowCustomerPhoneDigits && customerByPhone.get(rowCustomerPhoneDigits))
      || (rowCustomerNameKey && customerByName.get(rowCustomerNameKey))
      || null

    // Name-only match against active users -- see the cashierByName build
    // above for why there's no phone fallback here.
    const matchedCashierId = cashierByName.get(lower(first.cashier_name)) || null

    // Only resolved/relevant when the row actually says this was a
    // delivery -- an is_delivery-less/falsy row leaves every delivery_*
    // column at its schema default, same as a normal in-store manual sale.
    const rowIsDelivery = toBool01(first.is_delivery, 0) === 1
    const rowDeliveryPhoneDigits = str(first.delivery_contact_phone).replace(/\D/g, '')
    const rowDeliveryNameKey = lower(first.delivery_contact_name)
    const matchedDeliveryContactId = rowIsDelivery
      ? ((rowDeliveryPhoneDigits && deliveryContactByPhone.get(rowDeliveryPhoneDigits))
        || (rowDeliveryNameKey && deliveryContactByName.get(rowDeliveryNameKey))
        || null)
      : null

    const items: Record<string, unknown>[] = []
    let error: string | null = null
    for (const row of groupRows) {
      const sku = str(row.sku || row.product_sku)
      const barcode = str(row.barcode)
      const productName = str(row.name || row.product_name)
      const product = (sku && bySku.get(lower(sku))) || (barcode && byBarcode.get(lower(barcode))) || (productName && byName.get(lower(productName))) || null
      if (!product) {
        error = `Product not found for sku/barcode/name "${sku || barcode || productName}"`
        break
      }
      let quantity: number
      try {
        quantity = parseImportNumericValue(row.quantity, 1, { allowNegative: false, field: 'quantity', strict: true })
      } catch (err) {
        error = (err as Error).message
        break
      }
      if (quantity <= 0) {
        error = `Sale item quantity must be positive for sku/barcode "${sku || barcode}"`
        break
      }

      // Only meaningful (and only ever non-zero) on a returned/partial_return
      // group -- see the header comment. Defaults to the full sold quantity
      // for 'returned' (the whole line came back, the common case for that
      // status), but is NOT defaulted for 'partial_return' -- that status
      // means "some, not necessarily all" by definition, so a blank cell
      // there is treated as "this specific line wasn't part of what came
      // back" (0) rather than guessed at, and the row still imports (as a
      // sales record) with a warning rather than being blocked.
      let returnedQuantity = 0
      if (isReturnGroup) {
        const hasExplicitValue = row.returned_quantity != null && str(row.returned_quantity) !== ''
        if (hasExplicitValue) {
          try {
            returnedQuantity = parseImportNumericValue(row.returned_quantity, 0, { allowNegative: false, field: 'returned quantity', strict: true })
          } catch (err) {
            error = (err as Error).message
            break
          }
        } else if (status === 'returned') {
          returnedQuantity = quantity
        }
        if (returnedQuantity > quantity) {
          error = `Returned quantity (${returnedQuantity}) exceeds sold quantity (${quantity}) for sku/barcode "${sku || barcode}"`
          break
        }
      }

      const priceUsd = row.unit_price_usd != null && str(row.unit_price_usd) !== '' ? normalizeImportMoney(row.unit_price_usd) : product.selling_price_usd
      const priceKhr = row.unit_price_khr != null && str(row.unit_price_khr) !== '' ? normalizeImportMoney(row.unit_price_khr) : product.selling_price_khr
      let costPriceUsd = product.cost_price_usd || 0
      let costPriceKhr = product.cost_price_khr || 0
      let basePriceUsd = priceUsd
      let basePriceKhr = priceKhr
      let productDiscountUsd = 0
      let productDiscountKhr = 0
      let manualDiscountValue = 0
      let manualDiscountUsd = 0
      let manualDiscountKhr = 0
      try {
        const optionalMoney = (raw: unknown, fallback: number, field: string): number => {
          if (raw == null || str(raw) === '') return fallback
          return normalizeImportMoney(parseImportNumericValue(raw, fallback, { allowNegative: false, field, strict: true }))
        }
        costPriceUsd = optionalMoney(row.cost_price_usd, costPriceUsd, 'cost_price_usd')
        costPriceKhr = optionalMoney(row.cost_price_khr, costPriceKhr, 'cost_price_khr')
        basePriceUsd = optionalMoney(row.base_price_usd, basePriceUsd, 'base_price_usd')
        basePriceKhr = optionalMoney(row.base_price_khr, basePriceKhr, 'base_price_khr')
        productDiscountUsd = optionalMoney(row.product_discount_usd, 0, 'product_discount_usd')
        productDiscountKhr = optionalMoney(row.product_discount_khr, 0, 'product_discount_khr')
        manualDiscountValue = optionalMoney(row.manual_discount_value, 0, 'manual_discount_value')
        manualDiscountUsd = optionalMoney(row.manual_discount_usd, 0, 'manual_discount_usd')
        manualDiscountKhr = optionalMoney(row.manual_discount_khr, 0, 'manual_discount_khr')
      } catch (err) {
        error = (err as Error).message
        break
      }

      const batchLabel = str(row.batch_label || row.lot_code)
      const batchMatch = batchLabel ? batchByProductAndLot.get(`${product.id}\u0001${lower(batchLabel)}`) : null

      items.push({
        product_id: product.id, product_name: product.name, sku: product.sku,
        quantity, returned_quantity: returnedQuantity,
        applied_price_usd: priceUsd, applied_price_khr: priceKhr,
        total_usd: normalizeImportMoney(priceUsd * quantity), total_khr: Math.round(priceKhr * quantity),
        // Cost price at time of "sale" -- salesAnalytics.ts's COGS/profit
        // queries (getSalesSummary/getSalesTrend) sum
        // sale_items.cost_price_usd * quantity directly off this column,
        // the same as every manually-entered POS sale (routes/sales.ts POST
        // /). The initial `products` SELECT above already fetches
        // cost_price_usd/khr for every product -- this was previously
        // fetched and never read again, so every imported sale silently
        // recorded 0 cost (the column's DEFAULT) regardless of the
        // product's real cost, understating COGS and overstating margin on
        // any historical/imported sales data. A round-trip export carries
        // the original per-line snapshot; a hand-built file that leaves it
        // blank safely falls back to the product's current cost.
        cost_price_usd: costPriceUsd, cost_price_khr: costPriceKhr,
        base_price_usd: basePriceUsd, base_price_khr: basePriceKhr,
        product_discount_type: str(row.product_discount_type) || null,
        product_discount_label: str(row.product_discount_label) || null,
        product_discount_usd: productDiscountUsd, product_discount_khr: productDiscountKhr,
        manual_discount_type: str(row.manual_discount_type) || null,
        manual_discount_value: manualDiscountValue,
        manual_discount_usd: manualDiscountUsd, manual_discount_khr: manualDiscountKhr,
        // Item-level branch mirrors the order's single branch column --
        // the template has no per-line branch override, same as it has no
        // per-line status override, for the same reason.
        branch_id: matchedBranchId,
        batch_id: batchMatch?.id ?? null,
        batch_label: batchMatch ? batchLabel : null,
        batch_expiry_date: batchMatch?.expiry_date ?? null,
      })
    }
    if (error) {
      results.push({ rowNumber: first._rowNumber, action: 'error', identifier, existingId: null, message: error, changes: {}, data: first })
      continue
    }

    const subtotalUsd = items.reduce((sum, item) => sum + Number(item.total_usd || 0), 0)
    const subtotalKhr = items.reduce((sum, item) => sum + Number(item.total_khr || 0), 0)

    // Track F parity, part 70: mirrors routes/sales.ts POST /'s own
    // exchangeRate -> discount -> tax -> total -> amountPaid -> change
    // sequence, so an imported historical sale's total/paid/change
    // reconcile the same way a manually-entered one does -- previously
    // `total_usd`/`total_khr` were always just the bare item subtotal, so
    // a historical sale that genuinely had an order-level discount or tax
    // would import silently overstated (see progress.md part 69). None of
    // these columns existed on the template before this session, so
    // there's no prior real-world file to have gotten this wrong yet --
    // unlike the classifyProducts bug, this is new capability, not a fix
    // to something that was silently dropping real input.
    const exchangeRate = first.exchange_rate != null && str(first.exchange_rate) !== ''
      ? (parseImportNumericValue(first.exchange_rate, 4100, { field: 'exchange_rate' }) || 4100)
      : 4100
    const discountUsd = normalizeImportMoney(first.discount_usd, 0)
    const discountKhr = first.discount_khr != null && str(first.discount_khr) !== ''
      ? normalizeImportMoney(first.discount_khr)
      : Math.round(discountUsd * exchangeRate)
    const taxUsd = normalizeImportMoney(first.tax_usd, 0)
    const taxKhr = Math.round(taxUsd * exchangeRate)
    // Trusted as given, NOT re-validated against the customer's live points
    // balance the way a real-time checkout redemption is -- that check
    // guards against a stale/replayed live request overspending a balance
    // that could have changed since the cashier's screen last loaded it,
    // which has no equivalent for a historical file being loaded once. A
    // membership_points_redeemed value on a row with no resolved
    // customer_id still imports (same "unmatched just stays free text"
    // rule as customer_name/phone above) -- it just won't affect anyone's
    // live points balance since nothing keys off it without a customer_id.
    const membershipDiscountUsd = normalizeImportMoney(first.membership_discount_usd, 0)
    const membershipDiscountKhr = normalizeImportMoney(first.membership_discount_khr, 0)
    const membershipPointsRedeemed = parseImportNumericValue(first.membership_points_redeemed, 0, { allowNegative: false, field: 'membership_points_redeemed' })
    const totalUsd = round2(subtotalUsd - discountUsd - membershipDiscountUsd + taxUsd)
    const totalKhr = Math.round(totalUsd * exchangeRate)
    // `!= null && str(...) !== ''` (not `|| totalUsd`) so a file that
    // explicitly says a sale was paid 0 (fully unpaid/on credit) is
    // honored instead of silently defaulting to "paid in full" the way a
    // bare `Number(...) || totalUsd` would treat an explicit 0 the same as
    // a blank cell.
    const amountPaidUsd = first.amount_paid_usd != null && str(first.amount_paid_usd) !== ''
      ? normalizeImportMoney(first.amount_paid_usd)
      : totalUsd
    const amountPaidKhr = normalizeImportMoney(first.amount_paid_khr, 0)
    const changeUsd = round2(amountPaidUsd + (exchangeRate > 0 ? amountPaidKhr / exchangeRate : 0) - totalUsd)
    const changeKhr = Math.round(changeUsd * exchangeRate)

    const deliveryFeeUsd = rowIsDelivery ? normalizeImportMoney(first.delivery_fee_usd, 0) : 0
    const deliveryFeeKhr = rowIsDelivery
      ? (first.delivery_fee_khr != null && str(first.delivery_fee_khr) !== ''
        ? normalizeImportMoney(first.delivery_fee_khr)
        : Math.round(deliveryFeeUsd * exchangeRate))
      : 0

    let message: string | null = null
    if (isReturnGroup && !items.some((item) => Number(item.returned_quantity) > 0)) {
      message = `Status is "${status}" but no line has a returned_quantity -- this order will import with no stock restored. Add a returned_quantity column (or leave it blank only on lines that truly weren't returned) to restock what came back.`
    }

    const data: Record<string, unknown> = {
      receipt_number: str(first.receipt_number) || null,
      cashier_id: matchedCashierId,
      cashier_name: str(first.cashier_name) || null,
      branch_id: matchedBranchId,
      branch_name: matchedBranchId ? branchName : null,
      customer_id: matchedCustomerId,
      customer_name: str(first.customer_name) || null,
      customer_phone: str(first.customer_phone) || null,
      customer_address: str(first.customer_address) || null,
      payment_method: str(first.payment_method) || 'Cash',
      payment_currency: str(first.payment_currency) || 'USD',
      exchange_rate: exchangeRate,
      notes: str(first.notes) || null,
      sale_status: status,
      subtotal_usd: subtotalUsd, subtotal_khr: subtotalKhr,
      discount_usd: discountUsd, discount_khr: discountKhr,
      tax_usd: taxUsd, tax_khr: taxKhr,
      total_usd: totalUsd, total_khr: totalKhr,
      amount_paid_usd: amountPaidUsd, amount_paid_khr: amountPaidKhr,
      change_usd: changeUsd, change_khr: changeKhr,
      membership_discount_usd: membershipDiscountUsd, membership_discount_khr: membershipDiscountKhr,
      membership_points_redeemed: membershipPointsRedeemed,
      is_delivery: rowIsDelivery ? 1 : 0,
      delivery_contact_id: matchedDeliveryContactId,
      delivery_contact_name: rowIsDelivery ? (str(first.delivery_contact_name) || null) : null,
      delivery_contact_phone: rowIsDelivery ? (str(first.delivery_contact_phone) || null) : null,
      delivery_contact_address: rowIsDelivery ? (str(first.delivery_contact_address) || null) : null,
      delivery_fee_usd: deliveryFeeUsd, delivery_fee_khr: deliveryFeeKhr,
      delivery_fee_paid_by: rowIsDelivery ? (str(first.delivery_fee_paid_by) || 'customer') : 'customer',
      created_at: createdAt,
      items,
    }
    // Same three-case branch-resolution rule classifyProducts/classifyInventory
    // use -- a named branch that doesn't exist yet gets created at apply time
    // (branch_id null + branch_name_pending set) rather than the order
    // silently landing with no branch, and resolveAndCreateBranches below is
    // reused as-is for sales too (see runImportApply's sales dispatch).
    if (branchName && matchedBranchId == null) data.branch_name_pending = branchName

    results.push({ rowNumber: first._rowNumber, action: 'create', identifier, existingId: null, message, changes: {}, data })
  }
  return results
}

function diffFields(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, value] of Object.entries(incoming)) {
    const before = existing[key] ?? null
    const after = value ?? null
    if (String(before ?? '') !== String(after ?? '')) changes[key] = { from: before, to: after }
  }
  return changes
}

// The "Details" field-rule preset (BulkImportModal.tsx's applyFieldRulePreset
// / the products-review "Details" dropdown: Fill blanks only / Keep existing
// / Use imported) is sent on every row as a `_field_rules` JSON column
// (buildCsvForImportJob), but was never actually read anywhere on this
// side -- classifyProducts always wrote the imported value for these
// fields unconditionally, so picking "Keep existing" or "Fill blanks only"
// in the review UI silently had no effect on the real import (or on the
// changes/diff the reviewer was shown, since that's computed from the same
// `data` this mutates). Only covers the same six fields the UI itself
// offers a rule for; every other column keeps today's always-use-imported
// behavior. Requires `match` to carry these columns (see classifyProducts'
// `existing` SELECT above) -- a row with no match has nothing to reconcile
// against and data is left as the CSV provided, same as before.
const PRODUCT_DETAIL_FIELD_RULE_KEYS = ['category', 'brand', 'unit', 'supplier', 'description', 'low_stock_threshold'] as const

function isBlankFieldValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

function applyProductDetailFieldRules(data: Record<string, unknown>, match: Record<string, unknown> | null, fieldRulesRaw: string): void {
  if (!match) return
  let rules: Record<string, unknown>
  try {
    rules = JSON.parse(fieldRulesRaw || '{}')
  } catch {
    return
  }
  if (!rules || typeof rules !== 'object') return
  // Companion multi-value columns follow their primary field's own rule --
  // a "Keep existing"/"Fill blanks only" decision for category/brand would
  // otherwise leave categories/brands out of sync with whatever `category`/
  // `brand` this function just decided (see migrations/0033_product_multi_
  // category_brand.sql for why these two columns must always describe the
  // same product consistently).
  const MULTI_VALUE_COMPANION: Record<string, string> = { category: 'categories', brand: 'brands' }
  for (const key of PRODUCT_DETAIL_FIELD_RULE_KEYS) {
    const rule = rules[key]
    const companion = MULTI_VALUE_COMPANION[key]
    if (rule === 'keep_existing') {
      data[key] = match[key] ?? null
      if (companion) data[companion] = match[companion] ?? match[key] ?? null
    } else if (rule === 'merge_blank_only') {
      // "Fill blanks only": only let the CSV's value land when the
      // existing product doesn't already have one -- an already-filled
      // existing field is preserved rather than overwritten by whatever
      // this file happens to carry for it.
      if (!isBlankFieldValue(match[key])) {
        data[key] = match[key]
        if (companion) data[companion] = match[companion] ?? match[key] ?? null
      }
    }
    // 'use_imported' (or no rule set for this key) -- leave data[key] (and
    // its companion, already set from the CSV row's own '||' parsing) as
    // the CSV already set it, same as before this fix.
  }
}

// Job-level 'fill_blank' import mode (see ProductImportMode's doc comment).
// Same "merge_blank_only" idea as applyProductDetailFieldRules above, but
// applied to every PRODUCT_REPLACE_COLUMNS field automatically -- a whole-
// import policy, not a per-row/per-field manual pick -- and run
// unconditionally for every matched row when the job is in this mode
// (does nothing for an unmatched row: `match` is null, nothing to compare
// against, so the CSV's own value is used and the row creates a new
// product exactly like 'merge' mode would). Deliberately does not touch
// stock_quantity/branch_id/branch_id_explicit/branch_name_pending or any
// other non-PRODUCT_REPLACE_COLUMNS key still sitting in `data` -- those
// aren't in the allow-list this function iterates, so they pass through
// untouched here; materializeImportChunk's own 'fill_blank' branch is
// what actually skips writing stock/batches for this mode (see its
// comment for why quantity needs a second, write-time guard and not just
// a data-shaping one here).
function applyFillBlankOnlyMode(data: Record<string, unknown>, match: Record<string, unknown> | null): void {
  if (!match) return
  const MULTI_VALUE_COMPANION: Record<string, string> = { category: 'categories', brand: 'brands' }
  for (const key of PRODUCT_REPLACE_COLUMNS) {
    if (!(key in match)) continue
    if (isBlankFieldValue(match[key])) continue
    // Existing value isn't blank -- keep it, don't let this file's value
    // land, matching applyProductDetailFieldRules' 'merge_blank_only'
    // branch above for the six fields it already covers.
    data[key] = match[key]
    const companion = MULTI_VALUE_COMPANION[key]
    if (companion) data[companion] = match[companion] ?? match[key] ?? null
  }
}

async function classifyRows(db: D1Compat, type: ImportType, rows: ParsedCsvRow[], jobId: string, policyJson?: string | null): Promise<ImportRowResult[]> {
  if (type === 'products') return classifyProducts(db, rows, jobId, policyJson)
  if (type === 'customers') return classifyContacts(db, 'customers', rows, policyJson)
  if (type === 'suppliers') return classifyContacts(db, 'suppliers', rows, policyJson)
  if (type === 'delivery_contacts') return classifyContacts(db, 'delivery_contacts', rows, policyJson)
  if (type === 'inventory') return classifyInventory(db, rows, getInventoryImportAction(policyJson))
  if (type === 'stock_actions') return classifyUnifiedStockActions(db, rows, policyJson)
  return classifySales(db, rows)
}

// Plain-JSON-safe shape of the image match summary, for storage in
// summary_json (Maps/class instances don't survive JSON.stringify).
export type ImportImageMatchSummaryJson = {
  matchedCount: number
  unmatched: Array<{ id: number | string; originalName: string; publicPath: string }>
  overLimit: Array<{
    rowNumber: number | string
    productName: string
    limit: number
    images: Array<{ id: number | string; originalName: string; publicPath: string; score: number; kept: boolean }>
  }>
}

// Fetch + parse + decision-apply, shared by every reader of a job's CSV --
// loadAndClassify's bounded/synchronous preflight path AND the chunked
// analyze/apply engine below. Deliberately does NOT classify -- callers
// decide how much of `rows` to actually classify at once.
async function fetchDecidedRows(env: Env, jobId: string): Promise<{ rows: ParsedCsvRow[]; fileName: string; type: ImportType; policyJson: string | null } | null> {
  const csv = await fetchCsvText(env, jobId)
  if (!csv) return null
  const rows = parseCsvRows(csv.text).slice(0, MAX_SYNC_ROWS)
  const db = getDb(env)
  const job = await db.prepare(`SELECT type, policy_json FROM import_jobs WHERE id = @id`).get<{ type: ImportType; policy_json: string | null }>({ id: jobId })
  if (!job) return null
  const decisions = getDecisionMap(job.policy_json)
  const decidedRows = rows.map((row) => applyDecision(row, decisions[String(row._rowNumber)]))
  return { rows: decidedRows, fileName: csv.fileName, type: job.type, policyJson: job.policy_json }
}

// Bounded, synchronous, NOT chunked -- for POST /:id/preflight only (a
// quick sanity check the frontend runs before POST /:id/start; see
// PREFLIGHT_MAX_ROWS's comment). The authoritative full-file pass is the
// chunked runImportAnalyze below. maxRows defaults to MAX_SYNC_ROWS so any
// other/future small-scale caller gets today's "classify everything"
// behavior unless it explicitly asks for a bounded sample.
export async function loadAndClassify(env: Env, jobId: string, maxRows: number = MAX_SYNC_ROWS): Promise<{ rows: ParsedCsvRow[]; results: ImportRowResult[]; fileName: string; timings: Record<string, number>; imageMatch: ImportImageMatchSummaryJson | null } | null> {
  const sw = makeStopwatch()
  const decided = await fetchDecidedRows(env, jobId)
  sw.lap('fetchAndParseMs')
  if (!decided) return null
  const rows = decided.rows.slice(0, maxRows)
  const db = getDb(env)
  const results = await classifyRows(db, decided.type, rows, jobId, decided.policyJson)
  sw.lap('classifyMs')
  const decisions = getDecisionMap(decided.policyJson)
  for (const result of results) {
    const decision = decisions[String(result.rowNumber)]
    if (decision?.action === 'skip') result.action = 'skip'
  }
  let imageMatch: ImportImageMatchSummaryJson | null = null
  if (decided.type === 'products') {
    const match = await computeImportImageMatch(db, jobId, rows, decided.policyJson)
    imageMatch = summarizeImageMatch(match)
  }
  return { rows, results, fileName: decided.fileName, timings: { ...sw.marks, rowCount: rows.length }, imageMatch }
}

function summarizeImageMatch(match: Awaited<ReturnType<typeof computeImportImageMatch>>): ImportImageMatchSummaryJson {
  const keptIds = new Set(match.matched.map((m) => `${m.productId}:${m.image.id}`))
  return {
    matchedCount: match.matched.length,
    unmatched: match.unmatched.map((img) => ({ id: img.id, originalName: img.originalName, publicPath: img.publicPath })),
    overLimit: match.overLimit.map((entry) => ({
      rowNumber: entry.productId,
      productName: entry.productName,
      limit: entry.limit,
      images: entry.all.map((m) => ({
        id: m.image.id,
        originalName: m.image.originalName,
        publicPath: m.image.publicPath,
        score: Math.round(m.score * 100) / 100,
        kept: keptIds.has(`${m.productId}:${m.image.id}`),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// Chunk-state plumbing shared by runImportAnalyze/runImportApply -- see
// migration 0011_import_job_chunking.sql's header for the overall design.

type ImportChunkState = {
  // Populated once, on a phase run's first chunk, for job.type==='products'
  // only -- computeImportImageMatch is a full-file, cross-row computation
  // (see importImageMatch.ts's matchImagesToProducts, worst-case
  // O(images x rows) fuzzy scoring), so it's wrong to redo per-window (a
  // window doesn't see the whole file, so "too many images for this
  // product" resolution would come out different/incomplete) AND wasteful
  // to redo per-chunk even if it were window-safe. Cached here as plain
  // arrays (Maps aren't JSON-safe) and reused by every later chunk of the
  // SAME run via rehydrateImageMatchCache below.
  // Summary counts ONLY -- the per-row paths and the rename plan moved to
  // import_job_image_matches / import_job_image_renames in migration 0052.
  // Held here purely as the "already computed" flag and for the finished
  // job's summary_json; the bulk that made this column expensive is gone.
  imageMatch?: ImportImageMatchSummaryJson & { hasRenamePlan?: boolean }
  startedAtMs?: number // real wall-clock start of this whole (possibly many-invocation) phase run, for an honest summary_json.timings totalMs at the end
  // NOTE: the cross-chunk in-file duplicate ledger USED to live here as
  // `productSignatures`. It moved to the import_job_row_signatures table in
  // migration 0051 -- as a state blob it was parsed and re-serialised in
  // full on every chunk, which is work proportional to (rows x chunks)
  // rather than rows. See applyCrossChunkProductDedupe for the rule itself
  // and why analyze needs it at all.
}

// Preview-only counterpart to productImportRowSignature, used solely by
// runImportAnalyze's cross-chunk dedup pass above -- NOT a replacement for
// productImportRowSignature, which runImportApply still uses as the source
// of truth once ids are real. Identical rule to productImportRowSignature
// (both delegate to productIdentitySignature), kept as a separate function
// only because analyze makes no writes and never resolves a pending new
// branch name to a real id the way apply does, so it takes a plain Record
// instead of the narrower ProductImportSignatureInput apply already has a
// real branch_id for.
// Marks any 'create' row whose product already appeared earlier in THIS file
// as an update instead, so the review screen matches what approving it will
// actually do.
//
// The ledger lives in import_job_row_signatures rather than in
// chunk_state_json (see migration 0051): as a state blob it was parsed and
// re-serialised in full on every chunk, which is work proportional to
// (rows x chunks) rather than rows. Here each chunk reads back only the
// signatures it actually asks about.
async function applyCrossChunkProductDedupe(
  db: D1Compat,
  jobId: string,
  results: ImportRowResult[],
): Promise<void> {
  const creates = results.filter((r) => r.action === 'create')
  if (!creates.length) return

  const signatureByResult = new Map<ImportRowResult, string>()
  const wanted = new Set<string>()
  for (const result of creates) {
    const signature = previewProductSignature(result.data as Record<string, unknown>)
    signatureByResult.set(result, signature)
    wanted.add(signature)
  }

  // One indexed lookup for this window's signatures, not the whole ledger.
  const seen = new Map<string, number>()
  // 100 signatures plus @job_id is 101 bound parameters -- one over D1's
  // hard limit, so the old hand-rolled chunk size failed on its FIRST
  // chunk against real D1 (better-sqlite3, which the import harness runs
  // on, allows 32k and hid it). chunkForBinding is told about @id.
  for (const slice of chunkForBinding([...wanted], 1)) {
    const { sql, params } = buildInClause('s', slice)
    const rows = await db.prepare(`
      SELECT signature, row_number FROM import_job_row_signatures
      WHERE job_id = @id AND signature IN (${sql})
    `).all<{ signature: string; row_number: number }>({ ...params, id: jobId })
    for (const row of rows) seen.set(row.signature, Number(row.row_number))
  }

  // Walk in order so the FIRST row carrying a signature wins, whether its
  // pair is in an earlier chunk (found above) or earlier in this one.
  const inserts: { signature: string; rowNumber: number }[] = []
  for (const result of creates) {
    const signature = signatureByResult.get(result)!
    const earlierRowNumber = seen.get(signature)
    if (earlierRowNumber != null) {
      result.action = 'update'
      result.message = `Merges with row #${earlierRowNumber} elsewhere in this file (same product, not yet in the database)`
      ;(result.data as Record<string, unknown>).merge_row_number = earlierRowNumber
      continue
    }
    seen.set(signature, result.rowNumber)
    inserts.push({ signature, rowNumber: result.rowNumber })
  }

  if (!inserts.length) return
  // OR IGNORE rather than a plain INSERT: a retried chunk re-processes rows
  // it already recorded, and that must be a no-op instead of an error.
  await runD1BatchInChunks(db, inserts.map((entry) => ({
    sql: `INSERT OR IGNORE INTO import_job_row_signatures (job_id, signature, row_number) VALUES (@id, @signature, @rowNumber)`,
    params: { id: jobId, signature: entry.signature, rowNumber: entry.rowNumber },
  })))
}

function previewProductSignature(d: Record<string, unknown>): string {
  return productIdentitySignature(d)
}

async function getChunkState(db: D1Compat, jobId: string): Promise<{ cursor: number; state: ImportChunkState }> {
  const row = await db.prepare(`SELECT chunk_cursor, chunk_state_json FROM import_jobs WHERE id = @id`).get<{ chunk_cursor: number; chunk_state_json: string | null }>({ id: jobId })
  let state: ImportChunkState = {}
  try { state = row?.chunk_state_json ? JSON.parse(row.chunk_state_json) : {} } catch { state = {} }
  return { cursor: row?.chunk_cursor ?? 0, state }
}

async function saveChunkState(db: D1Compat, jobId: string, cursor: number, state: ImportChunkState): Promise<void> {
  await db.prepare(`UPDATE import_jobs SET chunk_cursor = @cursor, chunk_state_json = @state, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id: jobId, cursor, state: JSON.stringify(state) })
}

// Wipes chunk state + this phase's persisted row results -- called once at
// the START of a fresh (non-continuation) phase run so an earlier
// failed/cancelled/completed attempt's leftovers never bleed into a new
// one. See runImportAnalyze/runImportApply's own "is this a fresh start"
// check for how a fresh run is detected.
async function resetChunkState(db: D1Compat, jobId: string, phase: 'analyze' | 'apply'): Promise<void> {
  await db.prepare(`DELETE FROM import_job_rows WHERE job_id = @id AND phase = @phase`).run({ id: jobId, phase })
  // The cross-chunk dedupe ledger is per-RUN, not per-file: a fresh analyze
  // must not inherit the previous run's "already seen" marks, or rows would
  // be reported as merging with rows from a run that no longer exists. This
  // is what discarding chunk_state_json used to do implicitly.
  await db.prepare(`DELETE FROM import_job_row_signatures WHERE job_id = @id`).run({ id: jobId })
  await saveChunkState(db, jobId, 0, { startedAtMs: Date.now() })
}

// Decides whether a queue message landing in runImportAnalyze/runImportApply
// is a genuinely NEW run (reset chunk_cursor to 0 and wipe leftovers) or a
// CONTINUATION that must resume from wherever chunk_cursor already is.
//
// Exported (previously this was an inline `status !== 'analyzing'` check in
// each function) because getting it wrong silently destroyed real progress
// on large imports -- this deserves its own name and its own test, not to
// be buried as a one-liner.
//
// The only three statuses a queue message can actually observe here:
//   'queued'              -- a fresh POST /:id/start or /:id/retry (both set
//                             status='queued' before sending the message,
//                             see routes/importJobs.ts) => genuinely new run.
//   'analyzing'/'applying' -- this message is the phase's own
//                             self-continuation (see the
//                             `env.IMPORT_QUEUE.send` at the end of each
//                             chunk below) => resume.
//   'failed'               -- looks terminal, but can ALSO mean: THIS same
//                             message already ran once, threw, markJobFailed
//                             eagerly flipped status to 'failed' before the
//                             re-throw (see queue.ts's catch + markJobFailed
//                             below), and Cloudflare's own message.retry()
//                             is now redelivering that SAME message to cover
//                             a transient D1/R2 error -- not a new run. A
//                             genuine user-triggered retry can never reach
//                             this function with status='failed': it always
//                             goes through routes/importJobs.ts's
//                             /:id/retry, which sets status back to 'queued'
//                             FIRST, so that case is already covered above.
//
// This was the actual root cause of large imports (more chunks = more
// chances to hit one transient blip) appearing to hang or run far longer
// than their row count alone would predict: treating 'failed' as a fresh
// start here made resetChunkState wipe chunk_cursor back to 0 and delete
// every already-classified/applied row on the FIRST transient hiccup,
// silently restarting the whole phase from scratch instead of resuming --
// repeatedly, if the underlying transient condition (e.g. load-related D1
// latency) kept recurring. A 5,000-row import (~34 chunks/phase) rarely hit
// this more than once or twice before finishing anyway; an 11,000-row
// import (~74 chunks/phase) had roughly double the exposure per phase, so
// the same per-chunk hiccup rate translated into a much worse chance of
// never converging at all.
export function isFreshImportRun(status: string, phaseActiveStatus: 'analyzing' | 'applying'): boolean {
  return status !== phaseActiveStatus && status !== 'failed'
}

// Computes computeImportImageMatch ONCE (over the full, decision-applied
// row set) and caches the parts a chunked classify/apply run actually
// needs. Call only when state.imageMatch is still empty -- see call sites.
async function computeAndCacheImageMatch(
  db: D1Compat,
  jobId: string,
  allRows: ParsedCsvRow[],
  policyJson: string | null,
  cursor: number,
  state: ImportChunkState,
): Promise<NonNullable<ImportChunkState['imageMatch']>> {
  const match = await computeImportImageMatch(db, jobId, allRows, policyJson)

  // Replace rather than merge: a re-run can legitimately match different
  // rows (the operator changed a decision, or re-uploaded images), and a
  // leftover row from the previous attempt would silently attach the wrong
  // photo to a product.
  await db.prepare(`DELETE FROM import_job_image_matches WHERE job_id = @id`).run({ id: jobId })
  await db.prepare(`DELETE FROM import_job_image_renames WHERE job_id = @id`).run({ id: jobId })

  const rowStatements = [...match.rowImagePaths.entries()].map(([rowNumber, imagePath]) => ({
    sql: `INSERT OR REPLACE INTO import_job_image_matches (job_id, row_number, image_path) VALUES (@id, @rowNumber, @imagePath)`,
    params: { id: jobId, rowNumber, imagePath },
  }))
  if (rowStatements.length) await runD1BatchInChunks(db, rowStatements)

  const renameStatements = [...match.renamePlan.entries()].map(([fileId, newName]) => ({
    sql: `INSERT OR REPLACE INTO import_job_image_renames (job_id, file_id, new_name) VALUES (@id, @fileId, @newName)`,
    params: { id: jobId, fileId: String(fileId), newName },
  }))
  if (renameStatements.length) await runD1BatchInChunks(db, renameStatements)

  const cached = { ...summarizeImageMatch(match), hasRenamePlan: renameStatements.length > 0 }
  state.imageMatch = cached
  await saveChunkState(db, jobId, cursor, state)
  return cached
}

// ---------------------------------------------------------------------------
// Single-writer lease
// ---------------------------------------------------------------------------
// Cloudflare Queues is at-least-once: the same message can arrive twice, and
// a retry can overlap the invocation it retries. Without a lease, two
// invocations of the SAME job read the same chunk_cursor, classify the same
// ~150 rows, both see "no existing product matches" for every create, and
// both INSERT -- duplicate products that nothing later reconciles, because
// each looks like a legitimately distinct row. On the sales path the same
// overlap writes a receipt twice.
//
// Two DIFFERENT jobs never contend here: every table this engine writes
// during a run is keyed by job_id. This is specifically about one job being
// processed twice at once.
//
// The lease EXPIRES rather than being a status flag. An invocation that dies
// mid-chunk (CPU limit, isolate eviction) cannot release anything, and a
// sticky flag would wedge the job forever with no way back from inside the
// app. The worst case here is that the job waits out the remainder.
const IMPORT_LEASE_MS = 60_000

/**
 * Claims the job for this invocation, or returns null if another one holds
 * it. Atomic: the WHERE clause is what decides, so two racing invocations
 * cannot both see a free lease -- D1 reports how many rows the UPDATE
 * actually changed, and only one of them gets 1.
 */
async function acquireImportLease(db: D1Compat, jobId: string): Promise<string | null> {
  const token = crypto.randomUUID()
  const now = new Date()
  const result = await db.prepare(`
    UPDATE import_jobs
    SET lease_token = @token, lease_expires_at = @expires, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
      AND (lease_expires_at IS NULL OR lease_expires_at < @now)
  `).run({
    id: jobId,
    token,
    now: now.toISOString(),
    expires: new Date(now.getTime() + IMPORT_LEASE_MS).toISOString(),
  })
  return result.changes === 1 ? token : null
}

/**
 * Releases the lease so the next continuation can start immediately rather
 * than waiting out the full expiry.
 *
 * Guarded on the token: an invocation whose lease already expired and was
 * taken by someone else must NOT clear the new holder's lease on its way
 * out, or it would hand a third invocation a job that is actively running.
 */
async function releaseImportLease(db: D1Compat, jobId: string, token: string): Promise<void> {
  await db.prepare(`
    UPDATE import_jobs SET lease_token = NULL, lease_expires_at = NULL
    WHERE id = @id AND lease_token = @token
  `).run({ id: jobId, token })
}

// SQL form of partitionSalesGroups' key, kept beside it deliberately: if the
// two ever disagree, a sales import silently splits one receipt across two
// chunks or merges two receipts into one order. Mirrors the JS rule exactly
// -- trimmed receipt_number, else trimmed order_reference, else the compact
// template's inherited key sealed during materialization, else a per-row
// key (only possible before any invoice header has appeared).
const SALES_GROUP_KEY_SQL = `COALESCE(
  NULLIF(TRIM(COALESCE(json_extract(data_json, '$.receipt_number'), '')), ''),
  NULLIF(TRIM(COALESCE(json_extract(data_json, '$.order_reference'), '')), ''),
  NULLIF(TRIM(COALESCE(json_extract(data_json, '$._sales_group_key'), '')), ''),
  '__row_' || row_number
)`

/**
 * How many order groups a sales job has.
 *
 * The chunk cursor for a sales import counts GROUPS, not rows -- a receipt's
 * line items must be classified together or the order is split across two
 * invocations and written twice.
 */
async function countSalesGroups(db: D1Compat, jobId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT ${SALES_GROUP_KEY_SQL} AS group_key
      FROM import_job_source_rows WHERE job_id = @id
      GROUP BY group_key
    )
  `).get<{ n: number }>({ id: jobId })
  return Number(row?.n || 0)
}

/**
 * One window of sales groups, as [groupKey, rows] in stable order.
 *
 * Replaces reading EVERY row of the file and re-partitioning it on every
 * chunk. For an 8,700-row file that was ~58 full reads and ~58 full
 * re-partitions per phase, each one JSON.parsing every row, inside a 10ms
 * budget -- the same shape as the two chunk-state costs already removed,
 * and the last one left on the import path.
 *
 * Ordering is by the group's FIRST appearance in the file, which is what
 * partitionSalesGroups produced (Map preserves insertion order) and what the
 * cursor's meaning depends on: window N must be the same set of groups on a
 * retry as it was on the first attempt.
 */
async function readSalesGroupWindow(
  db: D1Compat,
  jobId: string,
  decisions: Record<string, RowDecision>,
  cursor: number,
  limit: number,
): Promise<Array<[string, ParsedCsvRow[]]>> {
  const keyRows = await db.prepare(`
    SELECT ${SALES_GROUP_KEY_SQL} AS group_key, MIN(sequence) AS first_seq
    FROM import_job_source_rows WHERE job_id = @id
    GROUP BY group_key
    ORDER BY first_seq ASC
    LIMIT @limit OFFSET @cursor
  `).all<{ group_key: string; first_seq: number }>({ id: jobId, limit, cursor })
  if (!keyRows.length) return []

  // `limit` is ROWS_PER_IMPORT_CHUNK (150), so this list is always over
  // D1's 100-parameter ceiling on its own -- chunked, with @id reserved.
  const dataRows: Array<{ group_key: string; data_json: string }> = []
  for (const slice of chunkForBinding(keyRows.map((row) => row.group_key), 1)) {
    const { sql, params } = buildInClause('k', slice)
    const chunkRows = await db.prepare(`
      SELECT ${SALES_GROUP_KEY_SQL} AS group_key, data_json
      FROM import_job_source_rows
      WHERE job_id = @id AND ${SALES_GROUP_KEY_SQL} IN (${sql})
      ORDER BY sequence ASC
    `).all<{ group_key: string; data_json: string }>({ ...params, id: jobId })
    dataRows.push(...chunkRows)
  }

  // Seed in key order first so a group with no rows cannot reorder the
  // window, then fill -- rows arrive in sequence order, so line items keep
  // their original order within each receipt.
  const grouped = new Map<string, ParsedCsvRow[]>()
  for (const key of keyRows) grouped.set(String(key.group_key), [])
  for (const row of dataRows) {
    const parsed = JSON.parse(row.data_json) as ParsedCsvRow
    const list = grouped.get(String(row.group_key))
    if (list) list.push(applyDecision(parsed, decisions[String(parsed._rowNumber)]))
  }
  return [...grouped.entries()]
}

// Image paths for just the rows in THIS window.
//
// The whole point of migration 0052: loading all 10,000 matched rows to use
// 150 of them was the cost. Returns undefined when the job has no image
// match at all, which is what classifyProducts already expects for a
// CSV-only import.
async function readRowImagePaths(
  db: D1Compat,
  jobId: string,
  rows: ParsedCsvRow[],
): Promise<Map<number, string> | undefined> {
  const rowNumbers = rows.map((row) => Number(row._rowNumber)).filter((n) => Number.isFinite(n))
  if (!rowNumbers.length) return undefined
  const found = new Map<number, string>()
  // Was 200 per chunk -- twice D1's whole per-statement parameter budget.
  for (const slice of chunkForBinding(rowNumbers, 1)) {
    const { sql, params } = buildInClause('r', slice)
    const matched = await db.prepare(`
      SELECT row_number, image_path FROM import_job_image_matches
      WHERE job_id = @id AND row_number IN (${sql})
    `).all<{ row_number: number; image_path: string }>({ ...params, id: jobId })
    for (const row of matched) found.set(Number(row.row_number), String(row.image_path))
  }
  return found
}

/** The full rename plan. Read once per apply run, on its first chunk. */
async function readImageRenamePlan(db: D1Compat, jobId: string): Promise<Array<[string, string]>> {
  const rows = await db
    .prepare(`SELECT file_id, new_name FROM import_job_image_renames WHERE job_id = @id`)
    .all<{ file_id: string; new_name: string }>({ id: jobId })
  return rows.map((row) => [String(row.file_id), String(row.new_name)])
}

// Persists this chunk's classification results so GET /:id/review (a
// plain SELECT, see importJobs.ts) doesn't need to reclassify the whole
// file on every paginated request, and so a later chunk/finalize step can
// derive aggregate counts with a cheap SQL GROUP BY instead of an
// in-memory accumulator that would need to survive across invocations.
async function persistChunkResults(db: D1Compat, jobId: string, phase: 'analyze' | 'apply', results: ImportRowResult[], groupIndexByRowNumber?: Map<number, number>): Promise<void> {
  if (!results.length) return
  const statements = results.map((r) => ({
    sql: `INSERT OR REPLACE INTO import_job_rows (job_id, phase, row_number, group_index, action, identifier, result_json) VALUES (@job_id, @phase, @row_number, @group_index, @action, @identifier, @result_json)`,
    params: {
      job_id: jobId,
      phase,
      row_number: r.rowNumber,
      group_index: groupIndexByRowNumber?.get(r.rowNumber) ?? null,
      action: r.action,
      identifier: r.identifier,
      result_json: JSON.stringify(r),
    },
  }))
  await runD1BatchInChunks(db, statements)
}

// ---------------------------------------------------------------------------
// ANALYZE: preview only, writes summary/error counts, no data-table writes.

// Chunked + resumable (see migration 0011's header and ROWS_PER_IMPORT_CHUNK's
// comment). One call = one small window's worth of work: ensure the file is
// materialized (see ensureSourceRowsMaterialized -- a no-op after the first
// few chunks of a run), classify just this window, persist its results,
// then either re-enqueue a continuation message for the next window or, on
// the last window, write the final summary_json and flip the job to
// awaiting_review. queue.ts acks the CURRENT message after this returns
// either way -- the continuation is a separate, fresh message, not a retry
// of this one.
export async function runImportAnalyze(env: Env, jobId: string, queueLatencyMs?: number): Promise<void> {
  const db = getDb(env)
  const sw = makeStopwatch()
  const jobRow = await db.prepare(`SELECT status, cancel_requested FROM import_jobs WHERE id = @id`).get<{ status: string; cancel_requested: number }>({ id: jobId })
  if (!jobRow) throw new Error('Import job not found')
  // See isFreshImportRun's comment for the full "why", including the
  // 'failed' case -- Cloudflare's own message.retry() re-delivery of a
  // chunk that crashed before finishing lands here with status='failed'
  // (markJobFailed already ran), not 'analyzing', so it must be checked for
  // explicitly rather than assumed to still look like a continuation.
  const isFreshStart = isFreshImportRun(jobRow.status, 'analyzing')

  // Claim the job before touching a chunk. If another invocation holds it --
  // an at-least-once redelivery, or a retry overlapping the run it retries --
  // return without processing. Deliberately NOT an error: the holder is
  // making progress, so this message has nothing left to do and must ack
  // rather than retry, or it would spin against a healthy run.
  const leaseToken = await acquireImportLease(db, jobId)
  if (!leaseToken) {
    console.log('[import] skipping duplicate delivery; another invocation holds the lease', jobId)
    return
  }

  try {
    if (jobRow.status !== 'analyzing') {
      // Reclaim 'analyzing' status on every entry that isn't already an
      // in-progress continuation -- covers a genuine fresh start (status
      // was 'queued') AND a resume after a transient-error retry (status
      // was 'failed'), so the row never sits showing stale 'failed' while
      // this phase is actually still working.
      await db.prepare(`UPDATE import_jobs SET status = 'analyzing', phase = 'analyzing', updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
    }
    if (isFreshStart) {
      await db.prepare(`DELETE FROM import_job_errors WHERE job_id = @id`).run({ id: jobId })
      await resetChunkState(db, jobId, 'analyze')
    }
    if (jobRow.cancel_requested) {
      await db.prepare(`UPDATE import_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
      return
    }

    const stillMaterializing = await ensureSourceRowsMaterialized(env, db, jobId, 'analyze')
    if (stillMaterializing) {
      sw.lap('materializeChunkMs')
      console.log('[import-timing] analyze materialize chunk', jobId, sw.marks)
      return
    }

    const meta = await fetchMaterializedMeta(db, jobId)
    sw.lap('fetchAndParseMs') // now a couple of narrow SELECTs, not a full re-parse -- see ensureSourceRowsMaterialized above
    if (!meta) throw new Error('No CSV file uploaded for this job')
    if (meta.type === 'stock_actions' && meta.totalRows > STOCK_ACTION_MAX_ROWS) {
      throw new Error(`This stock import has ${meta.totalRows} rows; split it into files of at most ${STOCK_ACTION_MAX_ROWS} rows before importing.`)
    }
    const { cursor, state } = await getChunkState(db, jobId)
    const decisions = getDecisionMap(meta.policyJson)

    const isSales = meta.type === 'sales'
    // Only THIS window's groups, read by SQL. Previously every chunk read the
    // whole file back and re-partitioned it, which is work proportional to
    // (rows x chunks) rather than rows -- the last remaining cost of that
    // shape on the import path.
    const totalUnits = isSales ? await countSalesGroups(db, jobId) : meta.totalRows
    const windowEntries = isSales
      ? await readSalesGroupWindow(db, jobId, decisions, cursor, ROWS_PER_IMPORT_CHUNK)
      : null

    let imageMatchCache = state.imageMatch
    if (meta.type === 'products' && !imageMatchCache && shouldWireImages(meta.policyJson)) {
      const allRows = await readAllMaterializedRows(db, jobId, decisions)
      imageMatchCache = await computeAndCacheImageMatch(db, jobId, allRows, meta.policyJson, cursor, state)
    }

    const windowRows = windowEntries
      ? windowEntries.flatMap(([, rows]) => rows)
      : await readMaterializedWindow(db, jobId, cursor, ROWS_PER_IMPORT_CHUNK, decisions)
    const groupIndexByRowNumber = windowEntries
      ? new Map(windowEntries.flatMap(([, rows], i) => rows.map((r) => [r._rowNumber, cursor + i] as const)))
      : undefined

    const rowImagePaths = imageMatchCache ? await readRowImagePaths(db, jobId, windowRows) : undefined
    const results = meta.type === 'products'
      ? await classifyProducts(db, windowRows, jobId, meta.policyJson, rowImagePaths)
      : await classifyRows(db, meta.type, windowRows, jobId, meta.policyJson)
    sw.lap('classifyChunkMs')

    // Cross-chunk in-file duplicate detection for products -- see
    // applyCrossChunkProductDedupe's comment for the full "why".
    // Only rows classifyProducts couldn't match to anything already in the
    // database ('create') are candidates; a row that already matched a
    // real existing product is a genuine update, unrelated to this.
    if (meta.type === 'products') {
      await applyCrossChunkProductDedupe(db, jobId, results)
    }

    for (const result of results) {
      const decision = decisions[String(result.rowNumber)]
      if (decision?.action === 'skip') result.action = 'skip'
    }

    const errorInserts = results
      .filter((r) => r.action === 'error')
      .map((r) => ({
        sql: `INSERT INTO import_job_errors (job_id, row_number, file_name, code, message, raw_json) VALUES (@job_id, @row_number, @file_name, @code, @message, @raw_json)`,
        params: { job_id: jobId, row_number: r.rowNumber, file_name: meta.fileName, code: 'validation_error', message: r.message || 'Row failed validation', raw_json: JSON.stringify(r.data || {}) },
      }))
    if (errorInserts.length) await runD1BatchInChunks(db, errorInserts)
    await persistChunkResults(db, jobId, 'analyze', results, groupIndexByRowNumber)

    const nextCursor = cursor + (windowEntries ? windowEntries.length : windowRows.length)

    if (nextCursor < totalUnits) {
      // More to do: checkpoint progress and hand off to a fresh invocation
      // (fresh 10ms CPU budget) rather than looping further in this one.
      // total_rows/processed_rows count GROUPS for sales imports (matching
      // this function's pre-chunking behavior, where `results.length` was
      // already one entry per order, not per CSV line) and raw rows for
      // every other type -- totalUnits/nextCursor already use whichever
      // unit is right for this job's type, see their definitions above.
      await saveChunkState(db, jobId, nextCursor, state)
      await db.prepare(`UPDATE import_jobs SET total_rows = @total, processed_rows = @processed, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
        .run({ id: jobId, total: totalUnits, processed: nextCursor })
      console.log('[import-timing] analyze chunk', jobId, { cursor, nextCursor, totalUnits, ...sw.marks })
      await env.IMPORT_QUEUE.send({ jobId, kind: 'analyze' })
      return
    }

    // Last chunk: aggregate the persisted per-row results into the final
    // summary instead of an in-memory accumulator (which couldn't have
    // survived across the many invocations this run may have taken).
    if (meta.type === 'stock_actions') {
      await sealUnifiedStockAnalyzeConflicts(db, jobId)
      sw.lap('sealStockActionConflictsMs')
    }
    const counts = await db.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' GROUP BY action`)
      .all<{ action: RowAction; n: number }>({ id: jobId })
    const byAction: Record<RowAction, number> = { create: 0, update: 0, skip: 0, error: 0 }
    for (const row of counts) byAction[row.action] = row.n
    const total = totalUnits

    // Non-blocking, per-row notices (barcode-reused-by-a-different-product,
    // negative-stock-reset-to-0 -- see classifyProducts) live in
    // ImportRowResult.message on otherwise-normal create/update rows, not
    // as their own action -- they don't stop the row from importing, they
    // just deserve operator attention. `warning_count` (schema since
    // 0001_init.sql) previously just mirrored the error count, which meant
    // it never actually reported anything beyond what `failed_rows`
    // already did; this is the real count so the tracker widget can show
    // it distinctly from hard errors.
    const warnedRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'analyze' AND action != 'error' AND json_extract(result_json, '$.message') IS NOT NULL`,
    ).get<{ n: number }>({ id: jobId })
    const warned = warnedRow?.n || 0
    const stockActionConfirmationRows = meta.type === 'stock_actions'
      ? await countUnifiedStockConfirmationRows(db, jobId)
      : 0

    // File-structure warnings (Part 316): NOT per-row -- these describe the
    // header row itself, so they don't fit ImportRowWarning's per-row shape
    // and don't affect byAction/warned above. Read back from the already-
    // persisted materialize state rather than recomputed here, since that's
    // the one place that saw the raw header row and (for blank columns)
    // every data row as materialization streamed through them. Only a
    // blank-header column CONFIRMED to have data is included -- see
    // blankHeaderColumnsWithData's own comment.
    const { state: materializeState } = await getMaterializeState(db, jobId)
    const headerWarnings = {
      blankHeaderColumns: materializeState.blankHeaderColumnsWithData || [],
      duplicateHeaderKeys: materializeState.duplicateHeaderKeys || [],
    }

    const summary = {
      created: byAction.create, updated: byAction.update, skipped: byAction.skip, errored: byAction.error, warned, total,
      analyzed_rows: total,
      ...(meta.type === 'stock_actions' ? {
        requires_stock_action_confirmation: stockActionConfirmationRows > 0,
        stock_action_confirmation_rows: stockActionConfirmationRows,
      } : {}),
      imageMatch: imageMatchCache
        ? { matchedCount: imageMatchCache.matchedCount, unmatched: imageMatchCache.unmatched, overLimit: imageMatchCache.overLimit }
        : null,
      // Omitted entirely (not just empty arrays) when there's nothing to
      // report, so existing summary_json consumers that don't know this
      // field yet see no shape change on the common case of a clean file.
      ...(headerWarnings.blankHeaderColumns.length || headerWarnings.duplicateHeaderKeys.length ? { headerWarnings } : {}),
      timings: {
        analyze: {
          totalMs: Date.now() - (state.startedAtMs ?? Date.now()),
          lastChunkMs: sw.marks,
          queueLatencyMs: queueLatencyMs ?? null,
        },
      },
    }
    await db.prepare(`
      UPDATE import_jobs SET
        status = 'awaiting_review', phase = 'awaiting_review',
        total_rows = @total, processed_rows = 0, failed_rows = @errored,
        warning_count = @warned, summary_json = @summary, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: jobId, total, errored: byAction.error, warned, summary: JSON.stringify(summary) })
    console.log('[import-timing] analyze done', jobId, summary.timings.analyze)
  } catch (error) {
    await markJobFailed(db, jobId, (error as Error).message || 'Analyze failed')
    throw error
  } finally {
    // Released on EVERY exit, including the failure path. A failed chunk is
    // retried by the queue, and that retry must be able to claim the job
    // rather than waiting out a 60s lease held by an invocation that is
    // already gone. Token-guarded inside, so an invocation whose lease had
    // already expired and been taken cannot clear the new holder's.
    await releaseImportLease(db, jobId, leaseToken)
  }
}

// ---------------------------------------------------------------------------
// APPLY: writes to the real data tables. Runs analyze's classification
// again (decisions may have changed since the last analyze) then commits
// every create/update row not marked skip/error, per-type, using batched
// atomic writes (see lib/db.ts's D1Compat.batch comment on what "atomic"
// covers here: each table's batch is one transaction; the products batch
// and the inventory-movement batch are still two separate transactions,
// matching the original's own per-row-group commit shape rather than one
// giant single-table lock across types).

// Creates any branches that classifyProducts/classifyInventory flagged as
// missing (via data.branch_name_pending), then mutates `actionable` in
// place so every row ends up with a real branch_id. Only called from
// runImportApply -- analyze must stay writes-free (see its own comment),
// so a CSV that names an unrecognized branch shows up in the preview with
// a null branch_id and only gets a real row once the operator actually
// applies the import.
//
// Re-checks the DB immediately before inserting (not just the branchRows
// snapshot classify took earlier) so two rows naming the same new branch
// -- or a branch someone else created by hand between analyze and apply
// -- don't produce two rows for what should be one branch. Names are
// deduped case-insensitively among themselves too, preserving whichever
// casing appeared first in the file.
// Gives every already-existing active product an explicit 0 row at a
// just-created branch.
//
// Without this, a branch created part-way through an import is invisible to
// every product created before it: runImportApply seeds "all other active
// branches at 0" from a branch list loaded once per chunk, so a product
// written in chunk 1 never learns about a branch that first appeared in
// chunk 5. Measured on a real 8,727-row file, which names three branches:
// exactly one product -- the very first row -- ended up with no row for the
// last branch to be created. Small, but it violates "auto creates for all
// standalone and child rows, no exceptions", and a product with no
// branch_stock row is invisible to any branch-filtered POS/Inventory view
// rather than showing an honest 0.
//
// Mirrors routes/branches.ts's identical back-fill on the manual
// create-branch path; awaited rather than fire-and-forget because an import
// is already a background job and a partially-seeded catalog is exactly the
// silent partial write the project's rules forbid.
async function backfillBranchStockForNewBranch(db: D1Compat, branchId: number): Promise<void> {
  await db.prepare(`
    INSERT INTO branch_stock (product_id, branch_id, quantity)
    SELECT p.id, @branchId, 0 FROM products p
    WHERE p.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.branch_id = @branchId)
  `).run({ branchId })
}

async function resolveAndCreateBranches(db: D1Compat, actionable: ImportRowResult[]): Promise<void> {
  const pendingNames = new Map<string, string>() // lower(name) -> first-seen-casing name
  let needsDefault = false
  for (const r of actionable) {
    const pending = (r.data as Record<string, unknown>).branch_name_pending as string | undefined
    if (!pending) continue
    if (pending === DEFAULT_BRANCH_SENTINEL) needsDefault = true
    else if (!pendingNames.has(lower(pending))) pendingNames.set(lower(pending), pending)
  }
  if (!pendingNames.size && !needsDefault) return

  const resolvedByLowerName = new Map<string, number>()
  for (const [lowerName, name] of pendingNames) {
    const existing = await db.prepare(`SELECT id FROM branches WHERE lower(name) = @name LIMIT 1`).get<{ id: number }>({ name: lowerName })
    if (existing) {
      resolvedByLowerName.set(lowerName, existing.id)
      continue
    }
    const inserted = await db.prepare(`INSERT INTO branches (name, is_active) VALUES (@name, 1)`).run({ name })
    resolvedByLowerName.set(lowerName, inserted.lastInsertRowid)
    await backfillBranchStockForNewBranch(db, inserted.lastInsertRowid)
  }

  let defaultBranchId: number | null = null
  if (needsDefault) {
    const existingDefault = await db.prepare(`SELECT id FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1`).get<{ id: number }>()
    if (existingDefault) {
      defaultBranchId = existingDefault.id
    } else {
      const inserted = await db.prepare(`INSERT INTO branches (name, is_default, is_active) VALUES ('Main Branch', 1, 1)`).run()
      defaultBranchId = inserted.lastInsertRowid
      await backfillBranchStockForNewBranch(db, defaultBranchId)
    }
  }

  for (const r of actionable) {
    const d = r.data as Record<string, unknown>
    const pending = d.branch_name_pending as string | undefined
    if (!pending) continue
    if (pending === DEFAULT_BRANCH_SENTINEL) {
      d.branch_id = defaultBranchId
    } else {
      const resolvedId = resolvedByLowerName.get(lower(pending)) ?? null
      d.branch_id = resolvedId
      if ('branch_id_explicit' in d) d.branch_id_explicit = resolvedId != null ? 1 : 0
      if ('branch_name' in d) d.branch_name = resolvedId != null ? pending : null
    }
    delete d.branch_name_pending
  }
}

// Same-batch duplicate merge: two brand-new rows in ONE file with no
// sku/barcode to match on (classifyProducts's bySku/byBarcode lookups only
// cover EXISTING db rows) still count as "the same product" if they agree
// on name + cost + price + barcode + branch -- the exact fallback rule
// classifyProducts already applies against existing rows (see its own
// comment above), just extended to this batch's own rows. Analyze can't
// resolve this (no row has a real id yet to merge into -- see the "no
// data-table writes" comment on analyze), so it's only resolvable at apply
// time, in runImportApply, at the one point ids are actually assigned.
// Pure/exported so it can be unit-tested without a database.
export type ProductImportSignatureInput = {
  name: unknown
  barcode: unknown
  cost_price_usd: unknown
  cost_price_khr: unknown
  selling_price_usd: unknown
  selling_price_khr: unknown
  branch_id: number | null
}

// Branch is intentionally NOT part of this signature -- see classifyProducts'
// byName/cost/price/barcode fallback comment for why. Two rows in the same
// chunk with identical name/cost/price/barcode but different branches are
// the SAME product (each row's own branch just gets its own branch_stock
// entry via the normal update-path write once the second row resolves to
// the first's pre-allocated id below), not two products.
export function productImportRowSignature(d: ProductImportSignatureInput): string {
  return productIdentitySignature(d)
}

// The catch blocks in runImportAnalyze/runImportApply below record the
// failure onto the job row (status='failed', last_error) so it stops
// looking like a healthy in-progress job. But the error that lands here is
// very often *itself* a D1 problem (the CPU-time-limit reset this file
// already works around above) -- right after D1 resets a transaction, the
// binding can bounce a follow-up query for a moment too. If that recovery
// write also throws, the exception it produced replaces the original one
// and propagates out uncaught (queue.ts's handler only wraps the call to
// runImportApply/runImportAnalyze, not this catch's own body), so the job
// never actually gets `status = 'failed'` -- it's left exactly where it
// was, permanently reading "applying" with no last_error, which is the
// stuck/zombie card this whole thing is trying to prevent. A few retries
// with a short pause covers that -- D1 resets the failed transaction, not
// the whole binding, so a moment later it's normally fine again.
export async function markJobFailed(db: D1Compat, jobId: string, message: string): Promise<void> {
  const error = String(message || '').slice(0, 2000) // last_error is a display field, not a log -- keep it bounded
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.prepare(`UPDATE import_jobs SET status = 'failed', phase = 'failed', last_error = @error, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId, error })
      return
    } catch (writeError) {
      if (attempt === 2) {
        // Out of retries -- log it so it's at least visible in Worker logs
        // even though the job row itself couldn't be updated. The frontend
        // tracker's Cancel/Remove now work on active-status jobs regardless
        // (see BackgroundImportTracker.tsx), so this isn't a total dead
        // end for the user even in this worst case.
        console.error('[import-engine] could not record job failure after retries', jobId, writeError)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
}

// Shared apply-phase finalize. Both the generic (products/sales/contacts/
// inventory) tail of runImportApply and the dedicated stock-actions apply
// path funnel through here so the two can never disagree on how a finished
// import's status, counts, warning total, or summary_json is computed --
// the single-source-of-truth rule the batch/health helpers already follow.
// Reads the authoritative per-row outcomes from import_job_rows (every
// chunk's, not just the last), so it is correct whether the job ran in one
// pass or many. Caller does its own cache-invalidation/broadcast first (the
// channels differ by type); this only writes the terminal job row.
async function finalizeImportApply(
  db: D1Compat,
  jobId: string,
  totalUnits: number,
  startedAtMs: number | undefined,
  applyMarks: Record<string, number>,
  queueLatencyMs: number | undefined,
  deactivatedCount: number,
): Promise<{ applied: number; failed: number }> {
  const finalCounts = await db.prepare(`SELECT action, COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'apply' GROUP BY action`)
    .all<{ action: RowAction; n: number }>({ id: jobId })
  const byAction: Record<RowAction, number> = { create: 0, update: 0, skip: 0, error: 0 }
  for (const row of finalCounts) byAction[row.action] = row.n
  const totalApplied = byAction.create + byAction.update
  const totalFailed = byAction.error

  // A job with any failed row is marked completed_with_errors (not a
  // plain completed) -- the frontend tracker already special-cases this
  // status (keeps the "Download errors" / "Retry" actions visible after
  // the import finishes).
  const finalStatus = totalFailed > 0 ? 'completed_with_errors' : 'completed'
  const warnedApplyRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM import_job_rows WHERE job_id = @id AND phase = 'apply' AND action != 'error' AND json_extract(result_json, '$.message') IS NOT NULL`,
  ).get<{ n: number }>({ id: jobId })
  const warnedApply = warnedApplyRow?.n || 0
  await db.prepare(`
    UPDATE import_jobs SET status = @status, phase = @status,
      processed_rows = @processed, failed_rows = @failed, warning_count = @warned, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id: jobId, status: finalStatus, processed: totalApplied, failed: totalFailed, warned: warnedApply })

  const existing = await db.prepare(`SELECT summary_json FROM import_jobs WHERE id = @id`).get<{ summary_json: string | null }>({ id: jobId })
  let summary: Record<string, unknown> = {}
  try { summary = existing?.summary_json ? JSON.parse(existing.summary_json) : {} } catch { summary = {} }
  const priorTimings = (summary.timings as Record<string, unknown>) || {}
  summary.created = byAction.create
  summary.updated = byAction.update
  summary.skipped = byAction.skip
  summary.errored = totalFailed
  summary.warned = warnedApply
  summary.total = totalUnits
  if (deactivatedCount > 0) summary.deactivated = deactivatedCount
  summary.timings = {
    ...priorTimings,
    apply: {
      totalMs: Date.now() - (startedAtMs ?? Date.now()),
      lastChunkMs: applyMarks,
      queueLatencyMs: queueLatencyMs ?? null,
    },
  }
  await db.prepare(`UPDATE import_jobs SET summary_json = @summary WHERE id = @id`).run({ id: jobId, summary: JSON.stringify(summary) })
  return { applied: totalApplied, failed: totalFailed }
}

// Free-plan ceilings for one unified stock-action import. Unlike the
// generic apply path this is a SINGLE pass (see applyStockActionsJob's own
// comment on why it cannot be chunked), so BOTH raw rows and dispatched
// business units are bounded. Workers Free permits 1,000 internal-service
// subrequests per invocation; a worst-case new-product row touching both
// branches can use roughly 12 D1 calls across resolve/create/add/verification.
// Sixty units leaves meaningful headroom for classification, persistence,
// finalization and broadcasts instead of balancing at the platform ceiling.
const STOCK_ACTION_MAX_ROWS = 480 // 60 maximum groups x the writer's 8-line receipt ceiling
const STOCK_ACTION_MAX_UNITS = 60

/**
 * Applies a unified "Add / Sale / Reconciliation" stock-action import.
 *
 * Dedicated, isolated path (never the generic products/sales tail): each
 * add/create/sale is committed by stockActionCommit.ts's own atomic,
 * idempotent, oversell-proof writer, so this function only has to CLASSIFY,
 * GROUP, and dispatch -- it never writes stock tables itself.
 *
 * Why a single whole-sheet pass rather than the chunked cursor every other
 * type uses: a sale's grouping is a function of the resolver's mode AND the
 * per-branch numbers (a blank-action reconcile drop is an inferred daily
 * sale), which a SQL `GROUP BY` cannot reproduce. Windowing by any SQL key
 * would split an inferred receipt across two invocations; the second call's
 * extra lines would hit the writer's per-group idempotency seal and be
 * silently dropped -- exactly the data loss the whole feature exists to
 * prevent. So the sheet is classified together and grouped in memory, and
 * kept operator-scale by STOCK_ACTION_MAX_UNITS instead.
 */
export async function applyStockActionsJob(
  env: Env,
  db: D1Compat,
  jobId: string,
  policyJson: string | null,
  sw: ReturnType<typeof makeStopwatch>,
  queueLatencyMs: number | undefined,
): Promise<{ applied: number; failed: number }> {
  const startedAtMs = Date.now()
  // Same materialize-first contract as the generic apply path: this
  // self-enqueues and returns 'still working' until every raw row is in
  // import_job_source_rows, so this invocation just acks with 0/0.
  const stillMaterializing = await ensureSourceRowsMaterialized(env, db, jobId, 'apply')
  if (stillMaterializing) {
    sw.lap('materializeChunkMs')
    return { applied: 0, failed: 0 }
  }

  const decisions = getDecisionMap(policyJson)
  const rowCount = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get<{ n: number }>({ id: jobId })
  if (Number(rowCount?.n || 0) > STOCK_ACTION_MAX_ROWS) {
    throw new Error(`This stock import has ${Number(rowCount?.n || 0)} rows; split it into files of at most ${STOCK_ACTION_MAX_ROWS} rows before importing.`)
  }
  const rows = await readAllMaterializedRows(db, jobId, decisions)
  const totalUnits = rows.length
  if (!totalUnits) throw new Error('No CSV file uploaded for this job')
  sw.lap('fetchAndParseMs')

  const results = (await classifyRows(db, 'stock_actions', rows, jobId, policyJson)) as StockActionImportResult[]
  sw.lap('classifyChunkMs')
  const resolvedOf = (r: StockActionImportResult) => r.data as unknown as UnifiedStockResolvedRow

  // A sale receipt is all-or-nothing. A blocked line (bad data / unresolved
  // identity) has no plan and therefore no saleGroupKey of its own, so its
  // valid siblings would otherwise commit a PARTIAL receipt. Re-derive the
  // group key a blocked row WOULD have had (from its own date + action) and
  // poison that group so the whole receipt is failed together, never split.
  const poisoned = new Set<string>()
  for (const r of results) {
    const resolved = resolvedOf(r)
    if (r.action !== 'error' && resolved.plan) continue
    const parsed = parseStockAction(resolved.action)
    if (parsed.kind === 'sale' && resolved.date) poisoned.add(saleGroupKeyFor(resolved.date, parsed.saleOrdinal))
  }

  // Partition the actionable rows into sale groups (rows sharing a
  // saleGroupKey = one receipt) and singles (each create/add/noop row).
  const saleGroups = new Map<string, StockActionImportResult[]>()
  const singles: StockActionImportResult[] = []
  for (const r of results) {
    const plan = resolvedOf(r).plan
    if (r.action === 'error' || !plan) continue // already a failure; persisted as-is
    if (plan.kind === 'sale' && plan.saleGroupKey) {
      const list = saleGroups.get(plan.saleGroupKey) || []
      list.push(r)
      saleGroups.set(plan.saleGroupKey, list)
    } else {
      singles.push(r)
    }
  }

  const unitCount = saleGroups.size + singles.length
  if (unitCount > STOCK_ACTION_MAX_UNITS) {
    throw new Error(`This stock import resolves to ${unitCount} actions; split it into files of at most ${STOCK_ACTION_MAX_UNITS} actions before importing.`)
  }

  const fail = (r: StockActionImportResult, message: string) => { r.action = 'error'; r.message = message }

  // --- Single rows: create / add / noop -----------------------------------
  for (const r of singles) {
    const resolved = resolvedOf(r)
    const plan = resolved.plan!
    if (plan.kind === 'noop') { r.action = 'skip'; continue }
    const branchNameById = new Map(resolved.branchRefs.map((ref) => [ref.branchId, ref.branchName]))
    try {
      let productId = resolved.productId ?? 0
      if (plan.kind === 'create') {
        const ensured = await ensureUnifiedStockProduct(db, {
          jobId,
          identityKey: resolved.identityKey,
          productName: resolved.productName,
          barcode: resolved.barcode || null,
          sellingPriceUsd: resolved.sellingPriceUsd,
          vipPriceUsd: resolved.vipPriceUsd,
          costPriceUsd: resolved.costPriceUsd,
        })
        productId = ensured.productId
        r.existingId = productId
      }
      if (!(productId > 0)) { fail(r, 'Could not resolve the product for this row.'); continue }
      // A create is an add that also inserts the product; both dispatch the
      // row's positive per-branch quantities through the same atomic writer.
      const adds = plan.branchActions.filter((a) => a.direction === 'add' && a.quantity > 0)
      for (const add of adds) {
        await applyUnifiedStockAdd(db, {
          jobId,
          rowNumber: resolved.rowNumber,
          productId,
          productName: resolved.productName,
          branchId: add.branchId,
          branchName: branchNameById.get(add.branchId) || '',
          quantity: add.quantity,
          date: resolved.date,
          batchLabel: resolved.batchLabel,
          sellingPriceUsd: resolved.sellingPriceUsd,
          vipPriceUsd: resolved.vipPriceUsd,
          costPriceUsd: resolved.costPriceUsd,
        })
      }
    } catch (error) {
      fail(r, error instanceof Error ? error.message : 'Stock action failed')
    }
  }

  // --- Sale groups: one atomic receipt each -------------------------------
  for (const [saleGroupKey, groupRows] of saleGroups) {
    if (poisoned.has(saleGroupKey)) {
      for (const r of groupRows) fail(r, 'This sale group has a line that could not be resolved; a receipt is never imported partially — fix or remove that line, then re-import.')
      continue
    }
    const first = resolvedOf(groupRows[0])
    const lines: UnifiedStockSaleLine[] = []
    for (const r of groupRows) {
      const resolved = resolvedOf(r)
      const branchNameById = new Map(resolved.branchRefs.map((ref) => [ref.branchId, ref.branchName]))
      // A single sheet row may sell from both branches; each becomes its own
      // sale line so the writer's FIFO/oversell guard runs per branch.
      for (const sale of resolved.plan!.branchActions) {
        if (sale.direction !== 'sale' || sale.quantity <= 0) continue
        lines.push({
          rowNumber: resolved.rowNumber,
          productId: resolved.productId ?? 0,
          productName: resolved.productName,
          branchId: sale.branchId,
          branchName: branchNameById.get(sale.branchId) || '',
          quantity: sale.quantity,
          sellingPriceUsd: Number(resolved.sellingPriceUsd ?? 0),
          costPriceUsd: resolved.costPriceUsd,
          batchLabel: resolved.batchLabel,
        })
      }
    }
    if (!lines.length) { for (const r of groupRows) { r.action = 'skip' } continue }
    try {
      await applyUnifiedStockSale(db, { jobId, saleGroupKey, date: first.date, lines })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sale group failed'
      for (const r of groupRows) fail(r, message)
    }
  }
  sw.lap('buildAndWriteStatementsMs')

  await persistChunkResults(db, jobId, 'apply', results)

  // Stock actions touch products (new rows, aggregate stock), inventory
  // (branch/batch stock, movements) and sales (imported receipts) -- refresh
  // every surface that reads them, same fire-and-forget pattern the generic
  // path uses on its last chunk.
  await bumpVersion(env, 'products').catch(() => {})
  await broadcast(env, 'products', { action: 'import', jobId }).catch(() => {})
  await broadcast(env, 'inventory', { action: 'import', jobId }).catch(() => {})
  await broadcast(env, 'sales', { action: 'import', jobId }).catch(() => {})
  sw.lap('cacheInvalidateMs')

  const outcome = await finalizeImportApply(db, jobId, totalUnits, startedAtMs, sw.marks, queueLatencyMs, 0)
  console.log('[import-timing] stock-action apply done', jobId, outcome)
  return outcome
}

// D1 has its own per-transaction CPU-time budget, separate from the Worker's
// own cpu_ms limit. db.batch() sends every statement as ONE atomic SQLite
// transaction (see db.ts) -- fine for a small edit, but a large products
// import can produce up to 3 statements per row (INSERT/UPDATE + branch_stock
// upsert + stock_quantity aggregate recompute), so an 11,896-row import was
// building a single ~35,000-statement transaction. That blew past D1's CPU
// budget and came back as "D1_ERROR: D1 DB exceeded its CPU time limit and
// was reset" -- the exact failure this fixes. Splitting into smaller
// sequential batches keeps each one comfortably inside the budget; this runs
// inside the queue consumer (queue.ts), not an HTTP request, so the extra
// wall-clock time from multiple round trips is not a problem.
// Trade-off: the whole import is no longer one atomic transaction -- a
// failure partway through leaves earlier chunks committed. That's still
// strictly better than today's behavior, where a CPU-limit reset can also
// leave partial writes (D1 resets the *connection*, not necessarily
// everything already flushed) with no way to finish the job at all.
const D1_IMPORT_BATCH_CHUNK_SIZE = 300 // statements per db.batch() call, not rows -- a products row can be 1-3 statements, so this is roughly 100-300 rows/chunk depending on import type. Lower this further if very large imports still hit the CPU-time error.

// onChunkDone (optional) fires after each chunk commits, with how many of
// the total statements are done so far -- used by runImportApply's main
// apply call to write a real, growing import_jobs.processed_rows as the
// import proceeds instead of only at the very end. Statement count is
// converted to an approximate row count by the caller (a row can be 1-3
// statements, so this is proportional, not exact -- still monotonically
// increasing and correct at completion, which is what the tracker's
// progress bar needs).
export function isD1CpuLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /CPU time limit|D1_ERROR/i.test(message)
}

export async function runD1BatchInChunks(
  db: D1Compat,
  statements: Array<{ sql: string; params: Record<string, unknown> }>,
  chunkSize: number = D1_IMPORT_BATCH_CHUNK_SIZE,
  onChunkDone?: (doneStatements: number, totalStatements: number) => Promise<void> | void,
): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += chunkSize) {
    const chunk = statements.slice(offset, offset + chunkSize)
    try {
      await db.batch(chunk)
    } catch (error) {
      // D1_IMPORT_BATCH_CHUNK_SIZE is a fixed guess at what fits the CPU
      // budget -- it's usually right, but a chunk with an unusually
      // write-heavy mix of statements (e.g. more branch_stock upserts than
      // typical) can still blow it. Rather than let that fail the whole
      // job (leaving whatever's already committed stranded and forcing a
      // full retry-from-scratch of this window), split just this
      // over-budget chunk in half and retry each half -- bounded to a few
      // splits so a chunk that's failing for some other reason doesn't
      // spin recursively down to batches of size 1.
      if (!isD1CpuLimitError(error) || chunk.length <= 1) throw error
      const mid = Math.ceil(chunk.length / 2)
      const firstHalf = chunk.slice(0, mid)
      const secondHalf = chunk.slice(mid)
      // chunkSize = the half's own length, so each half is attempted as a
      // single batch first and only splits further (recursively) if it
      // fails again -- not pre-split down to 1 up front.
      await runD1BatchInChunks(db, firstHalf, firstHalf.length, onChunkDone ? (done) => onChunkDone(offset + done, statements.length) : undefined)
      await runD1BatchInChunks(db, secondHalf, secondHalf.length, onChunkDone ? (done) => onChunkDone(offset + mid + done, statements.length) : undefined)
      continue
    }
    if (onChunkDone) await onChunkDone(Math.min(offset + chunk.length, statements.length), statements.length)
  }
}

// Chunked + resumable, mirroring runImportAnalyze above -- see migration
// 0011's header. Reclassifies each window fresh against LIVE database
// state (not analyze's cached results) because decisions/policy_json can
// change after the last analyze, same reasoning the original single-shot
// version already documented. A useful side effect of reclassifying
// against live state per chunk: a product/contact/branch an EARLIER chunk
// of this same run just created is already committed and visible to a
// LATER chunk's classify pass, so it naturally resolves as an update
// instead of a duplicate create -- no separate cross-chunk dedup bookkeeping
// needed beyond the existing in-window same-batch dedup below (which only
// has to cover duplicates within one ~150-row window, same as it always
// covered duplicates within one batch).
export async function runImportApply(env: Env, jobId: string, queueLatencyMs?: number): Promise<{ applied: number; failed: number }> {
  const db = getDb(env)
  const sw = makeStopwatch()
  const jobRow = await db.prepare(`SELECT status, cancel_requested, started_at FROM import_jobs WHERE id = @id`).get<{ status: string; cancel_requested: number; started_at: string | null }>({ id: jobId })
  if (!jobRow) throw new Error('Import job not found')
  // See runImportAnalyze's identical check + isFreshImportRun's comment --
  // a crashed chunk's retry lands here with status='failed' (markJobFailed
  // already ran before the re-throw), not 'applying', so that has to be
  // checked for explicitly rather than assumed to still look like a
  // continuation.
  const isFreshStart = isFreshImportRun(jobRow.status, 'applying')

  // Claim the job before touching a chunk. If another invocation holds it --
  // an at-least-once redelivery, or a retry overlapping the run it retries --
  // return without processing. Deliberately NOT an error: the holder is
  // making progress, so this message has nothing left to do and must ack
  // rather than retry, or it would spin against a healthy run.
  const leaseToken = await acquireImportLease(db, jobId)
  if (!leaseToken) {
    console.log('[import] skipping duplicate delivery; another invocation holds the lease', jobId)
    // Zero applied, zero failed -- honest for an invocation that did
    // nothing. The holder reports the real totals when it finishes.
    return { applied: 0, failed: 0 }
  }

  try {
    if (jobRow.status !== 'applying') {
      // Reclaim 'applying' status on every entry that isn't already an
      // in-progress continuation -- see runImportAnalyze's identical block
      // for why (covers both a genuine fresh start and a resume after a
      // transient-error retry).
      await db.prepare(`UPDATE import_jobs SET status = 'applying', phase = 'applying', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
    }
    if (isFreshStart) {
      await resetChunkState(db, jobId, 'apply')
    }
    if (jobRow.cancel_requested) {
      await db.prepare(`UPDATE import_jobs SET status = 'cancelled', phase = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: jobId })
      return { applied: 0, failed: 0 }
    }

    const job = await db.prepare(`SELECT type, policy_json FROM import_jobs WHERE id = @id`).get<{ type: ImportType; policy_json: string | null }>({ id: jobId })
    if (!job) throw new Error('Import job not found')
    // Unified stock actions have their own dedicated, isolated apply path --
    // each add/sale/create is committed by stockActionCommit.ts's atomic,
    // idempotent, oversell-proof writer. It deliberately never reaches the
    // generic (products/sales-shaped) tail of this function below, which
    // would mutate sales tables with the wrong row shape. Returns here with
    // its own {applied, failed}; the lease is released in the shared finally.
    if (job.type === 'stock_actions') {
      return await applyStockActionsJob(env, db, jobId, job.policy_json, sw, queueLatencyMs)
    }

    const stillMaterializing = await ensureSourceRowsMaterialized(env, db, jobId, 'apply')
    if (stillMaterializing) {
      sw.lap('materializeChunkMs')
      console.log('[import-timing] apply materialize chunk', jobId, sw.marks)
      return { applied: 0, failed: 0 }
    }

    const totalRows = await db.prepare(`SELECT COUNT(*) AS n FROM import_job_source_rows WHERE job_id = @id`).get<{ n: number }>({ id: jobId })
    sw.lap('fetchAndParseMs') // now a COUNT + the getChunkState read below, not a full re-parse -- see ensureSourceRowsMaterialized above
    if (!totalRows?.n) throw new Error('No CSV file uploaded for this job')
    const { cursor, state } = await getChunkState(db, jobId)
    const decisions = getDecisionMap(job.policy_json)

    // Same SQL windowing the analyze path uses -- only this chunk's groups,
    // not the whole file re-partitioned on every invocation.
    const isSalesJob = job.type === 'sales'
    const totalUnits = isSalesJob ? await countSalesGroups(db, jobId) : totalRows.n
    const groupEntries = isSalesJob
      ? await readSalesGroupWindow(db, jobId, decisions, cursor, ROWS_PER_IMPORT_CHUNK)
      : null

    let imageMatchCache = state.imageMatch
    if (job.type === 'products' && !imageMatchCache && shouldWireImages(job.policy_json)) {
      const allRows = await readAllMaterializedRows(db, jobId, decisions)
      imageMatchCache = await computeAndCacheImageMatch(db, jobId, allRows, job.policy_json, cursor, state)
    }

    // Auto-rename matched images now that this job is actually committing
    // (analyze already showed the plan for review; apply is the point a
    // match becomes final). Renames are keyed by fileId, global to the
    // job -- not row-window-scoped -- so this only needs to run once, on
    // this run's first chunk, not repeated per window.
    if (isFreshStart && job.type === 'products' && imageMatchCache?.hasRenamePlan) {
      // Read here rather than carried in chunk state: this runs on the first
      // chunk only, so serialising the whole plan on all ~58 of them paid for
      // something used once.
      const renamePlanEntries = await readImageRenamePlan(db, jobId)
      const renameRows = await db.prepare(`SELECT id, file_asset_id FROM import_job_files WHERE job_id = @jobId AND kind = 'image'`).all<{ id: number; file_asset_id: number | null }>({ jobId })
      const fileAssetByJobFileId = new Map(renameRows.map((r) => [r.id, r.file_asset_id]))
      const renameStatements: Array<{ sql: string; params: Record<string, unknown> }> = []
      for (const [fileId, newName] of renamePlanEntries) {
        renameStatements.push({
          sql: `UPDATE import_job_files SET original_name = @name WHERE id = @id`,
          params: { id: fileId, name: newName },
        })
        const assetId = fileAssetByJobFileId.get(Number(fileId))
        if (assetId) {
          renameStatements.push({
            sql: `UPDATE file_assets SET original_name = @name WHERE id = @id`,
            params: { id: assetId, name: newName },
          })
        }
      }
      if (renameStatements.length) await runD1BatchInChunks(db, renameStatements)
    }
    sw.lap('imageRenameMs')

    // Already windowed by readSalesGroupWindow's LIMIT/OFFSET -- slicing by
    // `cursor` again here would window it twice and skip whole receipts.
    const windowEntries = groupEntries
    const windowRows = windowEntries ? windowEntries.flatMap(([, rows]) => rows) : await readMaterializedWindow(db, jobId, cursor, ROWS_PER_IMPORT_CHUNK, decisions)
    const windowUnitCount = windowEntries ? windowEntries.length : windowRows.length
    const groupIndexByRowNumber = windowEntries
      ? new Map(windowEntries.flatMap(([, rows], i) => rows.map((r) => [r._rowNumber, cursor + i] as const)))
      : undefined

    const rowImagePaths = imageMatchCache ? await readRowImagePaths(db, jobId, windowRows) : undefined
    const results = job.type === 'products'
      ? await classifyProducts(db, windowRows, jobId, job.policy_json, rowImagePaths)
      : await classifyRows(db, job.type, windowRows, jobId, job.policy_json)
    sw.lap('classifyChunkMs')

    // Replace mode (column-level) -- job-level choice, computed once per
    // chunk rather than re-parsed per row. Only meaningful for a products
    // job; every other job type keeps its existing per-row plannedMode
    // behavior untouched, same scoping 'replace_all' already uses just
    // below in this same function.
    const productImportMode = job.type === 'products' ? getProductImportMode(job.policy_json) : 'merge'
    const productReplaceColumns = productImportMode === 'replace_columns' ? getProductImportReplaceColumns(job.policy_json) : []

    for (const result of results) {
      const decision = decisions[String(result.rowNumber)]
      if (decision?.action === 'skip') result.action = 'skip'
    }

    const actionable = results.filter((r) => r.action === 'create' || r.action === 'update')
    if (job.type === 'products' || job.type === 'inventory' || job.type === 'sales') {
      await resolveAndCreateBranches(db, actionable)
      // resolveAndCreateBranches only writes the resolved id onto the row's
      // own data.branch_id (see its comment) -- classifySales' line items
      // are nested one level deeper (data.items[]), each carrying its own
      // copy of the same order-level branch_id (see classifySales' "mirrors
      // the order's single branch column" comment), so that copy needs the
      // same resolution mirrored onto it explicitly.
      if (job.type === 'sales') {
        for (const r of actionable) {
          const d = r.data as Record<string, unknown> & { branch_id: number | null; items: Array<Record<string, unknown>> }
          for (const item of d.items) item.branch_id = d.branch_id
        }
      }
    }
    sw.lap('resolveBranchesMs')

    const statements: Array<{ sql: string; params: Record<string, unknown> }> = []
    const nowIso = new Date().toISOString()

    if (job.type === 'products') {
      // New product ids are pre-allocated here (rather than relying on
      // last_insert_rowid() inside the batch) because D1's batch() sends
      // every statement to run atomically as one transaction, but doesn't
      // document per-statement last_insert_rowid() visibility across that
      // batch the way a single sequential SQLite connection would -- see
      // db.ts's own "no interleaving reads and writes" comment on batch().
      // Pre-allocating avoids depending on that and keeps this a single
      // atomic batch (needed for import speed -- no per-row awaits).
      // Scoped to THIS chunk's actionable rows -- a duplicate against an
      // EARLIER chunk's row is already caught above (fresh classify sees
      // the earlier chunk's committed insert as an existing match), so
      // this in-batch map only needs to catch duplicates within the
      // current ~150-row window, exactly like it always caught duplicates
      // within one batch pre-chunking.
      const createRows = actionable.filter((r) => !(r.action === 'update' && r.existingId))
      let nextProductId = 0
      if (createRows.length) {
        const maxIdRow = await db.prepare(`SELECT COALESCE(MAX(id), 0) AS maxId FROM products`).get<{ maxId: number }>()
        nextProductId = maxIdRow?.maxId || 0
      }
      // Multi-branch stores' CSVs only ever name ONE branch per row (a
      // product's warehouse export names "Warehouse", its shop export names
      // "Shop" -- there's no per-row "and also 0 everywhere else" column).
      // Without this, a brand-new imported product ended up with a
      // branch_stock row ONLY at the branch its row happened to name --
      // every other active branch had no row at all, which every
      // branch-filtered view (Products/Inventory/POS) reads as "not
      // tracked here", not as "0 in stock here" (see
      // seedBranchStockForNewProduct in productWrites.ts, which already
      // fixes this same gap for the manual Add Product form -- this
      // mirrors that fix for the bulk-import create path, which never
      // called it). Fetched once per chunk, not per row -- resolveAndCreateBranches
      // above may just have created a brand-new branch this same chunk, so
      // this has to run after it, not reuse classifyProducts' earlier
      // snapshot.
      const allActiveBranchIds = createRows.length
        ? (await db.prepare(`SELECT id FROM branches WHERE is_active = 1`).all<{ id: number }>()).map((b) => b.id)
        : []
      // Same pre-allocation reasoning as nextProductId above, for the
      // product_batches row each new-product-with-stock create statement
      // below also inserts -- see that statement's own comment for why a
      // batch record gets created at all.
      let nextBatchId = 0
      // 'merge_stock'/'override_add' update rows (see the write loop below)
      // also insert a product_batches row, same pre-allocation reasoning as
      // the create path -- so they need to be counted here too, not just
      // createRows.length, or two such rows in the same chunk would both
      // try to claim the same next id.
      const updateRowsNeedingBatch = actionable.filter((r) => r.action === 'update' && r.existingId && (r.plannedMode === 'merge_stock' || r.plannedMode === 'override_add'))
      if (createRows.length || updateRowsNeedingBatch.length) {
        const maxBatchIdRow = await db.prepare(`SELECT COALESCE(MAX(id), 0) AS maxId FROM product_batches`).get<{ maxId: number }>()
        nextBatchId = maxBatchIdRow?.maxId || 0
      }
      // Lot-code matching for restocks of EXISTING products, mirroring
      // lib/productBatches.ts's receiveBatchStock "same product + same
      // normalized lot code tops up the same row" rule. Previously the
      // merge_stock/override_add branch below always inserted a brand-new
      // product_batches row keyed by a generated `import:<id>:<ts>:<row>`
      // batch_key -- lot_code was carried on the row and stored, but never
      // used to look anything up, so re-importing the same named batch
      // (e.g. "Batch 12") for a product that already has it created a
      // second, duplicate batch instead of topping up the existing one and
      // refreshing its received date, unlike every other batch-receiving
      // path in the app (the manual Receive Stock modal, the mandatory
      // add-stock picker). Only fetched when there's at least one
      // lot-code-carrying update row worth matching, and only active
      // batches (a deactivated lot shouldn't silently reappear via import
      // any more than it should via a manual receive -- receiveBatchStock
      // itself DOES reactivate on an explicit id/lot match, so this mirrors
      // that by reactivating on match below, same as a manual restock of a
      // previously-emptied lot would).
      const lotMatchCandidates = updateRowsNeedingBatch.filter((r) => str((r.data as Record<string, unknown>).lot_code))
      const batchByProductAndLot = new Map<string, { id: number; received_at: string | null }>()
      if (lotMatchCandidates.length) {
        const existingBatches = await db
          .prepare(`SELECT id, variant_product_id, lot_code, received_at FROM product_batches WHERE is_active = 1 AND lot_code IS NOT NULL AND lot_code != ''`)
          .all<{ id: number; variant_product_id: number; lot_code: string | null; received_at: string | null }>()
        for (const batch of existingBatches) {
          if (!str(batch.lot_code)) continue
          batchByProductAndLot.set(`${batch.variant_product_id}\u0001${lower(batch.lot_code)}`, { id: batch.id, received_at: batch.received_at })
        }
      }
      const inBatchSignatureToId = new Map<string, number>()
      for (const r of createRows) {
        const d = r.data as Record<string, unknown> & { branch_id: number | null }
        const signature = productImportRowSignature(d as unknown as ProductImportSignatureInput)
        const earlierId = inBatchSignatureToId.get(signature)
        if (earlierId != null) {
          r.action = 'update'
          r.existingId = earlierId
          continue
        }
        nextProductId += 1
        inBatchSignatureToId.set(signature, nextProductId)
        d.__importAssignedId = nextProductId
      }
      for (const r of actionable) {
        const d = r.data as Record<string, unknown> & { branch_id: number | null; branch_id_explicit: number }
        // Populates the same name_normalized/unit_normalized/brand_compact
        // columns lib/productWrites.ts's insertRow/updateRow compute for
        // the manual Add/Edit-product path (see migrations/0037_product_
        // search_compact_columns.sql and that file's own comment) -- bulk
        // import writes products via its own hand-built SQL statements
        // below rather than insertRow/updateRow, so it needs this same
        // computation done once here, up front, before any of the
        // per-mode branches spread `d` into a statement's params. Every
        // exhaustive-column UPDATE/INSERT below already lists every
        // products column by name in its own SQL text (@name_normalized
        // etc. added alongside @name/@brand/@unit); the narrower
        // column-level replace_columns branch only includes it if the
        // operator actually selected name/brand/unit for that column-set,
        // matching that branch's own "only touch what was selected"
        // contract.
        d.name_normalized = normalizeSearchText(d.name)
        d.unit_normalized = normalizeSearchText(d.unit)
        d.brand_compact = compactSearchText(d.brand)
        if (r.action === 'update' && r.existingId) {
          const mode = r.plannedMode
          if (productImportMode === 'fill_blank') {
            // 'fill_blank' mode (see ProductImportMode's doc comment):
            // `d` was already reconciled by applyFillBlankOnlyMode at
            // classify time -- every PRODUCT_REPLACE_COLUMNS field is
            // either the existing value (unchanged) or the CSV's value
            // (only where the existing one was blank), so this is the
            // same exhaustive UPDATE the default merge path below writes,
            // just with values already blank-filtered. The write-time
            // half of this mode's contract lives here, not just in the
            // data-shaping step: stock_quantity/branch_stock/
            // product_batches are deliberately never touched -- no
            // statement is pushed for them at all, regardless of what
            // this row's quantity column carries or whether the CSV named
            // an explicit branch -- since this mode exists specifically
            // so a supplementary "fill in the missing details" file can't
            // accidentally clobber stock via a stale/default quantity
            // column. Contrast with the legacy/default branch further
            // down, which does write branch_stock for an explicit-branch
            // row.
            statements.push({
              sql: `UPDATE products SET name=@name, name_normalized=@name_normalized, sku=@sku, barcode=@barcode, category=@category, categories=@categories, unit=@unit, unit_normalized=@unit_normalized, description=@description, brand=@brand, brands=@brands, brand_compact=@brand_compact, supplier=@supplier, selling_price_usd=@selling_price_usd, selling_price_khr=@selling_price_khr, special_price_usd=@special_price_usd, special_price_khr=@special_price_khr, cost_price_usd=@cost_price_usd, cost_price_khr=@cost_price_khr, low_stock_threshold=@low_stock_threshold, out_of_stock_threshold=@out_of_stock_threshold, discount_enabled=@discount_enabled, discount_type=@discount_type, discount_percent=@discount_percent, discount_amount_usd=@discount_amount_usd, discount_amount_khr=@discount_amount_khr, discount_label=@discount_label, discount_badge_color=@discount_badge_color, discount_starts_at=@discount_starts_at, discount_ends_at=@discount_ends_at, expiry_date=@expiry_date, expiry_alert_days=@expiry_alert_days, is_active=@is_active, updated_at=@updated_at${d.image_path ? ', image_path=@image_path' : ''} WHERE id=@id`,
              params: { ...d, id: r.existingId, updated_at: nowIso },
            })
            continue
          }
          if (productImportMode === 'replace_columns' && productReplaceColumns.length) {
            // Replace mode (column-level): a job-level choice, independent
            // of any per-row plannedMode -- only the operator-selected
            // columns are touched on a matched row; every other product
            // field, and stock/batches entirely, stay untouched. image_path
            // keeps the same "only if this row actually carries one" guard
            // the exhaustive override_replace UPDATE below uses, so
            // selecting the image column doesn't blank a matched product's
            // image just because this particular row's cell happened to be
            // empty.
            const setColumns = productReplaceColumns.filter((col) => col !== 'image_path' || d.image_path)
            if (setColumns.length) {
              // Keeps name_normalized/unit_normalized/brand_compact in
              // sync whenever the operator actually selected the source
              // column they derive from -- selecting 'name' but not
              // 'brand' must still refresh name_normalized without
              // touching brand_compact, matching this branch's own
              // "only touch what was selected" contract.
              const derivedColumns: Record<string, string> = { name: 'name_normalized', unit: 'unit_normalized', brand: 'brand_compact' }
              const allSetColumns = [...setColumns]
              for (const col of setColumns) {
                const derived = derivedColumns[col]
                if (derived && !allSetColumns.includes(derived)) allSetColumns.push(derived)
              }
              const setClause = allSetColumns.map((col) => `${col}=@${col}`).join(', ')
              const params: Record<string, unknown> = { id: r.existingId, updated_at: nowIso }
              for (const col of allSetColumns) params[col] = d[col]
              statements.push({
                sql: `UPDATE products SET ${setClause}, updated_at=@updated_at WHERE id=@id`,
                params,
              })
            }
            continue
          }
          // 'merge_stock' means "only touch quantity/batch, leave every
          // other product field alone" -- the reviewer picked this because
          // the row is a restock of a product whose name/price/etc. are
          // already correct on file and shouldn't be clobbered by whatever
          // this CSV happens to carry for those columns. Every other case
          // (no plannedMode, or 'override_add'/'override_replace') updates
          // fields, same exhaustive column list as before: deliberately
          // exhaustive across every products column the manual Add/Edit
          // form (ProductForm.tsx) can write, other than stock_quantity
          // (a cross-branch aggregate, handled separately below) and
          // image_gallery (a separate side table synced through
          // syncProductImageGallery -- CSV import still only ever sets the
          // single image_path).
          if (mode !== 'merge_stock') {
            statements.push({
              sql: `UPDATE products SET name=@name, name_normalized=@name_normalized, sku=@sku, barcode=@barcode, category=@category, categories=@categories, unit=@unit, unit_normalized=@unit_normalized, description=@description, brand=@brand, brands=@brands, brand_compact=@brand_compact, supplier=@supplier, selling_price_usd=@selling_price_usd, selling_price_khr=@selling_price_khr, special_price_usd=@special_price_usd, special_price_khr=@special_price_khr, cost_price_usd=@cost_price_usd, cost_price_khr=@cost_price_khr, low_stock_threshold=@low_stock_threshold, out_of_stock_threshold=@out_of_stock_threshold, discount_enabled=@discount_enabled, discount_type=@discount_type, discount_percent=@discount_percent, discount_amount_usd=@discount_amount_usd, discount_amount_khr=@discount_amount_khr, discount_label=@discount_label, discount_badge_color=@discount_badge_color, discount_starts_at=@discount_starts_at, discount_ends_at=@discount_ends_at, expiry_date=@expiry_date, expiry_alert_days=@expiry_alert_days, is_active=@is_active, updated_at=@updated_at${d.image_path ? ', image_path=@image_path' : ''} WHERE id=@id`,
              params: { ...d, id: r.existingId, updated_at: nowIso },
            })
          }

          if (mode === 'override_replace') {
            // Fields only, explicitly no stock/batch movement -- the
            // reviewer picked this because this row's stock_quantity
            // column isn't a real delta/count for this branch (e.g. a
            // catalog re-export that always echoes back whatever the
            // system already has) and writing it would misrepresent an
            // ordinary field correction as a stock change.
          } else if (mode === 'merge_stock' || mode === 'override_add') {
            // Both ADD to the branch's stock (never replace) and record a
            // batch/received-stock row, exactly like a manual Receive
            // Stock action would -- unlike the legacy/default branch
            // below, which replaces the branch's quantity outright and
            // never touches product_batches. Only fires when the CSV
            // named an explicit branch (same guard as the legacy path)
            // and actually carries a positive quantity to add; a zero/
            // blank quantity is a no-op, not a request to zero out stock.
            if (d.branch_id_explicit && d.branch_id != null && (d.stock_quantity as number) > 0) {
              statements.push({
                sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
                      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + excluded.quantity`,
                params: { id: r.existingId, branchId: d.branch_id, qty: d.stock_quantity },
              })
              statements.push({
                sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`,
                params: { id: r.existingId },
              })
              const importLotCode = str(d.lot_code)
              const lotKey = importLotCode ? `${r.existingId}\u0001${lower(importLotCode)}` : null
              const matchedBatch = lotKey ? batchByProductAndLot.get(lotKey) : null
              if (matchedBatch) {
                // Same lot code already exists (active) on this product --
                // top it up instead of creating a duplicate, and refresh
                // its received date to this import's, same as a manual
                // re-receive of the same lot would (receiveBatchStock
                // reactivates + lets a fresh call's fields override the
                // stored ones). Name/received-date now stay consistent
                // across every import that names the same batch, instead
                // of forking into a new unrelated row each time.
                statements.push({
                  sql: `UPDATE product_batches SET received_at = @receivedAt, is_active = 1, updated_at = @updatedAt WHERE id = @id`,
                  params: { id: matchedBatch.id, receivedAt: d.received_date, updatedAt: nowIso },
                })
                statements.push({
                  sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @qty)
                        ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')`,
                  params: { batchId: matchedBatch.id, branchId: d.branch_id, qty: d.stock_quantity },
                })
              } else {
                nextBatchId += 1
                const batchId = nextBatchId
                // batch_key mirrors receiveBatchStock's own rule: the lot
                // code itself when one was given (so the NEXT import or a
                // manual receive naming the same lot matches this row too,
                // not just this map's own in-memory lookup), otherwise a
                // generated key that can never collide with a real lot
                // code -- unnamed restocks each stay their own batch, same
                // as a lot-code-less manual receive always creating a new
                // one.
                statements.push({
                  sql: `INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number, created_at, updated_at)
                        VALUES (@batchId, @productId, @batchKey, @lotCode, NULL, @receivedAt, 1, @notes, (SELECT COALESCE(MAX(batch_number), 0) + 1 FROM product_batches WHERE variant_product_id = @productId), @createdAt, @createdAt)`,
                  params: {
                    batchId,
                    productId: r.existingId,
                    batchKey: importLotCode || `import:${r.existingId}:${nowIso}:${r.rowNumber}`,
                    lotCode: d.lot_code,
                    receivedAt: d.received_date,
                    notes: mode === 'merge_stock' ? 'Stock merged via product import' : 'Stock added via product import (override)',
                    createdAt: nowIso,
                  },
                })
                statements.push({
                  sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @qty)`,
                  params: { batchId, branchId: d.branch_id, qty: d.stock_quantity },
                })
                // Record it in the lookup so a second row in this same
                // chunk naming the same product+lot (e.g. two branches'
                // worth of the same batch in one CSV) tops this row up
                // too, instead of also missing the map (which was only
                // populated from rows already committed before this
                // chunk started) and creating yet another duplicate.
                if (importLotCode) {
                  batchByProductAndLot.set(`${r.existingId}\u0001${lower(importLotCode)}`, { id: batchId, received_at: d.received_date as string })
                }
              }
            }
          } else {
            // Legacy/default: no plannedMode was set (every non-products
            // import, every row imported before this feature existed, or
            // any `_action` value this engine doesn't recognize as one of
            // the three modes above). Unchanged from the original
            // behavior -- REPLACES the named branch's quantity outright
            // (not an add) and never touches product_batches. Kept exactly
            // as-is so existing tests/imports that predate plannedMode
            // keep writing identically.
            //
            // NOTE: stock_quantity is intentionally NOT part of the
            // products UPDATE above. products.stock_quantity is a
            // cross-branch aggregate; a single CSV row only ever carries
            // one branch's count (see products-template-warehouse.csv vs
            // products-template-shop.csv, which import the *same* barcode
            // with two different stock_quantity values for two different
            // branches). Writing the CSV's stock_quantity straight onto
            // products here would let a later branch's import clobber an
            // earlier branch's total instead of merging with it. The real
            // aggregate is recomputed below from branch_stock after the
            // branch-specific row is written.
            if (d.branch_id_explicit && d.branch_id != null) {
              statements.push({
                sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
                      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`,
                params: { id: r.existingId, branchId: d.branch_id, qty: d.stock_quantity },
              })
            }
            // Re-derive the aggregate total from branch_stock every time
            // (not just when this row touched a branch) so any
            // pre-existing drift self-heals on the next import too. Runs
            // as a later statement in the same D1 batch, so it sees the
            // branch_stock write above -- statements in one batch execute
            // sequentially inside a single SQLite transaction.
            statements.push({
              sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`,
              params: { id: r.existingId },
            })
          }
        } else {
          const newId = d.__importAssignedId as number
          // Same exhaustive column list as the UPDATE branch above (see
          // its comment) so a brand-new imported product starts with the
          // same fields a manually-created one would, instead of leaving
          // special pricing/discount/expiry columns to bind as an
          // explicit NULL (which -- unlike simply omitting a column from
          // an INSERT -- overrides that column's own SQLite DEFAULT, e.g.
          // out_of_stock_threshold's 0 or discount_badge_color's
          // '#e11d48'). normalizeProductImportRow pre-fills those three
          // with the same defaults for exactly this reason.
          statements.push({
            sql: `INSERT INTO products (id, name, name_normalized, sku, barcode, category, categories, unit, unit_normalized, description, brand, brands, brand_compact, supplier, selling_price_usd, selling_price_khr, special_price_usd, special_price_khr, cost_price_usd, cost_price_khr, stock_quantity, low_stock_threshold, out_of_stock_threshold, discount_enabled, discount_type, discount_percent, discount_amount_usd, discount_amount_khr, discount_label, discount_badge_color, discount_starts_at, discount_ends_at, expiry_date, expiry_alert_days, is_active, image_path, created_at, updated_at) VALUES (@id, @name, @name_normalized, @sku, @barcode, @category, @categories, @unit, @unit_normalized, @description, @brand, @brands, @brand_compact, @supplier, @selling_price_usd, @selling_price_khr, @special_price_usd, @special_price_khr, @cost_price_usd, @cost_price_khr, @stock_quantity, @low_stock_threshold, @out_of_stock_threshold, @discount_enabled, @discount_type, @discount_percent, @discount_amount_usd, @discount_amount_khr, @discount_label, @discount_badge_color, @discount_starts_at, @discount_ends_at, @expiry_date, @expiry_alert_days, @is_active, @image_path, @created_at, @updated_at)`,
            params: { ...d, id: newId, image_path: d.image_path ?? null, created_at: nowIso, updated_at: nowIso },
          })
          // Every new product gets a branch_stock row -- explicit branch
          // column if the CSV had one, otherwise the org's default branch
          // (resolved in classifyProducts). This is the fix for imported
          // products silently ending up unassigned to any branch.
          if (d.branch_id != null) {
            statements.push({
              sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)
                    ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity`,
              params: { id: newId, branchId: d.branch_id, qty: d.stock_quantity },
            })
            // Keeps the same "aggregate = SUM(branch_stock)" invariant as
            // the update path above. For a brand-new product this is a
            // no-op today (one branch row = the CSV's own value), but it's
            // what protects a *second* file (re-importing the same barcode
            // for a different branch, which the update path turns into)
            // from ever depending on which import ran first.
            statements.push({
              sql: `UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id`,
              params: { id: newId },
            })
            // Give the initial stock a batch record so it shows up under
            // the Products page's "Created" filter (product_batches.
            // received_at -- see CreatedDateFilterOptions.tsx) the same
            // way manually-received stock does. Previously the import path
            // never touched product_batches at all, so an imported
            // product's stock had no received date on record and could
            // never match that filter. received_date (parsed above,
            // defaulting to today when the CSV column is blank) becomes
            // this batch's received_at, and lot_code is the same
            // date-derived code every other batch now gets (see
            // batchCode.ts's dateToBatchCode) -- no expiry from the CSV's
            // plain product columns though; this is a receipt record, not a
            // lot-tracked batch pick, and batch_number 1 is always correct
            // here since a brand-new product has no earlier batches to
            // count against (see productBatches.ts's nextBatchNumber,
            // which would return the same 1 via an extra query this avoids).
            // Deliberately skips receiveBatchStock() itself: that helper
            // also writes branch_batch_stock/branch_stock/products.
            // stock_quantity as one atomic three-way update, which would
            // double the quantity on top of the branch_stock insert and
            // aggregate recompute already queued above.
            nextBatchId += 1
            const batchId = nextBatchId
            statements.push({
                sql: `INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number, created_at, updated_at)
                      VALUES (@batchId, @productId, @batchKey, @lotCode, NULL, @receivedAt, 1, @notes, 1, @createdAt, @createdAt)`,
                params: {
                  batchId,
                  productId: newId,
                  batchKey: `import:${newId}:${nowIso}`,
                  lotCode: d.lot_code,
                  receivedAt: d.received_date,
                  notes: 'Received via product import',
                  createdAt: nowIso,
                },
            })
            statements.push({
                sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@batchId, @branchId, @qty)`,
                params: { batchId, branchId: d.branch_id, qty: d.stock_quantity },
            })
            // Seed every OTHER active branch at 0 (tracked, not absent) --
            // see allActiveBranchIds' own comment above for why. Runs
            // AFTER the chosen branch's real-quantity insert above, and
            // uses ON CONFLICT DO NOTHING rather than DO UPDATE: if a
            // later row in this same chunk names one of these branches for
            // the SAME product (an in-batch duplicate merged into this
            // product a few statements below, via inBatchSignatureToId),
            // that later statement must be the one that wins with the
            // real quantity -- this seed must never fire after it and
            // stomp a real value back down to 0. Statements in one D1
            // batch execute sequentially, so "pushed earlier" is
            // guaranteed to mean "applied first" here.
            for (const branchId of allActiveBranchIds) {
              if (branchId === d.branch_id) continue
              statements.push({
                sql: `INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 0)
                      ON CONFLICT(product_id, branch_id) DO NOTHING`,
                params: { id: newId, branchId },
              })
            }
          }
        }
      }
    } else if (job.type === 'customers' || job.type === 'suppliers' || job.type === 'delivery_contacts') {
      const table = job.type
      const columns = table === 'customers'
        ? ['name', 'phone', 'address', 'notes', 'email', 'membership_number', 'gender']
        : table === 'suppliers'
          ? ['name', 'phone', 'address', 'notes', 'email', 'company', 'contact_person', 'gender']
          : ['name', 'phone', 'address', 'notes', 'area', 'gender']
      for (const r of actionable) {
        const d = r.data as Record<string, unknown>
        if (r.action === 'update' && r.existingId) {
          const assignments = columns.map((c) => `"${c}"=@${c}`).join(', ')
          statements.push({ sql: `UPDATE "${table}" SET ${assignments}, updated_at=@updated_at WHERE id=@id`, params: { ...d, id: r.existingId, updated_at: nowIso } })
        } else {
          const cols = [...columns, 'created_at', 'updated_at']
          statements.push({
            sql: `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
            // `created_at` on a new row honors an imported date (all three
            // contact tables -- see classifyContacts' own shared
            // `data.created_at`, sourced from the CSV's Created/
            // created_date/created_at/join_date/date_joined column) so
            // historical join/creation dates carry over on import instead
            // of every imported contact silently getting "now".
            // `d.created_at` is spread first, then overridden by `nowIso`
            // only when the row didn't supply one -- explicit order matters
            // here (a bare `{ ...d, created_at: nowIso }` would always win
            // regardless of what the CSV had, the same class of bug part 68
            // found in classifyProducts).
            params: { ...d, created_at: (d.created_at as string | null | undefined) || nowIso, updated_at: nowIso },
          })
        }
      }
    } else if (job.type === 'inventory') {
      for (const r of actionable) {
        const d = r.data as Record<string, unknown> & { cost_price_usd?: number; cost_price_khr?: number }
        statements.push({
          sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at) VALUES (@product_id, @product_name, @branch_id, @branch_name, @movement_type, @quantity, @reason, @created_at)`,
          // Honor an imported date (classifyInventory's `movementDate`,
          // spread in via `d.created_at`) when the row supplied one;
          // `nowIso` is only the fallback for a blank/unparseable cell.
          // `d` is spread first, then the fallback applied only when
          // `d.created_at` is falsy -- a bare `{ ...d, created_at: nowIso }`
          // would always win regardless of what the CSV had, the same
          // ordering bug already called out for classifyProducts/
          // classifyContacts elsewhere in this file.
          params: { ...d, created_at: (d.created_at as string | null | undefined) || nowIso },
        })
        statements.push({
          sql: `UPDATE products SET stock_quantity = stock_quantity + @delta, updated_at = @updated_at WHERE id = @id`,
          params: { delta: (d as { signedQuantity: number }).signedQuantity, id: d.product_id, updated_at: nowIso },
        })
        // 'add' rows only -- classifyInventory only ever sets these two
        // fields when a unit cost was actually given in the file.
        if (d.cost_price_usd != null || d.cost_price_khr != null) {
          statements.push({
            sql: `UPDATE products SET ${d.cost_price_usd != null ? 'cost_price_usd = @usd' : ''}${d.cost_price_usd != null && d.cost_price_khr != null ? ', ' : ''}${d.cost_price_khr != null ? 'cost_price_khr = @khr' : ''}, updated_at = @updated_at WHERE id = @id`,
            params: { usd: d.cost_price_usd, khr: d.cost_price_khr, id: d.product_id, updated_at: nowIso },
          })
        }
      }
    }

    if (statements.length) await runD1BatchInChunks(db, statements)
    sw.lap('buildAndWriteStatementsMs')

    // Each reviewed receipt is one idempotent D1 transaction: header,
    // items, return-restock writes, and its commit marker either all land
    // or all roll back. The deterministic client_request_id resolves the
    // parent id inside SQL, removing the concurrency-unsafe "latest N sale
    // ids" lookup that could attach one user's lines to another sale.
    if (job.type === 'sales' && actionable.length) {
      // Loyalty accrual is the operator's import-time choice (default OFF for
      // historical data). Read it once per chunk from the reviewed policy.
      const accrueLoyalty = getSalesImportAccrueLoyalty(job.policy_json)
      for (const r of actionable) {
        await applyHistoricalSaleImport(db, {
          jobId,
          rowNumber: r.rowNumber,
          data: r.data as Record<string, unknown> & { items: Array<Record<string, unknown>>; sale_status: string; receipt_number: string | null; created_at: string | null },
          nowIso,
          accrueLoyalty,
        })
      }
    }
    sw.lap('salesItemsMs')

    await persistChunkResults(db, jobId, 'apply', results, groupIndexByRowNumber)
    const chunkFailed = results.filter((r) => r.action === 'error').length
    const nextCursor = cursor + windowUnitCount

    if (nextCursor < totalUnits) {
      await saveChunkState(db, jobId, nextCursor, state)
      // + rather than = -- these accumulate across chunks (unlike
      // analyze's total_rows/processed_rows, which is one number computed
      // fresh each chunk from a stable denominator).
      await db.prepare(`UPDATE import_jobs SET processed_rows = processed_rows + @applied, failed_rows = failed_rows + @failed, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
        .run({ id: jobId, applied: actionable.length, failed: chunkFailed })
      console.log('[import-timing] apply chunk', jobId, { cursor, nextCursor, totalUnits, ...sw.marks })
      await env.IMPORT_QUEUE.send({ jobId, kind: 'apply' })
      return { applied: actionable.length, failed: chunkFailed }
    }

    // Replace-all mode: this import is the complete, current catalog --
    // every active product this run never touched (its updated_at is
    // still older than this run's own started_at) gets soft-deactivated,
    // same as products.ts's DELETE /:id (is_active=0, not a hard delete,
    // so any sale/movement/audit row that still references its id stays
    // valid). Runs exactly once, here at the true last chunk, after every
    // row across every chunk has already been written -- a row matched in
    // an earlier chunk already got its updated_at refreshed when it was
    // written, so it's correctly excluded here regardless of which chunk
    // processed it. Deliberately keyed off updated_at rather than a
    // separate "touched product ids" list: the existing per-row write
    // path already refreshes updated_at on every create/update
    // unconditionally (see the two UPDATE/INSERT statements above), so no
    // extra bookkeeping is needed to know what this run actually wrote.
    // A row an operator explicitly marked 'skip' during review never
    // reaches the write path, so its matched product (if any) is treated
    // the same as any other untouched product and gets deactivated too --
    // 'skip' means "don't act on this row", and under replace_all
    // semantics "not part of the new file's data" and "not acted on" are
    // the same thing; there's no separate "explicitly keep this out of
    // the replace" signal today.
    let deactivatedCount = 0
    if (job.type === 'products' && getProductImportMode(job.policy_json) === 'replace_all') {
      const cutoff = jobRow.started_at || nowIso
      const result = await db.prepare(
        `UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP
         WHERE is_active = 1 AND (updated_at IS NULL OR updated_at < @cutoff)`,
      ).run({ cutoff })
      deactivatedCount = result.changes || 0
    }

    // Last chunk: cache invalidation + broadcast, once, now that every
    // chunk has committed.
    //
    // Real gap found here: this only ever ran for 'products' | 'inventory'
    // | 'sales' -- a contacts import (customers/suppliers/delivery_contacts)
    // never broadcast anything at all, on any channel. Every other import
    // type tells other open tabs/devices (and, via Dashboard.tsx's
    // sync-channel effect, the dashboard's own Recent Imports card) that
    // something changed; contacts imports silently didn't, so a contacts
    // import finished in one tab (or via background polling) never live-
    // refreshed the Contacts pages or the dashboard card anywhere else --
    // matching the "recent imports" mapping this project actually keeps
    // (see routes/importJobs.ts's own permissionForType: contacts covers
    // exactly these three job types). Broadcasting on the specific
    // per-table channel (not a shared 'contacts' channel) matches how
    // Contacts.tsx's own three tabs already listen -- see
    // durable-objects/broadcastHub.ts's BroadcastChannel union, which has
    // 'customers'/'suppliers'/'deliveryContacts' as three distinct entries,
    // not one combined one.
    const CONTACT_IMPORT_CHANNEL: Record<string, 'customers' | 'suppliers' | 'deliveryContacts'> = {
      customers: 'customers',
      suppliers: 'suppliers',
      delivery_contacts: 'deliveryContacts',
    }
    if (job.type === 'products' || job.type === 'inventory' || job.type === 'sales') {
      // No ExecutionContext available here -- await directly rather than
      // waitUntil. This runs inside queue.ts's queue consumer, not an HTTP
      // response path, so there's no early-return race to avoid.
      await bumpVersion(env, 'products').catch(() => {})
      await broadcast(env, job.type === 'sales' ? 'sales' : job.type === 'inventory' ? 'inventory' : 'products', { action: 'import', jobId }).catch(() => {})
    } else if (CONTACT_IMPORT_CHANNEL[job.type]) {
      await broadcast(env, CONTACT_IMPORT_CHANNEL[job.type], { action: 'import', jobId }).catch(() => {})
    }
    sw.lap('cacheInvalidateMs')

    // Final status/counts/summary are computed once, in the shared
    // finalizeImportApply helper, from the persisted per-row results of
    // EVERY chunk (not just this last one) -- see runImportAnalyze's
    // finalize step for the same reasoning. Shared so the dedicated
    // stock-actions apply path can never disagree with this one.
    const outcome = await finalizeImportApply(db, jobId, totalUnits, state.startedAtMs, sw.marks, queueLatencyMs, deactivatedCount)
    console.log('[import-timing] apply done', jobId, outcome)
    return outcome
  } catch (error) {
    await markJobFailed(db, jobId, (error as Error).message || 'Apply failed')
    throw error
  } finally {
    // Released on EVERY exit, including the failure path. A failed chunk is
    // retried by the queue, and that retry must be able to claim the job
    // rather than waiting out a 60s lease held by an invocation that is
    // already gone. Token-guarded inside, so an invocation whose lease had
    // already expired and been taken cannot clear the new holder's.
    await releaseImportLease(db, jobId, leaseToken)
  }
}

export async function buildErrorsCsv(env: Env, jobId: string): Promise<string> {
  const db = getDb(env)
  const rows = await db.prepare(`SELECT row_number, file_name, code, message FROM import_job_errors WHERE job_id = @id ORDER BY row_number ASC`).all<{ row_number: number; file_name: string; code: string; message: string }>({ id: jobId })
  const header = 'row_number,file_name,code,message'
  const lines = rows.map((r) => [r.row_number, r.file_name, r.code, r.message].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
  return [header, ...lines].join('\n')
}
