export function getScrollTarget(root = window) {
  if (!root?.document?.querySelector) return root
  return root.document.querySelector('.page-scroll') || root
}

export function getScrollToPosition(target, direction = 'top') {
  if (direction === 'top') return 0
  if (target?.scrollHeight != null && target?.clientHeight != null) {
    return Math.max(0, Number(target.scrollHeight || 0) - Number(target.clientHeight || 0))
  }
  const doc = target?.document?.documentElement
  return Math.max(0, Number(doc?.scrollHeight || 0) - Number(doc?.clientHeight || 0))
}
