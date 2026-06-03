type LocalDbModule = typeof import('./localDb.ts')

let localDbPromise: Promise<LocalDbModule> | null = null

export function getLocalDbModule(): Promise<LocalDbModule> {
  if (!localDbPromise) localDbPromise = import('./localDb.ts')
  return localDbPromise
}

export async function getLocalDb(): Promise<LocalDbModule['dexieDb']> {
  const { dexieDb } = await getLocalDbModule()
  return dexieDb
}
