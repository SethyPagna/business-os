export function getScrollTarget(root = window) {
  if (!root?.document?.querySelector) return root
  const candidates = Array.from(root.document.querySelectorAll('.page-scroll'))
  const activeTarget = candidates.find((node) => {
    if (!node) return false
    const style = root.getComputedStyle ? root.getComputedStyle(node) : null
    if (style?.display === 'none' || style?.visibility === 'hidden') return false
    return node.getClientRects?.().length > 0
  })
  return activeTarget || root.document.querySelector('.page-scroll') || root
}

export function getScrollToPosition(target, direction = 'top') {
  if (direction === 'top') return 0
  if (target?.scrollHeight != null && target?.clientHeight != null) {
    return Math.max(0, Number(target.scrollHeight || 0) - Number(target.clientHeight || 0))
  }
  const doc = target?.document?.documentElement
  return Math.max(0, Number(doc?.scrollHeight || 0) - Number(doc?.clientHeight || 0))
}
