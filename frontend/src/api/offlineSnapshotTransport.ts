// K5: stub until U-drain removes the web-api.ts callers.
//
// This module used to refresh an "offline device snapshot" every five
// minutes and on every reconnect/focus: eleven GETs per run -- settings
// (forced past the cache), categories, units, branches, the product list,
// customers, suppliers, delivery contacts, sales, the unpaged /api/returns
// and /api/inventory/movements?pageSize=5000 -- so that a till could keep
// selling with the server unreachable. Offline selling is cancelled (owner,
// 26 Sep 2026), and on any http(s) origin the results were not even kept:
// localMirrors.ts's shouldPersistLocalMirror() refused every write, so the
// reads were pure load on the Worker and D1.
//
// web-api.ts (owned by the U-drain lane) still imports this module from
// refreshOfflineSnapshotSoon() and from its window.api wrapper. Until that
// lane deletes those callers, this stub keeps the same export and signature
// and does no work: no request, no IndexedDB, no event. Delete this file in
// the same change that removes the last import.

type SnapshotOptions = { force?: boolean }

export type OfflineDeviceSnapshotResult = { skipped: true; reason: 'offline_snapshot_retired' }

export async function refreshOfflineDeviceSnapshot(_options: SnapshotOptions = {}): Promise<OfflineDeviceSnapshotResult> {
  return { skipped: true, reason: 'offline_snapshot_retired' }
}
