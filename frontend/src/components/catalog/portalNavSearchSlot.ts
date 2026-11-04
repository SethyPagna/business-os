import { createContext, useContext } from 'react'

/**
 * Where the products section draws its search and Filters. The storefront's tab bar lends a slot (the tab row on a
 * desktop, directly under the tabs on a phone); `expected` is true when there is one, `element` is null until it has
 * mounted. The default is "no slot": the Website Editor preview keeps the search in the section's own card.
 */
export type PortalNavSearchSlot = { expected: boolean; element: HTMLElement | null }
export const PortalNavSearchSlotContext = createContext<PortalNavSearchSlot>({ expected: false, element: null })
export function usePortalNavSearchSlot(): PortalNavSearchSlot {
  return useContext(PortalNavSearchSlotContext)
}
