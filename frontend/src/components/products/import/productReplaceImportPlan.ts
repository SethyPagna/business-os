// Replace mode -- pure planning layer, no DB write, no UI.
//
// Per progress.md Part 281 (spec) + the Aug 23 session's confirmed
// defaults: Replace mode is NOT "matched rows only" -- an unmatched row
// still creates, exactly like General mode. The only difference from
// General mode is *what happens to a row that DOES match an existing
// product*: General merges (adds stock, keeps existing field values via
// merge_stock/link_variant); Replace overwrites those field values
// (wholesale, or just a chosen subset of columns), per whichever of the
// three sub-options is selected.
//
// Deliberately reuses `analyzeProductImportRows` for the actual identity
// matching (name/sku/barcode, signature comparison, variant grouping)
// instead of re-implementing it -- that matching logic already exists,
// is already tested, and Replace mode's own spec explicitly restates
// General mode's create/match behavior as the base to build on top of,
// not a separate rule. Per this project's "no zombie/duplicate code"
// golden rule, a second copy of that matching logic here would be
// exactly the kind of parallel implementation that rule exists to
// prevent.

import { analyzeProductImportRows } from './productImportPlanner.ts'

export type ReplaceImportSubMode = 'column_replace' | 'full_row_replace' | 'full_wipe_reimport'

export type ReplacePlannedAction = 'new' | 'create_variant' | 'replace_columns' | 'replace_row' | 'skip_row'

export interface ReplaceImportPlanRow {
  row: Record<string, any>
  index: number
  plannedAction: ReplacePlannedAction
  targetProductId: number | null
  replaceColumns: string[]
}

export interface ReplaceImportPlan {
  subMode: ReplaceImportSubMode
  rows: ReplaceImportPlanRow[]
  decisions: Record<number, ReplacePlannedAction>
  // Only set for full_wipe_reimport -- the caller/backend must delete
  // every one of these product ids (a real Full Data Reset, products
  // scope) before applying `rows`, exactly as Part 281 described this
  // sub-option: "Full Data Reset (products scope) immediately followed
  // by a General-mode import."
  deleteAllExistingProductIds: number[]
  errors: string[]
  summary: {
    total: number
    createCount: number
    replaceCount: number
    skipCount: number
    deletedExistingCount: number
  }
}

const MATCHED_ACTIONS = new Set(['merge_stock', 'link_variant'])

/**
 * column_replace and full_row_replace only differ in `replaceColumns`:
 * full-row replace overwrites every importable field (represented here as
 * an empty array, meaning "no column list -- overwrite the whole row",
 * matching how the backend already treats "no explicit column scope" for
 * other bulk operations rather than inventing a second sentinel), while
 * column_replace overwrites only the caller-supplied column subset.
 */
export function planProductReplaceImport(
  subMode: ReplaceImportSubMode,
  rows: Record<string, any>[] = [],
  existingProducts: Record<string, any>[] = [],
  options: { columns?: string[] } = {},
): ReplaceImportPlan {
  if (subMode === 'column_replace' && !(options.columns && options.columns.length)) {
    return {
      subMode,
      rows: [],
      decisions: {},
      deleteAllExistingProductIds: [],
      errors: ['Column replace requires at least one column to overwrite.'],
      summary: { total: 0, createCount: 0, replaceCount: 0, skipCount: 0, deletedExistingCount: 0 },
    }
  }

  // full_wipe_reimport ignores existing products entirely for matching
  // purposes -- every row becomes a fresh create, same as an empty-store
  // General import, because by the time this plan is applied the wipe
  // has already happened. Still routed through the same analyzer (with
  // an empty existing list) rather than a separate code path, so name/
  // sku/barcode-within-the-file variant grouping still applies.
  const analysis = analyzeProductImportRows(rows, subMode === 'full_wipe_reimport' ? [] : existingProducts)

  const planRows: ReplaceImportPlanRow[] = analysis.rows.map((row: Record<string, any>) => {
    const plannedAction = String(row._planned_action || 'new')
    const rowIndex = Number(row._import_row_index ?? 0)

    if (plannedAction === 'skip_row') {
      return { row, index: rowIndex, plannedAction: 'skip_row', targetProductId: null, replaceColumns: [] }
    }

    if (subMode !== 'full_wipe_reimport' && MATCHED_ACTIONS.has(plannedAction)) {
      const targetProductId = Number(row._target_product_id || 0) || null
      return {
        row,
        index: rowIndex,
        plannedAction: subMode === 'column_replace' ? 'replace_columns' : 'replace_row',
        targetProductId,
        replaceColumns: subMode === 'column_replace' ? [...(options.columns || [])] : [],
      }
    }

    // Not matched (or full_wipe_reimport, where nothing is ever
    // "matched") -- still create, per Replace mode's confirmed default
    // that it is not "matched rows only".
    return {
      row,
      index: rowIndex,
      plannedAction: plannedAction === 'create_variant' ? 'create_variant' : 'new',
      targetProductId: null,
      replaceColumns: [],
    }
  })

  const decisions: Record<number, ReplacePlannedAction> = {}
  planRows.forEach((planRow) => {
    decisions[planRow.index] = planRow.plannedAction
  })

  const deleteAllExistingProductIds = subMode === 'full_wipe_reimport'
    ? Array.from(new Set(
        existingProducts
          .map((product) => Number(product?.id || 0))
          .filter((id) => id > 0),
      ))
    : []

  return {
    subMode,
    rows: planRows,
    decisions,
    deleteAllExistingProductIds,
    errors: analysis.errors,
    summary: {
      total: planRows.length,
      createCount: planRows.filter((r) => r.plannedAction === 'new' || r.plannedAction === 'create_variant').length,
      replaceCount: planRows.filter((r) => r.plannedAction === 'replace_columns' || r.plannedAction === 'replace_row').length,
      skipCount: planRows.filter((r) => r.plannedAction === 'skip_row').length,
      deletedExistingCount: deleteAllExistingProductIds.length,
    },
  }
}
