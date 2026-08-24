// Row resolution for the dated stock-count import -- turns a raw parsed
// row (whatever the column-mapping step produced: a branch name, a
// product identifier of SOME kind, a count) into the resolved
// (productId, branchId) shape lib/datedStockCountRoute.ts's
// buildDatedStockCountPlan already expects. Kept separate from both the
// column-mapping step (still unbuilt -- needs a real CSV/XLSX header
// shape from the user, see datedStockCountImport.ts's own Part 239
// history, not guessable) and the plan computation itself, so this
// correctness-critical resolution logic (which existing product/branch a
// row's free-text identifiers actually match) can be tested against a
// real DB in isolation -- same reasoning datedStockCountRoute.ts's own
// header comment gives for splitting DB lookups from computation.
//
// Matching rules, deliberately mirroring conventions already established
// elsewhere in this app rather than inventing new ones:
// - Branch: exact case-insensitive name match against `branches`; no
//   match auto-creates a new active branch with that name -- the same
//   auto-create-on-miss behavior lib/importEngine.ts's own
//   resolveAndCreateBranches already applies for every other import in
//   this app. A dated stock count is reconciling a REAL branch's real
//   count -- a sheet naming a branch that doesn't exist yet is normally
//   because it's newly opened, not a typo (a typo is instead something a
//   human catches from the returned `branchesCreated` list before
//   confirming the import -- this function only reports what it did, it
//   doesn't ask first, same as resolveAndCreateBranches).
// - Product: SKU first (exact, case-insensitive), then barcode (exact),
//   then exact case-insensitive name -- same priority order
//   lib/importEngine.ts's classifyProducts already uses for matching an
//   incoming row against an existing product. A barcode shared by more
//   than one real product (a legitimate, already-handled case elsewhere
//   in this app -- see importEngine.ts's own barcode-collision comment)
//   is treated as ambiguous here, not silently resolved to either one.
//   Unlike branch, an unmatched product is NEVER auto-created --
//   variant/new-product creation for an unresolved row is real
//   product-catalog work with its own decisions (grouped/variant,
//   category, pricing) a stock-count reconciliation has no business
//   making unattended; those rows come back in `unresolved` for a human
//   to resolve, not silently dropped or guessed.
import type { D1Compat } from './db'
import { normalizeToIsoDate } from './batchCode'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface RawDatedCountRow {
  rowNumber: number
  date: string
  branchName: string
  // At least one of these should be present for a match to be possible;
  // all three may be, in which case sku wins, then barcode, then name
  // (see the file header for why this order).
  sku?: string | null
  barcode?: string | null
  productName?: string | null
  count: number
  // Optional, mirroring productImportPlanner.ts's own dual-currency
  // money-field convention (selling_price_usd/khr) rather than inventing
  // a new one -- a row's own count/received `date` already IS the batch
  // date this system uses (see batchCode.ts's dateToBatchCode and
  // datedStockCountImport.ts's plan computation, which already reads
  // `date` for batch matching -- no separate batch/received-date field
  // is needed here). These are read ONLY to surface a price conflict for
  // a human to resolve below; resolveDatedStockCountRows never writes a
  // price itself.
  sellingPriceUsd?: number | null
  sellingPriceKhr?: number | null
}

export interface ResolvedDatedCountRow {
  rowNumber: number
  date: string
  productId: number
  branchId: number
  count: number
  // Present only when the row carried a price AND it differs from the
  // matched product's stored price. Purely informational -- this
  // function never picks a side. 'merge' (keep the existing price, only
  // update stock -- the default a review screen should preselect, since
  // selling price stays adjustable at POS time regardless, same as any
  // other product) and 'apply_new' (overwrite the product's stored price
  // with the imported one) are the two choices a human makes on the
  // review screen; nothing here executes either.
  priceConflict?: {
    currentUsd: number
    currentKhr: number
    importedUsd: number | null
    importedKhr: number | null
    suggestedResolution: 'merge' | 'apply_new'
  }
}

export type UnresolvedReason = 'invalid_date' | 'invalid_count' | 'missing_branch' | 'missing_identifier' | 'product_not_found' | 'ambiguous_barcode' | 'ambiguous_name'

export interface UnresolvedDatedCountRow {
  rowNumber: number
  reason: UnresolvedReason
  raw: RawDatedCountRow
  // The branch this row's branchName already resolved to (or was
  // auto-created as), for reasons that only occur AFTER branch
  // resolution succeeds (product_not_found, ambiguous_barcode,
  // ambiguous_name). Carried through so a follow-up decision-applying
  // step (lib/datedStockCountDecisions.ts) never has to re-derive or
  // re-query it. Absent for the earlier-failing reasons (invalid_date,
  // invalid_count, missing_branch, missing_identifier), which never
  // reach branch resolution.
  branchId?: number
  // Options a review screen can offer for THIS row. Renamed from this
  // module's earlier 'create_variant' label to 'create_child' per the
  // user's own terminology call (this session) -- clearer than
  // "variant" for what it actually does: insert a new row locked to an
  // existing product's exact name, so this app's name-based grouping
  // picks it up as that product's child row. None of these are executed
  // here -- same "never auto-create a product" rule as the rest of this
  // file; a human picks one and lib/datedStockCountDecisions.ts's
  // apply-decisions endpoint acts on it.
  // - product_not_found: 'create_new' only -- nothing to link to.
  // - ambiguous_barcode / ambiguous_name: 'link_variant' (pick one of
  //   candidateProductIds to merge the count into, no new row) or
  //   'create_new' (the match was coincidental -- e.g. a barcode reused
  //   across an unrelated product -- so treat this row as a genuinely
  //   new, standalone item instead). 'create_child' (a new row grouped
  //   under one of the candidates) is also offered since a name/barcode
  //   collision is exactly the shape importEngine.ts already treats as
  //   a likely grouping relationship for other imports. A child row's
  //   name is always locked to the chosen candidate's name -- see
  //   datedStockCountDecisions.ts's own enforcement of this; a row that
  //   needs a genuinely different name is a 'create_new', not a child.
  suggestedActions: Array<'create_new' | 'link_variant' | 'create_child'>
  candidateProductIds?: number[]
}

function lower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export async function resolveDatedStockCountRows(
  db: D1Compat,
  rows: RawDatedCountRow[],
): Promise<{ resolved: ResolvedDatedCountRow[]; unresolved: UnresolvedDatedCountRow[]; branchesCreated: { id: number; name: string }[] }> {
  const unresolved: UnresolvedDatedCountRow[] = []

  // Pass 1: cheap, DB-free validation -- normalize the date, reject a
  // non-finite/negative count, reject a row with no product identifier
  // at all. Rows that fail here never reach the DB lookups below.
  const candidates: (RawDatedCountRow & { normalizedDate: string })[] = []
  for (const row of rows) {
    const normalizedDate = normalizeToIsoDate(row.date) || (ISO_DATE_RE.test(String(row.date ?? '')) ? String(row.date) : '')
    if (!normalizedDate) { unresolved.push({ rowNumber: row.rowNumber, reason: 'invalid_date', raw: row, suggestedActions: [] }); continue }
    if (!Number.isFinite(row.count) || row.count < 0) { unresolved.push({ rowNumber: row.rowNumber, reason: 'invalid_count', raw: row, suggestedActions: [] }); continue }
    if (!lower(row.branchName)) { unresolved.push({ rowNumber: row.rowNumber, reason: 'missing_branch', raw: row, suggestedActions: [] }); continue }
    if (!lower(row.sku) && !lower(row.barcode) && !lower(row.productName)) {
      unresolved.push({ rowNumber: row.rowNumber, reason: 'missing_identifier', raw: row, suggestedActions: [] })
      continue
    }
    candidates.push({ ...row, normalizedDate })
  }
  if (!candidates.length) return { resolved: [], unresolved, branchesCreated: [] }

  // ---- Branch resolution (auto-create on miss, see file header) ----
  const branchNamesByLower = new Map<string, string>() // lower(name) -> first-seen casing
  for (const row of candidates) {
    const key = lower(row.branchName)
    if (key && !branchNamesByLower.has(key)) branchNamesByLower.set(key, String(row.branchName).trim())
  }
  const branchIdByLower = new Map<string, number>()
  const branchesCreated: { id: number; name: string }[] = []
  for (const [lowerName, name] of branchNamesByLower) {
    const existing = await db.prepare(`SELECT id FROM branches WHERE lower(name) = @name LIMIT 1`).get<{ id: number }>({ name: lowerName })
    if (existing) { branchIdByLower.set(lowerName, Number(existing.id)); continue }
    const inserted = await db.prepare(`INSERT INTO branches (name, is_active) VALUES (@name, 1)`).run({ name })
    const newId = Number(inserted.lastInsertRowid)
    branchIdByLower.set(lowerName, newId)
    branchesCreated.push({ id: newId, name })
  }

  // ---- Product resolution: sku -> barcode -> exact name, same priority
  // order as importEngine.ts's classifyProducts ----
  const skus = [...new Set(candidates.map((r) => lower(r.sku)).filter(Boolean))]
  const barcodes = [...new Set(candidates.map((r) => lower(r.barcode)).filter(Boolean))]
  const names = [...new Set(candidates.map((r) => lower(r.productName)).filter(Boolean))]

  const bySku = new Map<string, number>()
  if (skus.length) {
    const inClause = skus.map((_, i) => `@s${i}`).join(', ')
    const params = Object.fromEntries(skus.map((s, i) => [`s${i}`, s]))
    const productRows = await db.prepare(`SELECT id, sku FROM products WHERE lower(sku) IN (${inClause})`).all<{ id: number; sku: string }>(params)
    for (const p of productRows) bySku.set(lower(p.sku), Number(p.id))
  }

  const byBarcode = new Map<string, number[]>() // multiple ids = ambiguous, mirrors importEngine.ts's own barcode-collision handling
  if (barcodes.length) {
    const inClause = barcodes.map((_, i) => `@b${i}`).join(', ')
    const params = Object.fromEntries(barcodes.map((b, i) => [`b${i}`, b]))
    const productRows = await db.prepare(`SELECT id, barcode FROM products WHERE lower(barcode) IN (${inClause})`).all<{ id: number; barcode: string }>(params)
    for (const p of productRows) {
      const key = lower(p.barcode)
      const bucket = byBarcode.get(key)
      if (bucket) bucket.push(Number(p.id))
      else byBarcode.set(key, [Number(p.id)])
    }
  }

  const byName = new Map<string, number[]>() // also tracked as multi -- an exact name match can legitimately collide (e.g. same product name across branches/variants), same "don't silently guess" rule as barcode
  if (names.length) {
    const inClause = names.map((_, i) => `@n${i}`).join(', ')
    const params = Object.fromEntries(names.map((n, i) => [`n${i}`, n]))
    const productRows = await db.prepare(`SELECT id, name FROM products WHERE lower(name) IN (${inClause})`).all<{ id: number; name: string }>(params)
    for (const p of productRows) {
      const key = lower(p.name)
      const bucket = byName.get(key)
      if (bucket) bucket.push(Number(p.id))
      else byName.set(key, [Number(p.id)])
    }
  }

  const matched: { row: RawDatedCountRow & { normalizedDate: string }; branchId: number; productId: number }[] = []
  for (const row of candidates) {
    const branchId = branchIdByLower.get(lower(row.branchName)) ?? null
    // Should be unreachable (every branch name was just resolved/created
    // above), but guard rather than crash on an unexpected empty name.
    if (branchId == null) { unresolved.push({ rowNumber: row.rowNumber, reason: 'missing_identifier', raw: row, suggestedActions: [] }); continue }

    const skuKey = lower(row.sku)
    const barcodeKey = lower(row.barcode)
    const nameKey = lower(row.productName)

    let productId: number | null = skuKey ? bySku.get(skuKey) ?? null : null

    if (productId == null && barcodeKey) {
      const matches = byBarcode.get(barcodeKey) || []
      if (matches.length > 1) {
        // Reused barcode across more than one real product -- offer the
        // same choices product-import conflicts already give: pick one
        // to merge into, group as a variant, or treat the row as a
        // genuinely new item (the collision may be coincidental data
        // entry, not a real relationship). Never guessed automatically.
        unresolved.push({ rowNumber: row.rowNumber, reason: 'ambiguous_barcode', raw: row, branchId, suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: matches })
        continue
      }
      if (matches.length === 1) productId = matches[0]
    }

    if (productId == null && nameKey) {
      const matches = byName.get(nameKey) || []
      if (matches.length === 1) {
        productId = matches[0]
      } else if (matches.length > 1) {
        // An exact name collision is exactly the shape importEngine.ts
        // already treats as a likely variant relationship for other
        // imports -- surface the same three choices as ambiguous_barcode
        // rather than guessing which of the same-named products this
        // count belongs to.
        unresolved.push({ rowNumber: row.rowNumber, reason: 'ambiguous_name', raw: row, branchId, suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: matches })
        continue
      }
      // 0 name matches falls through to product_not_found below.
    }

    if (productId == null) { unresolved.push({ rowNumber: row.rowNumber, reason: 'product_not_found', raw: row, branchId, suggestedActions: ['create_new'] }); continue }

    matched.push({ row, branchId, productId })
  }

  // ---- Price-conflict detection (informational only, see
  // ResolvedDatedCountRow's own header comment -- this function never
  // picks a side or writes a price) ----
  const priceById = new Map<number, { usd: number; khr: number }>()
  const matchedProductIds = [...new Set(matched.map((m) => m.productId))]
  if (matchedProductIds.length) {
    const inClause = matchedProductIds.map((_, i) => `@p${i}`).join(', ')
    const params = Object.fromEntries(matchedProductIds.map((id, i) => [`p${i}`, id]))
    const priceRows = await db.prepare(`SELECT id, selling_price_usd, selling_price_khr FROM products WHERE id IN (${inClause})`).all<{ id: number; selling_price_usd: number | null; selling_price_khr: number | null }>(params)
    for (const p of priceRows) priceById.set(Number(p.id), { usd: Number(p.selling_price_usd ?? 0), khr: Number(p.selling_price_khr ?? 0) })
  }

  const resolved: ResolvedDatedCountRow[] = []
  for (const { row, branchId, productId } of matched) {
    const out: ResolvedDatedCountRow = { rowNumber: row.rowNumber, date: row.normalizedDate, productId, branchId, count: row.count }

    const hasImportedPrice = row.sellingPriceUsd != null || row.sellingPriceKhr != null
    if (hasImportedPrice) {
      const current = priceById.get(productId) ?? { usd: 0, khr: 0 }
      const importedUsd = row.sellingPriceUsd != null && Number.isFinite(Number(row.sellingPriceUsd)) ? Number(row.sellingPriceUsd) : null
      const importedKhr = row.sellingPriceKhr != null && Number.isFinite(Number(row.sellingPriceKhr)) ? Number(row.sellingPriceKhr) : null
      const differs = (importedUsd != null && importedUsd !== current.usd) || (importedKhr != null && importedKhr !== current.khr)
      if (differs) {
        out.priceConflict = {
          currentUsd: current.usd,
          currentKhr: current.khr,
          importedUsd,
          importedKhr,
          // 'merge' is the suggested default -- the row's stock still
          // applies either way; only the PRICE choice is deferred to a
          // human, and even once applied it stays adjustable at POS
          // time like any other product's price, so there's no risk in
          // defaulting to "don't touch it yet".
          suggestedResolution: 'merge',
        }
      }
    }

    resolved.push(out)
  }

  return { resolved, unresolved, branchesCreated }
}

// Request-parsing counterpart to datedStockCountRoute.ts's own
// parseDatedStockCountEntries, but deliberately lenient per-row instead
// of batch-rejecting: the whole point of a resolve pass is to surface
// PER-ROW problems for a review screen (a bad date on row 12 shouldn't
// block seeing that rows 1-11 resolved fine), so this only rejects the
// request shape itself (missing/oversized array) -- every other
// validation (date, count, branch, identifier) happens per-row inside
// resolveDatedStockCountRows above, where it can be reported against
// that specific row instead of failing the whole request.
export const MAX_RAW_DATED_COUNT_ROWS = 5000

export function parseRawDatedCountRows(body: Record<string, unknown>): { rows: RawDatedCountRow[] } | { error: string } {
  const raw = body.rows
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'rows is required and must be a non-empty array' }
  if (raw.length > MAX_RAW_DATED_COUNT_ROWS) return { error: `Too many rows (max ${MAX_RAW_DATED_COUNT_ROWS})` }

  const rows: RawDatedCountRow[] = raw.map((entry, i) => {
    const row = (entry || {}) as Record<string, unknown>
    const rowNumber = Number(row.rowNumber)
    const count = Number(row.count)
    return {
      rowNumber: Number.isFinite(rowNumber) && rowNumber > 0 ? rowNumber : i + 1,
      date: String(row.date ?? ''),
      branchName: String(row.branchName ?? '').trim(),
      sku: row.sku != null ? String(row.sku).trim() || null : null,
      barcode: row.barcode != null ? String(row.barcode).trim() || null : null,
      productName: row.productName != null ? String(row.productName).trim() || null : null,
      // Left NaN on purpose when unparseable -- resolveDatedStockCountRows's
      // own `Number.isFinite(row.count)` check reports this per-row as
      // invalid_count rather than this function silently coercing it to
      // some default that would hide a genuinely malformed cell.
      count,
      // Optional. Absent entirely (undefined) means "no price column in
      // this file" -- resolveDatedStockCountRows only raises a
      // priceConflict when a price was actually supplied, so a file with
      // no price column never triggers one. An unparseable non-empty
      // value is left null rather than NaN/0, which would look like a
      // real imported price of zero and could wrongly flag a conflict.
      sellingPriceUsd: row.sellingPriceUsd != null && String(row.sellingPriceUsd).trim() !== '' ? (Number.isFinite(Number(row.sellingPriceUsd)) ? Number(row.sellingPriceUsd) : null) : undefined,
      sellingPriceKhr: row.sellingPriceKhr != null && String(row.sellingPriceKhr).trim() !== '' ? (Number.isFinite(Number(row.sellingPriceKhr)) ? Number(row.sellingPriceKhr) : null) : undefined,
    }
  })
  return { rows }
}
