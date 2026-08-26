import { Suspense, useCallback, useState } from 'react'
import ScanLine from 'lucide-react/dist/esm/icons/scan-line.js'
import { lazyRetry } from '../../utils/lazyImport.ts'

// Lazy-loaded so the camera/zxing scanning code (already used by the
// product-form barcode scanner) isn't pulled into the initial bundle for
// pages that never open it -- same pattern as ProductForm.tsx.
const BarcodeScannerModal = lazyRetry(() => import('../products/scanning/BarcodeScannerModal'), 'search-barcode-scanner-modal')

interface ScanSearchButtonProps {
  /** Called with the scanned barcode/SKU value -- typically wired to setSearch(value). */
  onDetected: (value: string) => void
  t: (key: string) => string
  title?: string
  /** Compact icon-only button to sit flush against a search input, matching
   * the existing FilterMenu/SearchModeToggle button sizing in these rows. */
  className?: string
  /**
   * Render the word "Scan" beside the icon instead of the icon alone.
   *
   * The icon-only form is easy to miss on a page whose other controls are
   * also small squares -- a scanner button that nobody finds is the same as
   * not having one. Opt-in rather than default so existing toolbars, which
   * are laid out around a 40px square, are untouched.
   */
  showLabel?: boolean
}

/**
 * Small camera-icon button that opens the shared barcode scanner and feeds
 * the result straight into a search box -- lets a phone's built-in camera
 * stand in for a physical barcode scanner when searching Products,
 * Inventory, or the POS catalog.
 *
 * Sized larger than its neighboring SearchModeToggle (h-10 w-10 here vs.
 * SearchModeToggle's h-7/h-8) -- this is the button people actually reach
 * for mid-scan, so it gets the bigger tap target and the AND/OR toggle
 * gives up the room. Pass `className` to override on a per-page basis if
 * a specific row needs to match older sizing.
 */
export default function ScanSearchButton({ onDetected, t, title, className = '', showLabel = false }: ScanSearchButtonProps) {
  const [open, setOpen] = useState(false)
  const label = title || t('scan_barcode') || 'Scan barcode'

  const handleDetected = useCallback((value: string) => {
    setOpen(false)
    const trimmed = String(value || '').trim()
    if (trimmed) onDetected(trimmed)
  }, [onDetected])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={`inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors ${
          showLabel
            // Given a label it stops being a neutral square and reads as the
            // primary action it is -- accented border and text, not another
            // grey icon in a row of grey icons.
            // Compact on purpose: the label has to survive on a phone
            // without crowding out the search box next to it, so this trades
            // padding and type size rather than dropping the word.
            ? 'gap-1 border-blue-300 bg-blue-50 px-2 text-xs text-blue-700 hover:border-blue-400 hover:bg-blue-100 sm:gap-1.5 sm:px-3 sm:text-sm dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
            : 'w-10 border-gray-300 bg-white text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300'
        } ${className}`.trim()}
      >
        <ScanLine className={showLabel ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-5 w-5'} />
        {showLabel ? <span>{t('scan') || 'Scan'}</span> : null}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            open={open}
            title={label}
            onClose={() => setOpen(false)}
            onDetected={handleDetected}
            t={t}
            hideManualEntry
          />
        </Suspense>
      ) : null}
    </>
  )
}
