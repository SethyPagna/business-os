// Shared primitives must not inherit whichever feature Rollup encounters first.
// Keep these boundaries ahead of the feature/directory rules in vite.config.ts.
// This is deliberately an exact module list, not another shared-directory bucket.
const neutralChunks: ReadonlyArray<readonly [string, string]> = [
  // Startup dependencies must never inherit a feature chunk: HTTP imports
  // actor scope, while authentication reads storage constants at module load.
  ['/src/constants.ts', 'app-constants'],
  ['/src/api/actorReadScope.ts', 'actor-read-scope'],
  // The sign-out fence and its owner helper are static imports of both
  // actorReadScope.ts and http.ts, so they load on every boot anyway (the
  // storefront included). Their own 'auth-intent' chunk only added one
  // request before first paint; they import nothing that imports them back.
  ['/src/api/unresolvedSignout.ts', 'actor-read-scope'],
  ['/src/api/offlineQueueOwnership.ts', 'actor-read-scope'],
  // Dependency-free business-time bound shared by fees/returns transports and
  // Reports. Unpinned, Rollup hoisted it (with all of reportModel.ts) into the
  // 'returns-read-api' manual chunk, which the storefront then had to fetch.
  ['/src/utils/businessTimeBounds.ts', 'shared-formatters'],
  // Exact sale/report money helpers used by POS, Sales, Receipt and Reports.
  // Unpinned, Rollup filed financialPrecision.ts inside 'dashboard-export',
  // so every one of those pages statically loaded the export code and SheetJS.
  ['/src/utils/financialPrecision.ts', 'money-core'],
  ['/src/utils/reportMoney.ts', 'money-core'],
  ['/src/utils/saleStatusResolution.ts', 'money-core'],
  ['/src/utils/permissions.ts', 'permissions-core'],
  ['/src/utils/acquisitionCostAccess.ts', 'permissions-core'],
  ['/src/utils/workDrafts.ts', 'work-drafts'],
  ['/src/utils/dirtyWork.ts', 'work-drafts'],
  ['/src/components/shared/hubNavigation.ts', 'hub-navigation'],
  ['/src/utils/publicAssetUrls.ts', 'api-http-core'],
  // http.ts reads the server's build, epoch and read-budget headers through these three leaves. Left to the '/src/api/' fallback they
  // land in app-api-methods, which imports http.ts back: a static chunk cycle that verify-built-startup refuses.
  ['/src/api/serverSignals.ts', 'api-http-core'],
  ['/src/api/dataEpoch.ts', 'api-http-core'],
  ['/src/api/readBudgetShed.ts', 'api-http-core'],
  ['/src/components/catalog/catalogPagination.tsx', 'catalog-public-utils'],
  ['/src/components/catalog/portalContrast.ts', 'catalog-public-utils'],
  ['/src/components/catalog/PortalFilterCombobox.tsx', 'catalog-public-controls'],
  ['/src/components/catalog/PortalPromoStrip.tsx', 'catalog-public-controls'],
  ['/src/components/shared/UnsavedChangesPrompt.tsx', 'shared-modal'],
  ['/src/components/shared/MinimizeButton.tsx', 'shared-modal'],
  ['/src/components/shared/modalCloseContext.ts', 'shared-modal'],
  // Modal and lazy recovery share this React-only hook. Keep recovery from
  // importing the modal implementation back through its keyboard contract.
  ['/src/components/shared/useDialogKeyboard.ts', 'shared-ui'],
  // Unpinned, Rollup filed this 5-line hook inside the storefront page chunk (catalog-public), so POS, Sales,
  // Products, Inventory, Customers, Returns and Reports statically loaded the storefront and its legal pages.
  ['/src/utils/useDebouncedValue.ts', 'shared-ui'],
  // Dependency-free helpers shared by POS, Sales, Settings, Backup, the bell and the page host: unpinned, Rollup filed them in
  // the website editor chunk (catalog), which then loaded with the till and the sales page.
  ['/src/utils/visibilityPolling.ts', 'admin-shared-utils'],
  ['/src/utils/filePicker.ts', 'admin-shared-utils'],
  ['/src/components/catalog/productDetailSections.ts', 'admin-shared-utils'],
  // G37 client search index (admin pickers only: POS, Products, Inventory,
  // Branches, Transfer, Stock-in, Promotions, Bulk import, Duplicates). Left
  // to the '/src/api/' fallback, the index transport and the shared search
  // core (~680 lines) rode app-api-methods, which the storefront loads at
  // boot, and pushed the catalog-products closure past its budget
  // (tests/performanceBudgets.test.ts). No storefront module imports them.
  ['/src/api/productSearchIndex.ts', 'product-search-index'],
  ['/src/utils/searchCore.ts', 'product-search-index'],
  ['/src/utils/rowSearch.ts', 'product-search-index'],
  ['/src/components/shared/InfoHint.tsx', 'shared-ui'],
  ['/src/components/shared/TruncatedText.tsx', 'shared-ui'],
  ['/src/components/shared/textAffordances.ts', 'shared-ui'],
  ['/src/components/shared/usePullToRefresh.ts', 'shared-ui'],
  ['/src/components/shared/PullToRefreshIndicator.tsx', 'shared-ui'],
  ['/src/utils/pullToRefresh.ts', 'shared-ui'],
  ['/src/components/shared/AlphaIndexRail.tsx', 'shared-ui'],
  ['/src/utils/alphaRail.ts', 'shared-ui'],
  ['/src/utils/socialLinks.ts', 'catalog-public-utils'],
  ['/src/components/catalog/logoImageStyle.ts', 'catalog-public-utils'],
  ['/src/components/catalog/portalBucket.ts', 'catalog-account-core'],
  ['/src/components/catalog/portalAccount.ts', 'catalog-account-core'],
  ['/src/components/catalog/PortalNoPaymentNotice.tsx', 'catalog-legal'],
  ['/src/components/catalog/legal/LegalPages.tsx', 'catalog-legal'],
  ['/src/components/catalog/legal/legalContent.ts', 'catalog-legal'],
  ['/src/components/catalog/legal/PortalEmbedConsent.tsx', 'catalog-legal'],
  // Online ordering (KHQR). The order link helper is read by the storefront root and page before first paint, so that one tiny module rides the
  // storefront's own utils chunk. Everything else under orders/ loads only when asked for (an /order link, or Checkout): left to the
  // '/src/components/catalog/' fallback it would land in the admin 'catalog' chunk and the storefront would load the Website Editor.
  ['/src/components/catalog/orders/orderPath.ts', 'catalog-public-utils'],
  ['/src/components/catalog/orders/orderHistory.ts', 'catalog-order-core'],
  // The code both lazy order chunks share (the API client, error text, rules, the poller, the form pieces): imported by them, importing nothing of theirs.
  ['/src/components/catalog/orders/orderClient.ts', 'catalog-order-core'],
  ['/src/components/catalog/orders/orderErrors.ts', 'catalog-order-core'],
  ['/src/components/catalog/orders/orderLogic.ts', 'catalog-order-core'],
  ['/src/components/catalog/orders/orderPoller.ts', 'catalog-order-core'],
  ['/src/components/catalog/orders/orderTypes.ts', 'catalog-order-core'],
  ['/src/components/catalog/orders/orderUi.tsx', 'catalog-order-core'],
  // Checkout sheet: opens from the cart. The order page: opens from a link. Change and return forms: open from the order page once paid.
  ['/src/components/catalog/orders/CheckoutSheet.tsx', 'catalog-order-checkout'],
  ['/src/components/catalog/orders/OrderRoute.tsx', 'catalog-order-page'],
  ['/src/components/catalog/orders/OrderPage.tsx', 'catalog-order-page'],
  ['/src/components/catalog/orders/KhqrCard.tsx', 'catalog-order-page'],
  ['/src/components/catalog/orders/OrderRequests.tsx', 'catalog-order-changes'],
  ['/src/components/catalog/orders/OrderEditSheet.tsx', 'catalog-order-changes'],
]

// These icons have consumers on both sides of a route boundary. Pinning them
// to Login, the storefront or the import tracker creates reverse route imports.
const crossRouteIcons = new Set([
  'arrow-left', 'copy', 'download', 'grip-vertical', 'heart',
  'loader-2', 'minus', 'shield-check', 'user',
])

export function neutralPrimitiveChunk(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/')
  // This import is injected into the entry for dynamic-route CSS loading even
  // with modulePreload:false. Putting it in generic vendor eagerly loads media
  // and export libraries. The existing routing runtime has no feature imports.
  if (normalized === '\0vite/preload-helper.js') return 'app-routing'
  const icon = normalized.match(/\/node_modules\/lucide-react\/dist\/esm\/icons\/([^/]+)\.js$/)?.[1]
  if (icon && crossRouteIcons.has(icon)) return 'shared-ui'
  if (normalized.includes('/node_modules/')) return undefined
  return neutralChunks.find(([suffix]) => normalized.endsWith(suffix))?.[1]
}
