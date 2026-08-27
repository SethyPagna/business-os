export interface LogicalLibraryAssetLike {
  id: string | number
  logical_id?: string | null
  logical_name?: string | null
  original_name?: string | null
  referenceProduct?: { id: string | number; name?: string | null } | null
}

export function logicalAssetKey(asset: LogicalLibraryAssetLike): string {
  return String(asset.logical_id || `${asset.id}:asset`)
}

export function logicalAssetDisplayName(asset: LogicalLibraryAssetLike): string {
  return String(asset.logical_name || asset.original_name || 'file')
}

export function logicalAssetDownloadPath(asset: LogicalLibraryAssetLike): string {
  return `/api/files/${encodeURIComponent(String(asset.id))}/download?name=${encodeURIComponent(logicalAssetDisplayName(asset))}`
}
