// Shared primitives must not inherit whichever feature Rollup encounters first.
// Keep these boundaries ahead of the feature/directory rules in vite.config.ts.
// This is deliberately an exact module list, not another shared-directory bucket.
const neutralChunks: ReadonlyArray<readonly [string, string]> = [
  ['/src/utils/workDrafts.ts', 'work-drafts'],
  ['/src/utils/dirtyWork.ts', 'work-drafts'],
  ['/src/components/shared/hubNavigation.ts', 'hub-navigation'],
  ['/src/utils/publicAssetUrls.ts', 'api-http-core'],
  ['/src/components/catalog/catalogPagination.tsx', 'catalog-public-utils'],
  ['/src/components/catalog/portalContrast.ts', 'catalog-public-utils'],
  ['/src/components/catalog/PortalFilterCombobox.tsx', 'catalog-public-controls'],
  ['/src/components/catalog/PortalPromoStrip.tsx', 'catalog-public-controls'],
  ['/src/components/shared/UnsavedChangesPrompt.tsx', 'shared-modal'],
  ['/src/components/shared/MinimizeButton.tsx', 'shared-modal'],
  ['/src/components/shared/modalCloseContext.ts', 'shared-modal'],
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
