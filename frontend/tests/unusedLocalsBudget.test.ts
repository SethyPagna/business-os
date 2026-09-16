// Guard: keeps `tsc --noEmit --noUnusedLocals --noUnusedParameters` diagnostics
// in frontend/ at or below a known budget, so the debloat done in p10 cannot
// silently regress (a new import/local left behind by a future change would
// push the count up and this test would go red).
//
// This does NOT turn noUnusedLocals/noUnusedParameters on in tsconfig.json --
// the coordinator decides that after the p10 lane merges. It runs the flags
// ad hoc, exactly like the manual scan p10 used.
//
// The budget is intentionally NOT zero. What's left, as of this lane, is:
//
// 1. Files owned by sibling lanes at the time of this scan (left untouched,
//    per p10's explicit file-ownership exclusions):
//    - frontend/src/components/sales/ReportsHub.tsx
//    - frontend/src/components/sales/reports/** (OverviewReport.tsx)
//    - frontend/src/components/pos/ProductDetailSheet.tsx
//
//    - checkpoint E batch: ReportsHub branchId, OverviewReport prevReturns,
//      Products/ProductDetailModal catMap+brandColorMap, InventoryMovementsSurface
//      three unread props removed (48 -> 40). Still pinned by tests:
//      BulkImportModal Undo2 import (tests/productImportPlanner.test.ts) and
//      vite.config.ts shouldDeferModulePreload + deferredModulePreloadPrefixes
//      (tests/performanceLoadingUx.test.ts pins the list although nothing calls
//      the function -- the deferral itself is an OPEN feature gap).
//
// 2. Code that LOOKS dead by this flag but is pinned by another test's exact
//    source-regex assertion (removing it would turn that test red):
//    - src/AppContext.tsx LoadingScreen (tests/iosLayoutGuards.test.ts pins
//      its minHeight calc string)
//    - src/components/branches/TransferModal.tsx handleTransfer + its two
//      timeout constants (tests/branchTransferReason.test.ts,
//      tests/mutationSuccessContract.test.ts,
//      tests/stockMutationSafetyContract.test.ts, tests/actionStability.test.ts
//      all pin exact substrings from inside handleTransfer's body)
//    - src/components/dashboard/Dashboard.tsx LayoutDashboard import
//      (tests/performanceLoadingUx.test.ts pins the literal import path)
//    - src/components/products/Products.tsx handleSave
//      (tests/actionStability.test.ts pins a regex spanning its guard through
//      handleSaveWithGallery's createProduct call)
//
// 3. Real, disconnected feature gaps found while triaging (props/state that
//    exist but nothing wires them up) -- NOT routine dead code, so left for a
//    feature owner rather than deleted as a "no behaviour change" debloat:
//    - CatalogProductsSection.tsx compactTwoColumnMobile prop
//    - PublicCatalogPage.tsx translateApplyState / translateApplyMessage
//    - SuppliersTab.tsx displayRows (section-header/collapse UI never wired
//      into the rendered rows)
//    - InventoryMovementsSurface.tsx actionHistory / visibleMovementQuantity /
//      visibleMovementRecordCount (Inventory.tsx computes and passes all
//      three; the surface never renders them)
//    - FilterPanel.tsx suppliers (deliberately not rendered, see its own
//      in-file comment)
//    - ProductForm.tsx setScannerLaunchingField (the paired getter is read in
//      several places but nothing ever calls the setter)
//    - productFilterHelpers.ts groupFilter / parentProductIds (documented
//      in-file as accepted-but-not-applied)
//    - productMenuHelpers.ts sort/supplier plumbing (documented in-file as
//      left in place after the menu sections that used them were removed)
//    - BulkImportModal.tsx's whole conflict-review cluster (Undo2,
//      summarizeSubgroup, analysisSummary, collapsedFamilyKeys,
//      reviewUndoStack, undoLastReviewChange, reviewIssueSummary, allDecided,
//      selectedConflictCount, visibleReviewRowCount, toggleFamilyCollapse,
//      toggleSelectAllConflicts, applyDecisionToSelection,
//      applyImageDecisionToSelection, applyIdentifierDecisionToSelection,
//      renderConflictFilterChip, renderConflictRow) -- several of these exact
//      names are pinned by tests/productImportPlanner.test.ts, and the rest
//      form one orphaned feature area, not independent dead code
//    - Products.tsx catMap (mobile card) and
//      products/surfaces/ProductDetailModal.tsx catMap/brandColorMap --
//      desktop rows pass these into buildProductRowDisplayState for the
//      category color pill; the mobile card and detail modal accept the same
//      props but never use them (missing parity, not dead code)
//    - NotificationCenter.tsx compact prop (App.tsx passes it, pinned by
//      tests/performanceLoadingUx.test.ts; the component never reads it)
//    - Settings.tsx cancelImageUpload / uploadImageSetting (a full,
//      self-contained image-upload flow with no button wired to trigger it)
//    - vite.config.ts shouldDeferModulePreload + deferredModulePreloadPrefixes
//      (an unused chunk-name prefix list/helper pair; large enough that
//      removing it is a build-config change warranting its own review, not
//      routine debloat)
//
// Any new name that appears in the scan and is NOT one of the above must
// either be removed (if genuinely dead) or added to this list with a reason
// (if it's sibling-owned, test-pinned, or a real feature gap) -- the budget
// only moves when this comment is updated to say why.
//
// Run: node tests/unusedLocalsBudget.test.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const EXCLUDED_SIBLING_FILES = [
  'frontend/src/components/sales/ReportsHub.tsx',
  'frontend/src/components/sales/reports/**',
  'frontend/src/components/shared/CostCalculationFloat.tsx',
  'frontend/src/utils/costBreakdownFormat.ts',
  'frontend/src/api/productReadTransport.ts',
  'frontend/src/components/pos/ProductDetailSheet.tsx',
  'frontend/tests/costCalculationFloat.test.ts',
].join(', ')

const BUDGET = 40

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--noUnusedLocals',
    '--noUnusedParameters',
    '-p',
    'tsconfig.json',
  ],
  { cwd: root, encoding: 'utf8' },
)

const output = `${result.stdout || ''}${result.stderr || ''}`
const diagnosticLines = output
  .split(/\r?\n/)
  .filter((line) => /error TS6133:|error TS6196:/.test(line))

assert.ok(
  diagnosticLines.length <= BUDGET,
  `tsc --noUnusedLocals --noUnusedParameters reported ${diagnosticLines.length} diagnostics, ` +
    `over the p10-debloat budget of ${BUDGET}. Sibling-owned files excluded from this lane's ` +
    `cleanup (${EXCLUDED_SIBLING_FILES}) and the test-pinned / real-feature-gap cases documented ` +
    `at the top of this file explain the current budget -- if this is a genuinely new dead local, ` +
    `remove it and lower BUDGET; if it's one more sibling-owned or pinned/feature-gap case, add it ` +
    `to the comment and raise BUDGET by exactly the number of new lines.\n${diagnosticLines.join('\n')}`,
)

console.log(`PASS unused-locals budget: ${diagnosticLines.length} diagnostic(s), budget ${BUDGET}`)
