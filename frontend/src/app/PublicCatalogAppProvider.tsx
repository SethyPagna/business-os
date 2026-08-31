import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  AppContext,
  FALLBACK_APP_CONTEXT,
  FALLBACK_SYNC_CONTEXT,
  SyncContext,
  type AppContextCoreValue,
} from './AppContextCore.tsx'

type PublicCatalogProviderProps = {
  children: ReactNode
}

export function PublicCatalogAppProvider({ children }: PublicCatalogProviderProps): ReactElement {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [language, setLanguage] = useState('en')

  // Keep the global <html> `dark` class in sync with the storefront theme.
  // CatalogPreviewSurface adds `dark` to its own in-flow wrapper, but the
  // cart, wishlist, account and contact drawers/popovers are `position:fixed`
  // overlays rendered OUTSIDE that wrapper — without a global class a runtime
  // theme toggle left them light over a dark page. Mirrors the admin app's
  // AppContext theme effect; storefront still starts light and never
  // auto-honors the OS `prefers-color-scheme`.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])

  const appValue = useMemo<AppContextCoreValue>(() => ({
    ...FALLBACK_APP_CONTEXT,
    page: 'catalog',
    language,
    theme,
    toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    toggleLanguage: () => setLanguage((current) => (current === 'km' ? 'en' : 'km')),
    notify: () => {},
    hasPermission: () => false,
    canAccessPage: () => true,
    getPermissions: () => ({}),
  }), [language, theme])

  return (
    <AppContext.Provider value={appValue}>
      <SyncContext.Provider value={FALLBACK_SYNC_CONTEXT}>
        {children}
      </SyncContext.Provider>
    </AppContext.Provider>
  )
}
