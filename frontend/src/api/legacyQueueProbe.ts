// Offline selling ended on 26 Sep 2026 (owner). A device may still hold sales
// it queued before then. This counts them with plain IndexedDB, read-only, so a
// device with none never downloads Dexie or opens the recovery notice. The
// store names are localDb.ts's; that schema keeps them until every device has
// reported zero here.

const LEGACY_DB_NAME = 'BusinessOS'
const LEGACY_QUEUE_STORES = ['sync_queue', 'sync_outbox'] as const

type DatabaseFactory = Pick<IDBFactory, 'open'> & { databases?: IDBFactory['databases'] }

function openExisting(factory: DatabaseFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LEGACY_DB_NAME)
    let created = false
    // No version asked: an upgrade only happens when the database did not
    // exist. Abort it, so probing never creates one.
    request.onupgradeneeded = () => {
      created = true
      request.transaction?.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      if (created) resolve(null)
      else reject(request.error ?? new Error('IndexedDB open failed'))
    }
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

function countRows(db: IDBDatabase, storeNames: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, 'readonly')
    let total = 0
    for (const name of storeNames) {
      const request = transaction.objectStore(name).count()
      request.onsuccess = () => { total += request.result }
    }
    transaction.oncomplete = () => resolve(total)
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB count failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB count aborted'))
  })
}

/** Rows left in the legacy offline queues on this device; 0 when there is no legacy database. */
export async function countLegacyQueuedRecords(factory: DatabaseFactory | undefined = globalThis.indexedDB): Promise<number> {
  if (!factory) return 0
  if (typeof factory.databases === 'function') {
    const databases = await factory.databases()
    if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return 0
  }
  const db = await openExisting(factory)
  if (!db) return 0
  db.onversionchange = () => db.close()
  try {
    const present = LEGACY_QUEUE_STORES.filter((name) => db.objectStoreNames.contains(name))
    return present.length ? await countRows(db, present) : 0
  } finally {
    db.close()
  }
}
