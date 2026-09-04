// A mouse wheel over a focused `<input type="number">` silently increments or
// decrements its value using the browser's native step behaviour -- reported
// live in POS, payment $20 -> $19 while scrolling the panel underneath it
// (progress.md, Part-549). There is no shared number-input component (77
// hand-rolled `type="number"` inputs across 22 files), so the fix is a single
// document-level guard rather than 77 per-site edits.
//
// Blur, not preventDefault: blurring the element before the browser resolves
// the wheel event's default action stops the value from scrubbing, without
// stopping the panel itself from scrolling. preventDefault would also stop
// the panel scroll, trading the money bug for a usability one.

export interface WheelGuardTarget {
  tagName?: string
  type?: string
  blur?: () => void
}

export function isNumberInputTarget(el: unknown): el is WheelGuardTarget & { blur: () => void } {
  if (!el || typeof el !== 'object') return false
  const candidate = el as WheelGuardTarget
  return candidate.tagName === 'INPUT' && candidate.type === 'number' && typeof candidate.blur === 'function'
}

export function handleNumberInputWheel(activeElement: unknown): void {
  if (isNumberInputTarget(activeElement)) {
    activeElement.blur()
  }
}

export function installNumberInputWheelGuard(doc: Document = document): () => void {
  const onWheel = () => { handleNumberInputWheel(doc.activeElement) }
  const options: AddEventListenerOptions = { capture: true, passive: true }
  doc.addEventListener('wheel', onWheel, options)
  return () => doc.removeEventListener('wheel', onWheel, options)
}
