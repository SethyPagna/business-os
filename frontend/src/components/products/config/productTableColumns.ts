// The Products desktop table's data columns (owner, 19 Oct 2026: Excel-style by
// default, useful information shown, Employees see details but never cost).
// Image and Name are pinned leading columns owned by ProductsListSurface; every
// column here sits after them in this fixed order and the chooser only shows or
// hides it. Pure and React-free so tests/productTableColumns.test.ts can run it.
import { branchStockLinesWorthShowing } from '../../../utils/branchScope.ts'
import type { ChooserColumn } from '../../shared/ColumnChooser.tsx'
import { COLUMN_STORAGE_PREFIX, defaultVisibleColumns, parseStoredColumns, type TableColumnDef } from '../../shared/columnPreferences.ts'

export type ProductColumnKey =
  | 'barcode' | 'category' | 'brand' | 'unit' | 'stock' | 'selling' | 'wholesale' | 'supplier'
  | 'cost' | 'margin' | 'sku' | 'discount' | 'lots' | 'lowStock' | 'description' | 'updated'

// `label` is the LANGUAGE-PACK KEY for the header and the chooser entry.
export interface ProductColumn extends TableColumnDef {
  key: ProductColumnKey
  widthRem: number
  align: 'left' | 'right'
  /** Only users who may see acquisition costs get the column at all. */
  requiresCost?: boolean
  /** Shown read-only with a lock until the user may edit it. */
  lock?: 'price' | 'supplier'
}

export const PRODUCT_COLUMNS: readonly ProductColumn[] = [
  { key: 'barcode', label: 'barcode', widthRem: 9, align: 'left' },
  { key: 'category', label: 'category', widthRem: 8, align: 'left' },
  { key: 'brand', label: 'brand', widthRem: 7, align: 'left' },
  { key: 'unit', label: 'unit', widthRem: 4.5, align: 'left' },
  { key: 'stock', label: 'stock', widthRem: 6, align: 'right' },
  { key: 'selling', label: 'selling_price_label', widthRem: 6.5, align: 'right', lock: 'price' },
  { key: 'wholesale', label: 'wholesale_price', widthRem: 6, align: 'right', lock: 'price' },
  { key: 'supplier', label: 'supplier', widthRem: 8, align: 'left', lock: 'supplier' },
  { key: 'cost', label: 'cost', widthRem: 5.5, align: 'right', requiresCost: true },
  { key: 'margin', label: 'margin', widthRem: 5, align: 'right', requiresCost: true },
  { key: 'sku', label: 'sku', widthRem: 7, align: 'left', defaultVisible: false },
  { key: 'discount', label: 'discount', widthRem: 7, align: 'left', defaultVisible: false },
  { key: 'lots', label: 'batches', widthRem: 11, align: 'left', defaultVisible: false },
  { key: 'lowStock', label: 'low_stock_threshold', widthRem: 6, align: 'right', defaultVisible: false },
  { key: 'description', label: 'description', widthRem: 12, align: 'left', defaultVisible: false },
  { key: 'updated', label: 'updated_at', widthRem: 6.5, align: 'right', defaultVisible: false },
]

// Pinned leading columns, in table order after the select checkbox. Width of
// Name is auto (min NAME_MIN_REM); Image is the surface's IMAGE_COL_WIDTH.
const SELECT_REM = 2
const IMAGE_REM = 4
const NAME_MIN_REM = 14

/** What this user may be offered. Cost and Margin do not exist for a user without cost access. */
export function productColumnsFor(options: { canViewCosts: boolean }): ProductColumn[] {
  return PRODUCT_COLUMNS.filter((column) => options.canViewCosts || !column.requiresCost)
}

/** Per-user AND per-device (localStorage), so one person's choice never reaches another sign-in. */
export function productColumnsSurfaceKey(userId: unknown): string {
  const id = userId === null || userId === undefined || userId === '' ? 'anon' : String(userId)
  return `products.v1.u${id}`
}

export function productColumnsStorageKey(userId: unknown): string {
  return COLUMN_STORAGE_PREFIX + productColumnsSurfaceKey(userId)
}

/** Saved choice -> visible keys. Keys the role may not have (a cost key saved under an Employee key) are dropped. */
export function parseStoredProductColumns(raw: string | null, columns: readonly ProductColumn[]): Set<string> | null {
  return parseStoredColumns(raw, columns as ProductColumn[])
}

export function defaultProductColumns(columns: readonly ProductColumn[]): Set<string> {
  return defaultVisibleColumns(columns as ProductColumn[])
}

/** Ordered columns to render: only the role's own, only the chosen ones. */
export function visibleProductColumns(columns: readonly ProductColumn[], isVisible: (key: string) => boolean): ProductColumn[] {
  return columns.filter((column) => isVisible(column.key))
}

export interface ProductTableSpans {
  /** Group title: from the Name column to the last column. */
  group: number
  /** Category band: from the Image column to the last column. */
  band: number
  /** Whole row (empty state): select + image + name + every data column. */
  row: number
}

/** Spans derived from what is rendered, never hard-coded: a span that disagrees with the <th> count breaks the table. */
export function productTableSpans(visible: readonly ProductColumn[]): ProductTableSpans {
  return { group: 1 + visible.length, band: 2 + visible.length, row: 3 + visible.length }
}

/** The table's own minimum width, so a wide choice scrolls inside its container instead of squeezing cells. */
export function productTableMinWidthRem(visible: readonly ProductColumn[]): number {
  return SELECT_REM + IMAGE_REM + NAME_MIN_REM + visible.reduce((sum, column) => sum + column.widthRem, 0)
}

/** The column that hosts the chooser button: the last header, or Name when nothing else is shown. */
export function chooserHostKey(visible: readonly ProductColumn[]): ProductColumnKey | 'name' {
  return visible.length ? visible[visible.length - 1].key : 'name'
}

type StockLine = { branch_id?: unknown; branch_name?: unknown; branch_active?: unknown; quantity?: unknown }

export interface StockCellModel {
  /** One branch only (a branch filter, or the sole active branch): name it beside the total. */
  chip: string
  /** Several branches: one line each, with retired-but-stocked branches marked. */
  lines: Array<{ key: string; name: string; quantity: number; inactive: boolean }>
}

/**
 * What the Stock cell prints besides the total quantity. A branch filter shows
 * that branch only. Otherwise the shared branch rule decides which lines are
 * worth printing: a lone active branch becomes a chip, two or more lines
 * (several active branches, or an active one plus a retired branch that still
 * holds stock) become a per-branch list.
 */
export function buildStockCellModel(
  product: { branch_stock?: unknown },
  options: { branchFilter: string; selectedBranchName: string; soleBranchName: string },
): StockCellModel {
  if (options.branchFilter !== 'all') return { chip: options.selectedBranchName, lines: [] }
  const rows = Array.isArray(product.branch_stock) ? branchStockLinesWorthShowing(product.branch_stock as StockLine[]) : []
  if (rows.length <= 1) {
    const only = rows[0]
    const onlyName = only ? String(only.branch_name || only.branch_id || '') : ''
    return { chip: options.soleBranchName || onlyName, lines: [] }
  }
  return {
    chip: '',
    lines: rows.map((row, index) => ({
      key: String(row.branch_id ?? index),
      name: String(row.branch_name || row.branch_id || ''),
      quantity: Number(row.quantity) || 0,
      inactive: row.branch_active === 0 || row.branch_active === false,
    })),
  }
}

/** Chooser entries: Image and Name are listed but cannot be switched off. */
export function productChooserColumns(columns: readonly ProductColumn[], t: (key: string) => string): ChooserColumn[] {
  return [
    { key: 'image', label: t('image'), required: true },
    { key: 'name', label: t('product_name'), required: true },
    ...columns.map((column) => ({ key: column.key, label: t(column.label) })),
  ]
}
