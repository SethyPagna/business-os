// useBarcodeScan.ts -- P2-2 (search + barcode scan core). Reusable hook that
// generalizes the camera-scan pattern already implemented inline by
// src/components/shared/ScanSearchButton.tsx (open state, auto-close on
// detect, trim-and-forward the value) and adds keyboard-wedge physical
// scanner support on top.
//
// Decision 9 (binding, see docs/history/session-log.md / the P2-2 brief): a
// barcode scan must NEVER auto-add/auto-pick/auto-open anything. This hook
// only ever calls `onValue(trimmedValue)` -- the caller's job is to drop that
// value into its search box and let the normal search/matcher narrow the
// list, then require an explicit user click/confirm on the single exact hit.
// This hook does not select, add, confirm, or navigate on the caller's
// behalf; it does not know what a "match" or a "product" is.
//
// Camera path: the caller renders BarcodeScannerModal itself (open={open}
// onClose={closeScanner} onDetected={handleDetected} ...) -- this hook does
// not render anything, matching every other headless hook in this codebase.
// BarcodeScannerModal calls onDetected on every detection path (native
// BarcodeDetector, ZXing fallback, photo upload, manual "Use value") without
// closing itself; handleDetected here is what actually closes it, exactly
// mirroring ScanSearchButton.tsx's own handleDetected.
//
// Keyboard-wedge path: physical USB/BT barcode scanners emulate a keyboard,
// typing every character of the scanned value in rapid succession (far
// faster than a human types) then Enter. wedge.onKeyDown detects a burst of
// >= WEDGE_MIN_CHARS characters each arriving < WEDGE_MAX_GAP_MS apart,
// ending in Enter -- on a qualifying burst it calls preventDefault() (so the
// Enter doesn't submit whatever form the focused search input sits in) and
// forwards the accumulated value to onValue instead. A slow gap anywhere in
// the sequence, a non-character key (Backspace/Tab/Escape/arrows), or a real
// modifier chord (Ctrl/Alt/Meta) resets the buffer -- only a lone Shift (for
// uppercase/punctuation, which many wedge scanners emit) is ignored without
// resetting, since it doesn't produce a character of its own.
import { useCallback, useRef, useState } from 'react'

const WEDGE_MAX_GAP_MS = 35
const WEDGE_MIN_CHARS = 4

const IGNORED_STANDALONE_KEYS = new Set(['Shift', 'CapsLock'])

export interface UseBarcodeScanOptions {
  /** Called with the trimmed scanned/wedge value. Never called with an empty string. */
  onValue: (value: string) => void
}

export interface UseBarcodeScanResult {
  /** Pass straight to BarcodeScannerModal's `open` prop. */
  open: boolean
  openScanner: () => void
  closeScanner: () => void
  /** Pass straight to BarcodeScannerModal's `onDetected` prop. */
  handleDetected: (value: string) => void
  wedge: {
    /** Attach to the search input's onKeyDown. */
    onKeyDown: (event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; preventDefault: () => void }) => void
  }
}

export function useBarcodeScan({ onValue }: UseBarcodeScanOptions): UseBarcodeScanResult {
  const [open, setOpen] = useState(false)
  const bufferRef = useRef('')
  const lastCharTimeRef = useRef(0)

  const openScanner = useCallback(() => setOpen(true), [])
  const closeScanner = useCallback(() => setOpen(false), [])

  const handleDetected = useCallback((value: string) => {
    setOpen(false)
    const trimmed = String(value || '').trim()
    if (trimmed) onValue(trimmed)
  }, [onValue])

  const onKeyDown = useCallback((event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; preventDefault: () => void }) => {
    const key = event.key
    if (IGNORED_STANDALONE_KEYS.has(key)) return

    if (event.ctrlKey || event.altKey || event.metaKey) {
      // A real modifier chord (paste, select-all, ...) is a human at the
      // keyboard, not a wedge scanner -- abandon whatever burst was building.
      bufferRef.current = ''
      return
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()

    if (key === 'Enter') {
      const candidate = bufferRef.current
      bufferRef.current = ''
      if (candidate.length >= WEDGE_MIN_CHARS) {
        event.preventDefault()
        onValue(candidate)
      }
      return
    }

    if (key.length !== 1) {
      // Backspace/Tab/Escape/arrows/etc -- not a character a scanner would
      // emit; a human editing or navigating the field. Break the burst.
      bufferRef.current = ''
      return
    }

    const gap = now - lastCharTimeRef.current
    bufferRef.current = bufferRef.current.length > 0 && gap < WEDGE_MAX_GAP_MS ? bufferRef.current + key : key
    lastCharTimeRef.current = now
  }, [onValue])

  return { open, openScanner, closeScanner, handleDetected, wedge: { onKeyDown } }
}

export default useBarcodeScan
