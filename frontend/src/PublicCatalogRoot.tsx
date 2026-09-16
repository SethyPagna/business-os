import { Suspense, type ReactElement } from 'react'
import PublicCatalogPage from './components/catalog/PublicCatalogPage.tsx'
import { PublicCatalogAppProvider } from './app/PublicCatalogAppProvider.tsx'
import RootErrorBoundary from './components/shared/RootErrorBoundary.tsx'
import './public-web-api.ts'

function PublicCatalogFallback(): ReactElement {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-500">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
        Loading catalog...
      </div>
    </div>
  )
}

export default function PublicCatalogRoot(): ReactElement {
  return (
    // Suspense alone only covers a pending lazy import; it does not catch a
    // THROW. readPortalCache() in PublicCatalogPage.tsx documents the exact
    // incident: window.sessionStorage threw inside a ref initializer on an
    // iOS device with site data blocked, nothing caught it, and the whole
    // storefront rendered blank instead of simply loading without a cache.
    <RootErrorBoundary surface="public-catalog-root">
      <PublicCatalogAppProvider>
        <Suspense fallback={<PublicCatalogFallback />}>
          <PublicCatalogPage />
        </Suspense>
      </PublicCatalogAppProvider>
    </RootErrorBoundary>
  )
}
