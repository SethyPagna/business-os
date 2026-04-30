export function cloneHistorySnapshot(value) {
  return JSON.parse(JSON.stringify(value))
}

export function extractHistoryResultId(result) {
  const value = Number(
    result?.id
    ?? result?.data?.id
    ?? result?.item?.id
    ?? 0,
  )
  return Number.isFinite(value) && value > 0 ? value : 0
}
