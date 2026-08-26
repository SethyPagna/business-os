import { useEffect, useMemo, useRef, useState } from 'react'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Unlink from 'lucide-react/dist/esm/icons/unlink.js'
import Modal from '../shared/Modal'

type Translate = (key: string, fallback?: string) => string | undefined

/** One product's proposed photo set, exactly as the preview endpoint sends it. */
export type WireImageChange = {
  productId: number
  productName: string
  imageIds: number[]
  imageNames: string[]
  imagePaths: string[]
  currentImagePath: string | null
  currentGallery: string[]
  replaces: boolean
}

export type WireImagesPreview = {
  changes: WireImageChange[]
  counts: {
    libraryImages: number
    matched: number
    unmatched: number
    ambiguous: number
    wouldChange: number
    wouldReplace: number
  }
  unmatched: string[]
  ambiguous: string[]
}

type ApplyResult = { success?: boolean; error?: string; updated?: number; imagesAttached?: number }
type UnwireResult = { success?: boolean; error?: string; cleared?: number }

interface WireImagesReviewModalProps {
  t?: Translate
  onClose: () => void
  onLoadPreview: () => Promise<WireImagesPreview>
  onConfirmWire: (changes: WireImageChange[]) => Promise<ApplyResult | undefined>
  onUnwire: (productIds: number[]) => Promise<UnwireResult | undefined>
  working: boolean
}

// Review step for "attach the photos already sitting in the Library to the
// products whose names they match".
//
// It is a review step and not a one-click action for the same reason the
// import's image wiring became explicit: this runs across the WHOLE catalog
// at once. Thousands of photos moving onto thousands of products is not
// something to trigger from a menu and discover afterwards.
//
// Three things the person needs to see before confirming, and all three are
// shown here rather than only the happy path:
//
//   - which products would CHANGE, and which of those already have a photo
//     that would be replaced (the destructive half, called out per row);
//   - which library files matched NOTHING (usually a filename typo, and the
//     fix is renaming the file, not confirming this);
//   - which files were AMBIGUOUS -- a name that resolves to more than one
//     product. Those are deliberately not wired at all: picking one would
//     attach a photo to the wrong item, silently.
export default function WireImagesReviewModal({
  t,
  onClose,
  onLoadPreview,
  onConfirmWire,
  onUnwire,
  working,
}: WireImagesReviewModalProps) {
  // t() returns the raw key itself on a miss, so `t(key) || fallback` never
  // actually falls back -- same T() shape as ZeroQuantityCleanupModal.
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WireImagesPreview | null>(null)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())
  const [acknowledged, setAcknowledged] = useState(false)
  const [result, setResult] = useState<ApplyResult | UnwireResult | null>(null)
  const [showUnwire, setShowUnwire] = useState(false)
  const mountedRef = useRef(true)
  const firstLoadRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runPreview = () => {
    setPreviewLoading(true)
    setPreviewError(null)
    onLoadPreview()
      .then((loaded) => {
        if (!mountedRef.current) return
        setPreview(loaded)
        setExcludedIds(new Set())
        setAcknowledged(false)
      })
      .catch((error) => { if (mountedRef.current) setPreviewError(error?.message || 'Failed to load the image match preview') })
      .finally(() => { if (mountedRef.current) setPreviewLoading(false) })
  }

  useEffect(() => {
    if (!firstLoadRef.current) return
    firstLoadRef.current = false
    runPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changes = preview?.changes || []
  const selectedChanges = useMemo(
    () => changes.filter((change) => !excludedIds.has(change.productId)),
    [changes, excludedIds],
  )
  const selectedReplaceCount = selectedChanges.filter((change) => change.replaces).length
  const selectedImageCount = selectedChanges.reduce((sum, change) => sum + change.imagePaths.length, 0)
  const canApply = !previewLoading && !previewError && selectedChanges.length > 0

  const toggleExcluded = (productId: number) => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const handleConfirm = async () => {
    setResult(null)
    const applied = await onConfirmWire(selectedChanges)
    if (!mountedRef.current) return
    setResult(applied || null)
    // Re-scan after a real write so the list reflects what is now stored
    // rather than what was pending a moment ago.
    if (applied?.success !== false && (applied?.updated || 0) > 0) runPreview()
  }

  // Unwire is intentionally scoped to the rows ON SCREEN -- the ones this
  // preview just showed as wired-or-changing. A "detach everything in the
  // catalog" button one click away from a review list is how someone
  // clears photos they never meant to touch.
  const wiredProductIds = useMemo(
    () => changes.filter((change) => change.replaces).map((change) => change.productId),
    [changes],
  )

  const handleUnwire = async () => {
    setResult(null)
    const cleared = await onUnwire(selectedChanges.map((change) => change.productId))
    if (!mountedRef.current) return
    setResult(cleared || null)
    if (cleared?.success !== false) runPreview()
  }

  const counts = preview?.counts
  const fileList = (files: string[]) => files.map((file) => (
    <li key={file} className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">{file}</li>
  ))

  return (
    <Modal title={T('wire_images_title', 'Wire images to products')} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
          <ImagePlus className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-blue-800 dark:text-blue-300">
            {T(
              'wire_images_summary',
              'Matches photos already in your Library to products by filename. "Rose Serum.jpg" goes to Rose Serum; add _1, _2 and _3 to give one product up to three photos. Only exact name matches are used -- nothing is attached on a guess, and nothing is attached until you confirm below.',
            )}
          </p>
        </div>

        {previewLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{T('wire_images_loading', 'Matching library photos to products...')}</span>
          </div>
        )}

        {!previewLoading && previewError && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{T('wire_images_error', 'Could not match the library against your products.')}</p>
              <p className="mt-0.5 text-xs opacity-80">{previewError}</p>
            </div>
          </div>
        )}

        {!previewLoading && !previewError && counts && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: T('wire_images_stat_library', 'Library photos'), value: counts.libraryImages },
              { label: T('wire_images_stat_matched', 'Matched a product'), value: counts.matched },
              { label: T('wire_images_stat_change', 'Products to update'), value: counts.wouldChange },
              { label: T('wire_images_stat_replace', 'Would replace a photo'), value: counts.wouldReplace },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{stat.value}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {!previewLoading && !previewError && changes.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            {T('wire_images_none', 'Every library photo that matches a product is already attached to it. Nothing to do.')}
          </div>
        )}

        {!previewLoading && !previewError && changes.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {T('wire_images_count', '{count} product(s) would get photos. Uncheck any you want to leave alone.')
                .replace('{count}', String(changes.length))}
            </p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {changes.map((change) => (
                <label
                  key={change.productId}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/40"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!excludedIds.has(change.productId)}
                    onChange={() => toggleExcluded(change.productId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{change.productName}</span>
                      <span className="text-xs text-gray-400">#{change.productId}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {T('wire_images_photo_count', '{count} photo(s)').replace('{count}', String(change.imagePaths.length))}
                      </span>
                      {change.replaces && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          {T('wire_images_replaces', 'Replaces its current photo')}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {change.imagePaths.map((path, index) => (
                        <img
                          key={path}
                          src={path}
                          alt={change.imageNames[index] || ''}
                          loading="lazy"
                          className="h-10 w-10 rounded border border-gray-200 object-cover dark:border-gray-700"
                        />
                      ))}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-400">
                      {change.imageNames.join(' · ')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Unmatched and ambiguous are shown even though nothing will happen
            to them: they are the reason a run looks "incomplete", and
            without them the person has no way to tell a missing photo from
            a mistyped filename. */}
        {!previewLoading && !previewError && counts && (counts.unmatched > 0 || counts.ambiguous > 0) && (
          <section className="grid gap-2 sm:grid-cols-2">
            {counts.unmatched > 0 && (
              <details className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-400">
                  {T('wire_images_unmatched', '{count} photo(s) matched no product').replace('{count}', String(counts.unmatched))}
                </summary>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {T('wire_images_unmatched_hint', 'Rename the file to the product name exactly, then run this again.')}
                </p>
                <ul className="mt-1 space-y-0.5">{fileList(preview?.unmatched || [])}</ul>
              </details>
            )}
            {counts.ambiguous > 0 && (
              <details className="rounded-lg border border-amber-200 p-2.5 dark:border-amber-900/40">
                <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-400">
                  {T('wire_images_ambiguous', '{count} photo(s) matched more than one product').replace('{count}', String(counts.ambiguous))}
                </summary>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {T('wire_images_ambiguous_hint', 'These are left alone on purpose -- attaching one of several same-named products would be a guess. Merge the duplicates, or rename them apart, first.')}
                </p>
                <ul className="mt-1 space-y-0.5">{fileList(preview?.ambiguous || [])}</ul>
              </details>
            )}
          </section>
        )}

        {result && (
          <div className={`flex items-start gap-3 rounded-lg border p-3 ${
            result.success === false
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300'
              : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-300'
          }`}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {result.success === false
                ? result.error || T('failed', 'Failed')
                : 'cleared' in result
                  ? T('wire_images_unwired_summary', 'Detached photos from {count} product(s). The files are still in your Library.')
                    .replace('{count}', String((result as UnwireResult).cleared || 0))
                  : T('wire_images_applied_summary', 'Attached {images} photo(s) to {products} product(s).')
                    .replace('{images}', String((result as ApplyResult).imagesAttached || 0))
                    .replace('{products}', String((result as ApplyResult).updated || 0))}
            </p>
          </div>
        )}

        {selectedReplaceCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {T('wire_images_replace_warning', '{count} of the checked products already have a photo, which will be replaced. The old file stays in your Library.')
                .replace('{count}', String(selectedReplaceCount))}
            </p>
          </div>
        )}

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            disabled={!canApply}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            {T('wire_images_acknowledge', 'I have reviewed this list and want to attach the checked photos.')}
          </span>
        </label>

        {/* Detach is behind its own disclosure rather than sitting next to
            Confirm. It is the undo for this feature -- needed, because
            wiring applies across the whole catalog at once and undoing it
            product by product is not realistic -- but it is destructive to
            what is on screen, so it should not be a neighbour of the
            primary button. */}
        {wiredProductIds.length > 0 && (
          <details
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            onToggle={(event) => setShowUnwire((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-400">
              {T('wire_images_unwire_toggle', 'Detach photos instead')}
            </summary>
            {showUnwire && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {T(
                    'wire_images_unwire_hint',
                    'Removes the link between the checked products and their photos. The files stay in your Library, so you can fix the filenames and wire them again.',
                  )}
                </p>
                <button
                  type="button"
                  onClick={handleUnwire}
                  disabled={!selectedChanges.length || working}
                  className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  <Unlink className="h-4 w-4" />
                  {T('wire_images_unwire_confirm', 'Detach photos from {count} product(s)').replace('{count}', String(selectedChanges.length))}
                </button>
              </div>
            )}
          </details>
        )}

        {/* Sticky footer, same pattern as ZeroQuantityCleanupModal's. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={handleConfirm}
            disabled={!acknowledged || !canApply || working}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {working
              ? T('wire_images_working', 'Attaching...')
              : T('wire_images_confirm_count', 'Attach {images} photo(s) to {products} product(s)')
                .replace('{images}', String(selectedImageCount))
                .replace('{products}', String(selectedChanges.length))}
          </button>
          <button
            onClick={onClose}
            disabled={working}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
          >
            {T('cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
