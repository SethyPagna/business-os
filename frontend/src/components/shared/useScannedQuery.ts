import { useCallback, useEffect, useState } from 'react'

/**
 * Which text in a search box came from a scan (camera or gun) rather than from typing.
 *
 * `markScanned(code)` is called together with the surface's own "set the search" for a
 * scan (same render batch). The code counts as scanned only while the box still holds
 * exactly that text: typing, clearing or picking something else ends it, and typing the
 * same digits again afterwards is a typed query, not a scan. That is what lets a page
 * say "No product has barcode ..." for a scan and keep its plain empty state for typing.
 */
export function useScannedQuery(search: string): { scannedCode: string | null; markScanned: (code: string) => void } {
  const [scanned, setScanned] = useState<string | null>(null)
  useEffect(() => {
    if (scanned !== null && scanned !== search) setScanned(null)
  }, [scanned, search])
  const markScanned = useCallback((code: string) => setScanned(code), [])
  return { scannedCode: scanned !== null && scanned === search ? scanned : null, markScanned }
}
