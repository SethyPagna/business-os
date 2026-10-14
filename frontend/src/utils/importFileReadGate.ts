import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent } from './loaders.ts'

// Reading an Excel file takes seconds and the dialog stays interactive, so the
// result of a read may only land while it is still the latest pick. A newer
// read, cancel() (a mode switch) or closing the dialog drops it, and aborts the
// worker behind it wherever the read can be cancelled.
export function createImportFileReadGate() {
  const requestRef = { current: 0 }
  let controller: AbortController | null = null

  function cancel(): void {
    invalidateTrackedRequest(requestRef)
    controller?.abort()
    controller = null
  }

  async function read<T>(
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void | Promise<void>,
    fail: (error: unknown) => void,
  ): Promise<void> {
    controller?.abort()
    const requestId = beginTrackedRequest(requestRef)
    const current = new AbortController()
    controller = current
    try {
      const value = await load(current.signal)
      if (!isTrackedRequestCurrent(requestRef, requestId)) return
      await apply(value)
    } catch (error) {
      if (isTrackedRequestCurrent(requestRef, requestId)) fail(error)
    } finally {
      if (controller === current) controller = null
    }
  }

  return { read, cancel }
}
