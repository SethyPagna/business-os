export function orderProductRestoreSnapshots(snapshots = []) {
  const source = Array.isArray(snapshots) ? snapshots.filter(Boolean) : []
  const pending = [...source]
  const ordered = []
  const deletedIds = new Set(
    source
      .map((snapshot) => Number(snapshot?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0),
  )

  while (pending.length) {
    let progressed = false

    for (let index = 0; index < pending.length; index += 1) {
      const snapshot = pending[index]
      const parentId = Number(snapshot?.parent_id || 0)
      const parentWasDeleted = parentId > 0 && deletedIds.has(parentId)
      if (parentWasDeleted && !ordered.some((item) => Number(item?.id || 0) === parentId)) {
        continue
      }
      ordered.push(snapshot)
      pending.splice(index, 1)
      progressed = true
      index -= 1
    }

    if (!progressed) {
      throw new Error('Unable to rebuild deleted products because their group parent could not be restored first.')
    }
  }

  return ordered
}
