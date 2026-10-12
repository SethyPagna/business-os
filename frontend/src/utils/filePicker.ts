// The OS file picker has no single "cancelled" signal on every platform: current browsers fire `cancel` on the
// input, older ones only hand focus back to the window, and Android returns a camera photo through `change`
// AFTER the window has already regained focus. A picker that waits for `change` alone never settles when the
// person backs out, which leaves the caller's in-flight lock held and the button dead.
const FOCUS_SETTLE_MS = 300
const LATE_CHANGE_WINDOW_MS = 120_000

export interface PickFilesOptions {
  accept?: string
  capture?: string
  maxCount?: number
  /** A `change` that arrives after the focus fallback already reported "nothing chosen". */
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
    const dispose = (): void => {
      window.removeEventListener('focus', onWindowFocus)
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
    const onWindowFocus = (): void => {
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        const files = chosen()
        answer(files)
        if (files.length || !onLateChange) {
          dispose()
          return
        }
        window.removeEventListener('focus', onWindowFocus)
        lateTimer = setTimeout(dispose, LATE_CHANGE_WINDOW_MS)
      }, FOCUS_SETTLE_MS)
    }

    input.addEventListener('change', onChange)
    input.addEventListener('cancel', onCancel)
    window.addEventListener('focus', onWindowFocus)
    document.body.appendChild(input)
    input.click()
  })
}
