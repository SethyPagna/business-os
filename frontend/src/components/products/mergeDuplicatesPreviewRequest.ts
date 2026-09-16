export type MergeDuplicatesPreviewRequest = {
  signal: AbortSignal
  isCurrent: () => boolean
  finish: () => boolean
}

/** Owns the modal's single live preview request and rejects stale completions. */
export function createMergeDuplicatesPreviewRequestCoordinator(): {
  begin: () => MergeDuplicatesPreviewRequest
  cancel: () => void
} {
  let active: AbortController | null = null

  return {
    begin() {
      active?.abort()
      const controller = new AbortController()
      active = controller
      return {
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted,
        finish: () => {
          if (active !== controller) return false
          active = null
          return !controller.signal.aborted
        },
      }
    },
    cancel() {
      active?.abort()
      active = null
    },
  }
}
