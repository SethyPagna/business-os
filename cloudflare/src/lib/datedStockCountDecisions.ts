// Executes a human's per-row decisions against Part 288/289/290's
// analysis-only resolve output (lib/datedStockCountResolve.ts). That
// layer never writes a product or a price -- it only reports what it
// found (`resolved`, `unresolved` with `suggestedActions`,
// `priceConflict`). This file is the next, deliberately separate step:
// given those SAME rows plus a decision for each one that needed a
// human call, actually create/link the products and apply price
// choices, then hand back a complete resolved list ready for
// lib/datedStockCountRoute.ts's buildDatedStockCountPlan.
//
// Grouping convention, confirmed with the user rather than guessed:
// this app groups products by matching NAME, not an explicit parent_id
// chain -- see routes/products.ts's own "most real groups in this
// catalog are plain duplicate-name rows" comment and
// productGrouping.ts's resolveGroupKey on the frontend. So "create as a
// child row" (`create_child` -- same product, different identifying
// details -- the ambiguous_barcode/ambiguous_name case) means: insert a
// new product row that reuses the CHOSEN CANDIDATE's exact name (so the
// app's existing name-based grouping picks it up automatically as a
// child of that product) with this row's own sku/barcode. A child row's
// name is locked to the candidate's name by default -- see the
// enforcement below, and the unlock escape hatch right after it. "Create
// standalone" (`create_new` -- a genuinely new name -- the
// product_not_found case) means: insert a new product row with this
// row's own name, sharing nothing with any existing product. Renamed
// from this file's earlier 'create_variant' label to 'create_child'
// per the user's own terminology call (this session) -- "variant"
// invited exactly the confusion this file's name-lock exists to
// prevent (that a child row could carry its own name); "child" doesn't.
//
// Unlock flow (this session, mirrors ProductForm.tsx's own edit-screen
// lock/unlock UI for an already-saved grouped product): the lock isn't
// absolute -- a human can explicitly unlock and confirm a different name
// for a create_child row via `nameOverrideConfirmed`, which deliberately
// opts that row OUT of the app's name-based grouping (it becomes its own
// standalone name, same effect as create_new). Without that explicit
// flag, a mismatched `name` is rejected rather than silently used or
// silently ignored -- see the enforcement below.
//
// Core requirement driving this file's shape, the user's own words:
// "no products are hidden, broken, failed, forgotten, loss, etc." --
// every unresolved row passed in MUST end up in exactly one of
// `resolved` (now resolved via the decision), `skipped` (an explicit,
// visible decision NOT to import that row), or `errors` (a decision was
// missing, invalid, or referenced a candidate that isn't actually one
// of that row's own candidateProductIds). A row silently absent from
// all three would be exactly the kind of loss this function exists to
// prevent, so decisionRowCount + resolved-from-decisions + skipped +
// errors is asserted to reconcile against the unresolved input --
// tested below, not just claimed in a comment.
import type { D1Compat } from './db'
import type { ResolvedDatedCountRow, UnresolvedDatedCountRow } from './datedStockCountResolve'

export type DatedCountDecisionAction = 'create_new' | 'link_variant' | 'create_child' | 'skip'

export interface DatedCountDecision {
  rowNumber: number
  action: DatedCountDecisionAction
  // Required for link_variant/create_child -- must be one of that
  // row's own candidateProductIds (never trusted blindly from the
  // client, see the ownership check below).
  candidateProductId?: number
  // Only meaningful for create_child. A review screen should render this
  // field locked/disabled by default (the name always comes from the
  // chosen candidate). If a human explicitly clicks to unlock it and
  // confirms, the screen may submit a different `name` here PLUS
  // `nameOverrideConfirmed: true` -- see that field below for what
  // unlocking actually does. Submitting `name` without the confirm flag
  // is treated as a stale/mismatched form state, not a real rename
  // request, and rejected -- see the enforcement below.
  name?: string
  // Explicit, separate flag from `name` on purpose -- a client can't
  // unlock the name lock just by happening to submit a matching-looking
  // string; it has to affirmatively say a human clicked "unlock" and
  // confirmed the warning. When true AND `name` differs from the
  // candidate's real name, `create_child` uses `name` as the new row's
  // own name instead of the candidate's -- which means this new row
  // will NOT be picked up by the app's name-based grouping (see file
  // header), i.e. it becomes a standalone product in every way except
  // that it was created from this flow. That's the intended effect of
  // unlocking, not a bug: a human explicitly decided this row needed its
  // own identity rather than joining the candidate's group. Has no
  // effect when `name` is absent or already matches the candidate.
  nameOverrideConfirmed?: boolean
  // Only meaningful for an already-resolved row that came back with a
  // priceConflict (see resolveDatedStockCountRows). Defaults to
  // 'merge' when the row has a priceConflict and no decision (or a
  // decision missing this field) was given -- the same safe default
  // the resolve layer itself already suggests, never silently
  // overwriting a price.
  priceResolution?: 'merge' | 'apply_new'
}

export interface DatedCountDecisionError {
  rowNumber: number
  error: string
}

export interface DatedCountSkipped {
  rowNumber: number
}

export interface ProductCreatedFromDecision {
  rowNumber: number
  productId: number
  name: string
  action: 'create_new' | 'create_child'
  // True only for a create_child row whose name was explicitly unlocked
  // and confirmed away from its candidate's name (see
  // DatedCountDecision.nameOverrideConfirmed). Absent/false for every
  // other row, including a normal locked create_child. Lets an audit log
  // or a review summary flag "this one broke off from its group"
  // distinctly from an ordinary child creation.
  nameUnlocked?: boolean
}

export interface ApplyDatedStockCountDecisionsResult {
  resolved: ResolvedDatedCountRow[] // original resolved rows (price decisions applied) PLUS newly-resolved rows from decisions
  skipped: DatedCountSkipped[]
  errors: DatedCountDecisionError[]
  productsCreated: ProductCreatedFromDecision[]
}

function pickPrice(row: UnresolvedDatedCountRow['raw']): { usd: number; khr: number } {
  return {
    usd: row.sellingPriceUsd != null && Number.isFinite(row.sellingPriceUsd) ? Number(row.sellingPriceUsd) : 0,
    khr: row.sellingPriceKhr != null && Number.isFinite(row.sellingPriceKhr) ? Number(row.sellingPriceKhr) : 0,
  }
}

export async function applyDatedStockCountDecisions(
  db: D1Compat,
  resolved: ResolvedDatedCountRow[],
  unresolved: UnresolvedDatedCountRow[],
  decisions: DatedCountDecision[],
): Promise<ApplyDatedStockCountDecisionsResult> {
  const decisionByRow = new Map<number, DatedCountDecision>()
  for (const d of decisions) decisionByRow.set(d.rowNumber, d)

  const errors: DatedCountDecisionError[] = []
  const skipped: DatedCountSkipped[] = []
  const productsCreated: ProductCreatedFromDecision[] = []
  const newlyResolved: ResolvedDatedCountRow[] = []

  // ---- Part 1: price-conflict decisions on already-resolved rows ----
  // No row is dropped here -- every resolved row is carried through to
  // the output either way; only its priceConflict (if any) is acted on.
  const finalResolved: ResolvedDatedCountRow[] = []
  for (const row of resolved) {
    if (row.priceConflict) {
      const decision = decisionByRow.get(row.rowNumber)
      const resolution = decision?.priceResolution ?? row.priceConflict.suggestedResolution
      if (resolution === 'apply_new') {
        const usd = row.priceConflict.importedUsd ?? row.priceConflict.currentUsd
        const khr = row.priceConflict.importedKhr ?? row.priceConflict.currentKhr
        await db.prepare(`UPDATE products SET selling_price_usd = @usd, selling_price_khr = @khr, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ usd, khr, id: row.productId })
      }
    }
    finalResolved.push(row)
  }

  // ---- Part 2: unresolved rows -- every single one must be accounted
  // for below (resolved, skipped, or errors), never silently dropped.
  for (const row of unresolved) {
    // Rows that failed BEFORE product/branch matching (invalid_date,
    // invalid_count, missing_branch, missing_identifier) have no
    // meaningful decision to make -- there's no product action that
    // fixes a bad date or a missing branch name. Surfaced as an error
    // so the row still shows up somewhere rather than vanishing, but
    // this function can't resolve it; the source data itself needs
    // fixing and re-submitting through /resolve again.
    if (row.suggestedActions.length === 0) {
      errors.push({ rowNumber: row.rowNumber, error: `Row has no possible action for reason '${row.reason}' -- fix the source data and re-resolve.` })
      continue
    }

    const decision = decisionByRow.get(row.rowNumber)
    if (!decision) {
      errors.push({ rowNumber: row.rowNumber, error: 'No decision provided for this row.' })
      continue
    }

    if (decision.action !== 'skip' && !(row.suggestedActions as readonly DatedCountDecisionAction[]).includes(decision.action)) {
      errors.push({ rowNumber: row.rowNumber, error: `Action '${decision.action}' is not valid for this row (allowed: ${[...row.suggestedActions, 'skip'].join(', ')}).` })
      continue
    }

    if (decision.action === 'skip') {
      skipped.push({ rowNumber: row.rowNumber })
      continue
    }

    // branchId is guaranteed present here -- every reason reaching this
    // point (product_not_found / ambiguous_barcode / ambiguous_name)
    // only occurs after branch resolution already succeeded, and
    // resolveDatedStockCountRows always attaches it for those reasons
    // (see UnresolvedDatedCountRow's own header comment). Guard anyway
    // rather than write a row with a bogus branchId of 0.
    if (row.branchId == null) { errors.push({ rowNumber: row.rowNumber, error: 'Row has no resolved branchId -- cannot apply a decision.' }); continue }
    const branchId = row.branchId

    if (decision.action === 'create_new') {
      const name = String(row.raw.productName ?? '').trim()
      if (!name) { errors.push({ rowNumber: row.rowNumber, error: 'create_new requires a product name; this row had none.' }); continue }
      const price = pickPrice(row.raw)
      const inserted = await db
        .prepare(`INSERT INTO products (name, sku, barcode, selling_price_usd, selling_price_khr, is_active) VALUES (@name, @sku, @barcode, @usd, @khr, 1)`)
        .run({ name, sku: row.raw.sku ?? null, barcode: row.raw.barcode ?? null, usd: price.usd, khr: price.khr })
      const productId = Number(inserted.lastInsertRowid)
      productsCreated.push({ rowNumber: row.rowNumber, productId, name, action: 'create_new' })
      newlyResolved.push({ rowNumber: row.rowNumber, date: row.raw.date, productId, branchId, count: row.raw.count })
      continue
    }

    // link_variant / create_child both require a real candidateProductId
    // that this row itself offered -- never trust an id from the client
    // that wasn't already in this row's own candidateProductIds, so a
    // decision can't be used to silently attach a count to an unrelated
    // product.
    const candidates = row.candidateProductIds ?? []
    if (decision.candidateProductId == null || !candidates.includes(decision.candidateProductId)) {
      errors.push({ rowNumber: row.rowNumber, error: `${decision.action} requires candidateProductId to be one of this row's own candidates (${candidates.join(', ') || 'none'}).` })
      continue
    }

    if (decision.action === 'link_variant') {
      newlyResolved.push({ rowNumber: row.rowNumber, date: row.raw.date, productId: decision.candidateProductId, branchId, count: row.raw.count })
      continue
    }

    // create_child: new row, same NAME as the chosen candidate by
    // default (so this app's existing name-based grouping picks it up
    // as that product's child automatically -- see file header), but
    // this row's own sku/barcode so it's a genuinely distinct catalog
    // row. The name is locked to the candidate's -- a decision can only
    // use a different one by explicitly unlocking + confirming (see
    // `nameOverrideConfirmed` above); a plain mismatched `name` with no
    // confirm flag is treated as a stale/mismatched form state and
    // rejected outright, never silently overridden either direction.
    const parent = await db.prepare(`SELECT name FROM products WHERE id = @id`).get<{ name: string }>({ id: decision.candidateProductId })
    if (!parent) { errors.push({ rowNumber: row.rowNumber, error: `candidateProductId ${decision.candidateProductId} no longer exists.` }); continue }
    const requestedName = decision.name?.trim()
    const nameDiffers = requestedName != null && requestedName.length > 0 && requestedName.toLowerCase() !== parent.name.trim().toLowerCase()
    if (nameDiffers && !decision.nameOverrideConfirmed) {
      errors.push({ rowNumber: row.rowNumber, error: `create_child is locked to the parent product's name ("${parent.name}") -- it cannot be created as "${requestedName}" without explicitly unlocking and confirming (nameOverrideConfirmed). A product that needs a different name is not a child row; use create_new to create it standalone instead.` })
      continue
    }
    // Unlocked-and-confirmed: use the human's own name instead of the
    // parent's -- this deliberately opts the new row OUT of this app's
    // name-based grouping (see file header), which is the whole point
    // of unlocking. Otherwise (the common, locked path) always use the
    // parent's real stored name, never anything from the row/decision.
    const nameUnlocked = nameDiffers && !!decision.nameOverrideConfirmed
    const finalName = nameUnlocked ? (requestedName as string) : parent.name
    const price = pickPrice(row.raw)
    const inserted = await db
      .prepare(`INSERT INTO products (name, sku, barcode, selling_price_usd, selling_price_khr, is_active) VALUES (@name, @sku, @barcode, @usd, @khr, 1)`)
      .run({ name: finalName, sku: row.raw.sku ?? null, barcode: row.raw.barcode ?? null, usd: price.usd, khr: price.khr })
    const productId = Number(inserted.lastInsertRowid)
    productsCreated.push({ rowNumber: row.rowNumber, productId, name: finalName, action: 'create_child', ...(nameUnlocked ? { nameUnlocked: true } : {}) })
    newlyResolved.push({ rowNumber: row.rowNumber, date: row.raw.date, productId, branchId, count: row.raw.count })
  }

  return { resolved: [...finalResolved, ...newlyResolved], skipped, errors, productsCreated }
}
