// The one place the per-received-date entries chunk is imported from (ic_lot_counts). Its own module so a test can make the import fail (the mounted harness replaces this module's functions) and
// so the preload (InventoryCheckListRows) and the popover share one loader.
export const loadLotEntries = (): Promise<typeof import('./InventoryCheckLotEntries.tsx')> => import('./InventoryCheckLotEntries.tsx')
