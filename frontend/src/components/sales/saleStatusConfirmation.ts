export interface SingleUseResult<Result> {
  promise: Promise<Result>
  settle: (result: Result) => boolean
  isPending: () => boolean
}

export function createSingleUseResult<Result>(): SingleUseResult<Result> {
  let pending = true
  let resolvePromise!: (result: Result) => void
  const promise = new Promise<Result>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    settle(result) {
      if (!pending) return false
      pending = false
      resolvePromise(result)
      return true
    },
    isPending: () => pending,
  }
}
