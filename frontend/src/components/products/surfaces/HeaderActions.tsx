import PackagePlus from 'lucide-react/dist/esm/icons/package-plus.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js'
import Award from 'lucide-react/dist/esm/icons/award.js'
import Ruler from 'lucide-react/dist/esm/icons/ruler.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import type { ReactNode } from 'react'
import type { PortalMenuItem } from '../../shared/PortalMenu'
import LazyPortalMenu from '../../shared/LazyPortalMenu'
import ButtonGuidePopover from '../../shared/ButtonGuidePopover'
import { TOOLBAR_BUTTON_WIDTH, manageToolbarButtonClassName, primaryToolbarButtonClassName } from '../../shared/toolbarButtonStyles'

type Translate = (key: string) => string | undefined

// Every action handler here is optional, and an omitted handler removes
// that control entirely rather than showing it disabled. Products.tsx
// passes `undefined` for anything this role's permission tier can't do
// (see its `can(...)` calls and utils/permissionActions.ts) -- so a
// Review Required user simply never sees Import/Export/Merge/Cleanup
// instead of seeing them and collecting a 403 on click. `onMergeDuplicates`
// and `onZeroQuantityCleanup` already worked this way for a different
// reason (embedders that don't wire them); this just applies the same,
// already-proven pattern to the rest of the row.
type ProductsHeaderActionsProps = {
  onManageCats?: () => void
  onManageBrands?: () => void
  onManageUnits?: () => void
  onImport?: () => void
  onExport?: () => void
  onAdd?: () => void
  // With this wired, the Add button becomes a 2-option menu: Add Stock and
  // Add New Product. Add Stock is ONE merged function (user, Aug 31: "the
  // fast stockin can also do one by one... can be merged into one Add stock
  // function") -- the shipment receiver, whose shared header + line-by-line
  // entry covers both a whole delivery and a single product. Left unwired
  // (other embedders, or no inventory-adjust grant) the button stays the
  // plain Add-product action.
  onAddStock?: () => void
  // Retroactive catalog cleanup: folds already-imported products that are
  // really the same item (differ only by which branch's stock landed on
  // which row) into one. Optional so pages embedding this header outside
  // Products.tsx don't need to wire it.
  onMergeDuplicates?: () => void
  // Review-before-delete cleanup for products that have sat at 0 stock
  // across every branch for a while (progress.md part 91's spec, part 97
  // build) -- same "optional so other embedders don't need to wire it"
  // reasoning as onMergeDuplicates above.
  onZeroQuantityCleanup?: () => void
  /** Opens the image auto-wire review. Omitted when the role may not upload product images. */
  onWireImages?: () => void
  // Rendered as the middle button of this row (Products.tsx passes its
  // Suspense-wrapped ActionHistoryBar here) -- kept as a slot rather than
  // owned by this component so the lazy-loading/Suspense boundary stays
  // with the page that already manages it. Row collapses to two buttons
  // (Manage / Add product) for any embedding that doesn't pass one.
  historySlot?: ReactNode
  t: Translate
}

// Single row at every breakpoint: Manage / History / Add product. Import
// and Export used to also render as their own buttons next to this one on
// desktop (md:flex) -- duplicating the exact same actions already reachable
// one tap further inside Manage below, and, together with History sitting
// separately in the search row, this was what was overflowing off narrower
// screens. Folded down to three buttons total, all consolidated here.
//
// Export used to ALSO carry a second layer of clutter once inside Manage:
// up to 9 near-identical "Export ..." rows (visible / selected / filtered
// by stock / by category / by brand / by supplier / by branch / by
// created range / full list), most of which exported the exact same row
// set under a different filename. That's now one "Export" entry that
// opens a single floating panel (ExportFieldsModal, see Products.tsx)
// with a scope picker (Selected/Filtered/Full, with live counts) plus the
// field-group checkboxes -- same "complete but not duplicated" idea as
// the scoped presets used to chase, just as one customizable panel
// instead of a wall of buttons (Aug 2026 polish pass).
export default function ProductsHeaderActions({
  onManageCats,
  onManageBrands,
  onManageUnits,
  onImport,
  onExport,
  onAdd,
  onAddStock,
  onMergeDuplicates,
  onZeroQuantityCleanup,
  onWireImages,
  historySlot = null,
  t,
}: ProductsHeaderActionsProps) {
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    if (value && value !== key) return value
    return fallback
  }

  const manageLabel = tr('manage', 'Manage')
  const manageHint = tr('manage_button_hint', 'Categories, brand, units, import/export, and catalog cleanup tools')
  const importLabel = tr('import', 'Import')
  const importHint = tr('import_button_hint', 'Bring products in from a CSV or Excel file')
  const exportLabel = tr('export', 'Export')
  const exportHint = tr('export_button_hint', 'Download products as a customizable XLSX file')
  const productLabel = tr('product', 'Product')
  const productHint = tr('add_product_button_hint', 'Create a new product from scratch')
  const addStockLabel = tr('add_stock', 'Add Stock')
  const addStockHint = tr('add_stock_menu_hint', 'Receive stock — set the shipment info once, then add one product or many, line by line')
  const addNewProductLabel = tr('add_new_product', 'Add New Product')
  const mergeDuplicatesLabel = tr('merge_duplicate_products', 'Merge duplicate products')
  const mergeDuplicatesHint = tr('merge_duplicates_button_hint', 'Combine branch-only duplicate rows of the same item into one')
  const wireImagesLabel = tr('wire_images_title', 'Wire images to products')
  const wireImagesHint = tr('wire_images_button_hint', 'Match uploaded photos to products by filename, then review before anything is attached')
  const zeroQuantityCleanupLabel = tr('zero_quantity_cleanup_title', 'Remove 0-quantity products')
  const zeroQuantityCleanupHint = tr('zero_quantity_cleanup_button_hint', 'Review and remove products that have sat at 0 stock everywhere')
  const categoriesLabel = tr('categories', 'Categories')
  const categoriesHint = tr('manage_categories_hint', 'Add, rename, or remove product categories')
  const brandLabel = tr('brand', 'Brand')
  const brandHint = tr('manage_brand_hint', 'Add, rename, or remove product brands')
  const unitsLabel = tr('units', 'Units')
  const unitsHint = tr('manage_units_hint', 'Add, rename, or remove units of measure')
  const historyLabel = tr('action_history', 'History')
  const historyHint = tr('action_history_button_hint', 'See and undo recent changes to products')
  const buttonGuideTitle = tr('button_guide_title', 'What these buttons do')

  const iconClass = 'h-4 w-4 shrink-0'
  // Built in groups so a divider is only emitted when the group after it
  // actually has something in it -- otherwise hiding, say, both import and
  // export would leave a stray separator line floating in the menu.
  const lookupItems: PortalMenuItem[] = [
    ...(onManageCats ? [{ label: categoriesLabel, onClick: onManageCats, icon: <FolderTree className={iconClass} /> }] : []),
    ...(onManageBrands ? [{ label: brandLabel, onClick: onManageBrands, icon: <Award className={iconClass} /> }] : []),
    ...(onManageUnits ? [{ label: unitsLabel, onClick: onManageUnits, icon: <Ruler className={iconClass} /> }] : []),
  ]
  const transferItems: PortalMenuItem[] = [
    ...(onImport ? [{ label: importLabel, onClick: onImport, color: 'blue' as const, icon: <Upload className={iconClass} /> }] : []),
    ...(onExport ? [{ label: exportLabel, onClick: onExport, color: 'green' as const, icon: <Download className={iconClass} /> }] : []),
    ...(onWireImages ? [{ label: wireImagesLabel, onClick: onWireImages, icon: <ImagePlus className={iconClass} /> }] : []),
  ]
  const cleanupItems: PortalMenuItem[] = [
    ...(onMergeDuplicates ? [{ label: mergeDuplicatesLabel, onClick: onMergeDuplicates, icon: <Merge className={iconClass} /> }] : []),
    ...(onZeroQuantityCleanup ? [{ label: zeroQuantityCleanupLabel, onClick: onZeroQuantityCleanup, color: 'red' as const, icon: <Trash2 className={iconClass} /> }] : []),
  ]
  const manageItems: PortalMenuItem[] = [lookupItems, transferItems, cleanupItems]
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : ['divider' as const, ...group]))

  // The Add button's menu: stock the existing catalog first, create a
  // brand-new product last.
  const addMenuItems: PortalMenuItem[] = [
    ...(onAddStock ? [{ label: addStockLabel, onClick: onAddStock, color: 'blue' as const, icon: <Boxes className={iconClass} /> }] : []),
    ...(onAdd ? [{ label: addNewProductLabel, onClick: onAdd, color: 'green' as const, icon: <PackagePlus className={iconClass} /> }] : []),
  ]

  // flex-1 at the narrowest widths (matches the old mobile grid's equal-
  // share sizing so three buttons stay easy to tap edge-to-edge); from sm
  // up the row no longer needs to fill the full page width, so buttons
  // shrink back to their own content size instead of stretching into
  // oversized targets on wide desktop screens. Dropped the old
  // `sm:min-w-[6.5rem]` floor (Aug 22 2026 ask -- "actions button can be
  // made tighter to fit the icon and button name instead of taking so
  // much space"): that floor forced every desktop button to at least
  // 6.5rem regardless of how short its label was, padding "Manage"/
  // "Product" with empty space past their actual content width. `px-3`
  // added in its place so the icon+label pair still has real breathing
  // room at its natural width instead of butting right up to the edge.
  // Sizing now lives in shared/toolbarButtonStyles.ts (TOOLBAR_BUTTON_WIDTH
  // matches this exactly) so Sales/Inventory/Fees/Users can use the same
  // pattern instead of each hand-rolling their own copy -- see that
  // file's comment for why this shape was chosen.
  const buttonSizing = TOOLBAR_BUTTON_WIDTH

  return (
    <div className="flex min-w-0 items-stretch gap-1.5">
      {/* Guide icon before History, History before Manage -- per explicit
          user direction, the icon explaining what this row's buttons do
          sits on the left, immediately before History (which itself reads
          more chronologically before Manage: what happened -> what to
          configure -> add new). No wrapping div around historySlot on
          purpose -- ActionHistoryBar's own outer element already accepts
          a className and stretches its trigger button to fill it (see
          that file's own comment on why), same as how Inventory.tsx/
          Sales.tsx embed it directly in their merged toolbar rows.
          Wrapping it in another flex-sized div here would just add a
          layer the width classes have to punch through. */}
      <ButtonGuidePopover
        title={buttonGuideTitle}
        triggerLabel={buttonGuideTitle}
        // The guide lists only the buttons this role can actually see --
        // explaining a control that isn't rendered is just confusing.
        entries={[
          ...(manageItems.length ? [{ icon: <Settings2 className={iconClass} />, label: manageLabel, description: manageHint }] : []),
          ...(onManageCats ? [{ icon: <FolderTree className={iconClass} />, label: categoriesLabel, description: categoriesHint }] : []),
          ...(onManageBrands ? [{ icon: <Award className={iconClass} />, label: brandLabel, description: brandHint }] : []),
          ...(onManageUnits ? [{ icon: <Ruler className={iconClass} />, label: unitsLabel, description: unitsHint }] : []),
          ...(onImport ? [{ icon: <Upload className={iconClass} />, label: importLabel, description: importHint }] : []),
          ...(onExport ? [{ icon: <Download className={iconClass} />, label: exportLabel, description: exportHint }] : []),
          ...(onMergeDuplicates ? [{ icon: <Merge className={iconClass} />, label: mergeDuplicatesLabel, description: mergeDuplicatesHint }] : []),
          ...(onWireImages ? [{ icon: <ImagePlus className={iconClass} />, label: wireImagesLabel, description: wireImagesHint }] : []),
          ...(onZeroQuantityCleanup ? [{ icon: <Trash2 className={iconClass} />, label: zeroQuantityCleanupLabel, description: zeroQuantityCleanupHint }] : []),
          ...(onAddStock ? [{ icon: <Boxes className={iconClass} />, label: addStockLabel, description: addStockHint }] : []),
          ...(onAdd ? [{ icon: <PackagePlus className={iconClass} />, label: productLabel, description: productHint }] : []),
          ...(historySlot ? [{ label: historyLabel, description: historyHint }] : []),
        ]}
      />
      {historySlot}
      {/* Manage is a container for the items above -- with none of them
          permitted there is nothing behind the button, so it goes too
          rather than opening an empty menu. */}
      {manageItems.length ? (
        <LazyPortalMenu
          align="auto"
          triggerWrapperClassName={buttonSizing}
          menuClassName="max-h-[70vh] overflow-auto"
          trigger={(
            <button
              type="button"
              className={`w-full ${manageToolbarButtonClassName}`}
              aria-haspopup="true"
              aria-label={manageLabel}
              title={manageHint}
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              {/* Icon-only on phones: four toolbar buttons split the narrow
                  row four ways, so a labeled "Manage" truncated to "Ma..."
                  (user-reported). The gear reads as Manage on its own; the
                  ButtonGuidePopover to the left still names it, and the label
                  returns from sm up. */}
              <span className="hidden min-w-0 truncate sm:inline">{manageLabel}</span>
            </button>
          )}
          items={manageItems}
        />
      ) : null}
      {addMenuItems.length > 1 ? (
        <LazyPortalMenu
          align="auto"
          trigger={(
            <button
              type="button"
              className={primaryToolbarButtonClassName}
              aria-haspopup="true"
              aria-label={productLabel}
              title={productHint}
            >
              <PackagePlus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{productLabel}</span>
            </button>
          )}
          items={addMenuItems}
        />
      ) : addMenuItems.length === 1 ? (
        // Only one add-flavored action permitted -- a one-item menu is just
        // an extra click, so the button IS that action (usually plain
        // Add product, exactly the pre-menu behavior).
        <button
          type="button"
          onClick={(addMenuItems[0] as { onClick?: () => void }).onClick}
          className={primaryToolbarButtonClassName}
          aria-label={productLabel}
          title={productHint}
        >
          <PackagePlus className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{productLabel}</span>
        </button>
      ) : null}
    </div>
  )
}
