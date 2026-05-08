import { createContext, useContext } from 'react'

const CatalogPageContext = createContext(null)

export function CatalogPageProvider({ value, children }) {
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

