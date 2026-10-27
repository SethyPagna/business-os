import { useEffect, useRef, useState } from 'react'

// When typed text becomes "the search". A server search of sales is the most expensive
// read the page makes, so it waits for the typing to stop instead of following the keys:
//   - a pause of SALES_SEARCH_SETTLE_MS settles the text;
//   - while an IME composition is open (Khmer and predictive keyboards send half-formed
//     fragments through onChange) nothing settles; the end of the composition starts the pause;
//   - clearing the box settles at once, since there is nothing to search for.
export const SALES_SEARCH_SETTLE_MS = 350

type SettlerTimers = {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (timer: unknown) => void
}

export type SearchSettler = {
  input: (value: string) => void
  compositionStart: () => void
  compositionEnd: () => void
  dispose: () => void
}

export function createSearchSettler(
  initial: string,
  onSettled: (value: string) => void,
  delayMs: number = SALES_SEARCH_SETTLE_MS,
  timers: SettlerTimers = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
): SearchSettler {
  let latest = initial
  let settled = initial
  let composing = false
  let timer: unknown = null
  const cancel = () => {
    if (timer != null) timers.clearTimeout(timer)
    timer = null
  }
  const settle = () => {
    cancel()
    if (latest === settled) return
    settled = latest
    onSettled(latest)
  }
  const arm = () => {
    cancel()
    if (latest === settled) return
    if (latest === '') { settle(); return }
    timer = timers.setTimeout(() => { timer = null; settle() }, delayMs)
  }
  return {
    input(value) {
      latest = value
      if (!composing) arm()
    },
    compositionStart() {
      composing = true
      cancel()
    },
    compositionEnd() {
      composing = false
      arm()
    },
    dispose: cancel,
  }
}

/** The settled text for `value`, plus the composition handlers to spread onto the search input. */
export function useSettledSearch(value: string) {
  const [settled, setSettled] = useState(value)
  const settlerRef = useRef<SearchSettler | null>(null)
  if (!settlerRef.current) settlerRef.current = createSearchSettler(value, setSettled)
  const settler = settlerRef.current
  useEffect(() => { settler.input(value) }, [settler, value])
  useEffect(() => () => settler.dispose(), [settler])
  return {
    settled,
    compositionProps: {
      onCompositionStart: () => settler.compositionStart(),
      onCompositionEnd: () => settler.compositionEnd(),
    },
  }
}
