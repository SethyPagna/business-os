import { createContext, useContext, type ReactNode } from 'react'

const CatalogPageContext = createContext<unknown>(null)

type CatalogPageProviderProps = {
  value: unknown
  children: ReactNode
}

export function CatalogPageProvider({ value, children }: CatalogPageProviderProps) {
  return (
    <CatalogPageContext.Provider value={value}>
      {children}
    </CatalogPageContext.Provider>
  )
}

export function useCatalogPageContext() {
  const context = useContext(CatalogPageContext)
  if (!context) {
    throw new Error('CatalogPageContext is not available')
  }
  return context
}
