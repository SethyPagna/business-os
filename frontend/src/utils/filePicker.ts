// The OS file picker has no single "cancelled" signal on every platform: current browsers fire `cancel` on the
// input, older ones only hand focus back to the window, and Android returns a camera photo through `change`
// AFTER the window has already regained focus. iOS before 16.4 reports neither `cancel` nor a window `focus`
// when the picker is dismissed. A picker that waits for `change` alone never settles when the person backs out,
// which leaves the caller's in-flight lock held and the button dead, so every signal that proves the picker is
// gone settles it:
//   - `cancel` on the input (settles at once);
//   - the window regaining focus, the page becoming visible again, or a restored page (`pageshow`), after a short
//     wait, because Android reports the camera's `change` just after the focus;
//   - the first touch or click anywhere on the page (settles at once): nothing can be tapped while the OS picker
//     covers the page, so a tap means it is gone, whatever the browser did or did not report.
// Settling without a choice never loses a photo: a caller that passes `onLateChange` still receives a `change`
// that arrives afterwards.
const FOCUS_SETTLE_MS = 300
const LATE_CHANGE_WINDOW_MS = 120_000

export interface PickFilesOptions {
  accept?: string
  capture?: string
  maxCount?: number
  /** A `change` that arrives after a fallback already reported "nothing chosen". */
  onLateChange?: (files: File[]) => void
}

export function pickFiles({ accept = 'image/*', capture, maxCount = 1, onLateChange }: PickFilesOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    if (capture) input.setAttribute('capture', capture)
    input.multiple = maxCount > 1
    // Attached but invisible: some mobile browsers and in-app webviews only fire `change` on an input that is in the document.
    input.style.position = 'fixed'
    input.style.top = '-1000px'
    input.style.left = '-1000px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'

    let answered = false
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    let lateTimer: ReturnType<typeof setTimeout> | null = null

    const chosen = (): File[] => Array.from(input.files || []).slice(0, maxCount)
    const stopWatchingThePage = (): void => {
      window.removeEventListener('focus', onPageReturned)
      window.removeEventListener('pageshow', onPageReturned)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointerdown', onPageTouched, true)
      window.removeEventListener('touchstart', onPageTouched, true)
    }
    const dispose = (): void => {
      stopWatchingThePage()
      input.removeEventListener('change', onChange)
      input.removeEventListener('cancel', onCancel)
      if (focusTimer) clearTimeout(focusTimer)
      if (lateTimer) clearTimeout(lateTimer)
      input.remove()
    }
    const answer = (files: File[]): void => {
      if (answered) return
      answered = true
      resolve(files)
    }
    const onChange = (): void => {
      const files = chosen()
      const late = answered
      dispose()
      if (late) {
        if (files.length) onLateChange?.(files)
        return
      }
      answer(files)
    }
    const onCancel = (): void => {
      dispose()
      answer([])
    }
    // The picker is gone and no `change` has come: report what is on the input (nothing, normally). With a late
    // handler the input stays for a while so a camera photo that arrives afterwards is still delivered.
    const settleWithoutChange = (): void => {
      if (focusTimer) clearTimeout(focusTimer)
      const files = chosen()
      answer(files)
      if (files.length || !onLateChange) {
        dispose()
        return
      }
      stopWatchingThePage()
      lateTimer = setTimeout(dispose, LATE_CHANGE_WINDOW_MS)
    }
    function onPageReturned(): void {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(settleWithoutChange, FOCUS_SETTLE_MS)
    }
    function onVisibilityChange(): void {
      if (document.visibilityState !== 'hidden') onPageReturned()
    }
    function onPageTouched(): void {
      settleWithoutChange()
    }

    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    window.addEventListener('focus', onPageReturned)
    window.addEventListener('pageshow', onPageReturned)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Capture phase, so a control that stops propagation cannot hide the tap; passive, so it can never hold up a
    // scroll. Touch as well as pointer: pointer events only arrive in iOS 13, and the devices this fallback is
    // for are the old ones.
    window.addEventListener('pointerdown', onPageTouched, { capture: true, passive: true })
    window.addEventListener('touchstart', onPageTouched, { capture: true, passive: true })
    document.body.appendChild(input)
    input.click()
  })
}
