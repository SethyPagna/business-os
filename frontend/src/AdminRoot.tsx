import type { ReactElement } from 'react'
import './web-api.ts'
import App from './App.tsx'
import { AppProvider } from './AppContext.tsx'
import RootErrorBoundary from './components/shared/RootErrorBoundary.tsx'

// index.tsx awaits this in the AdminRoot lazy import (I6-1): a device set to
// Khmer gets its pack before the first render instead of an English flash.
export { primeStoredLanguagePack } from './AppContext.tsx'

export default function AdminRoot(): ReactElement {
  return (
    // Above AppProvider on purpose: a throw inside the provider's own first
    // render (blocked storage on iOS, a failed settings parse) used to take
    // the entire admin app to a blank white page with no console breadcrumb
    // the operator could act on.
    <RootErrorBoundary surface="admin-root">
      <AppProvider publicMode={false}>
        <App />
      </AppProvider>
    </RootErrorBoundary>
  )
}
