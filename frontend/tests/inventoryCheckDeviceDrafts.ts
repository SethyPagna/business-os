// Counts typed on the Inventory list are kept on the device (autosave). Every scenario of a mounted test is its own session on a clean device,
// so a test forgets the drafts a scenario before it left behind (a real device would restore them, which tests/inventoryCheckCountDraftsMounted.test.ts proves).
export function forgetDeviceDrafts(): void {
  const storage = (globalThis as { localStorage?: Storage }).localStorage
  if (!storage) return
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key && key.startsWith('businessos_draft')) keys.push(key) }
  for (const key of keys) storage.removeItem(key)
}
