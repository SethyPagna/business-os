import { Suspense, type ReactElement } from 'react'
import CatalogPage from './components/catalog/CatalogPage.tsx'
import { PublicCatalogAppProvider } from './app/PublicCatalogAppProvider.tsx'
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
    <PublicCatalogAppProvider>
      <Suspense fallback={<PublicCatalogFallback />}>
        <CatalogPage publicView />
      </Suspense>
    </PublicCatalogAppProvider>
  )
}
