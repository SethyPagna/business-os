import { Suspense, type ReactElement } from 'react'
import PublicCatalogPage from './components/catalog/PublicCatalogPage.tsx'
import { PublicCatalogAppProvider } from './app/PublicCatalogAppProvider.tsx'
import RootErrorBoundary from './components/shared/RootErrorBoundary.tsx'
import './public-web-api.ts'
import { installPortalTranslateDomGuard } from './components/catalog/portalTranslateDomGuard.ts'
import PublicStorefrontSkeleton from './components/catalog/PublicStorefrontSkeleton.tsx'
import { resolveStorefrontCopy } from './components/catalog/portalLanguagePacks.ts'
import { readPublicStorefrontLanguage } from './components/catalog/portalLanguageOptions.ts'

// Every storefront page load, before the first render: Chrome's built-in
// translator and translation extensions move text nodes React owns, and React's next commit then throws on
// removeChild/insertBefore. The guard only changes calls that would
// otherwise throw (portalTranslateDomGuard.ts). This module is the
// storefront entry only -- index.tsx loads it when isPublicCatalogPath() is
// true and AdminRoot otherwise -- so the admin app keeps the native methods.
installPortalTranslateDomGuard()

function PublicCatalogFallback(): ReactElement {
  const label = resolveStorefrontCopy(readPublicStorefrontLanguage(), (key) => key, 'loadingPortal', 'Loading website...')
  return (
    <div className="mx-auto min-h-screen max-w-[1680px] px-4 py-3 sm:px-6 sm:py-4 lg:px-10 xl:px-14">
      <PublicStorefrontSkeleton label={label} />
    </div>
  )
}

export default function PublicCatalogRoot(): ReactElement {
  return (
    // Suspense alone only covers a pending lazy import; it does not catch a
    // THROW. The incident: window.sessionStorage threw inside a ref
    // initializer on an iOS device with site data blocked, nothing caught it,
    // and the whole storefront rendered blank.
    <RootErrorBoundary surface="public-catalog-root">
      <PublicCatalogAppProvider>
        <Suspense fallback={<PublicCatalogFallback />}>
          <PublicCatalogPage />
        </Suspense>
      </PublicCatalogAppProvider>
    </RootErrorBoundary>
  )
}
