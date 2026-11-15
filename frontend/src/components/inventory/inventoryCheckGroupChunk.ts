// The one place the grouped list's chunk is imported from: the page starts it as soon as the server offers a grouping, and renders it lazily.
export const loadGroupedList = (): Promise<typeof import('./InventoryCheckGroupedList.tsx')> => import('./InventoryCheckGroupedList.tsx')
