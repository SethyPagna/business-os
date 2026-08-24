import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
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
