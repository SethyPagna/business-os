// Dependency-free geometry lives outside the shared-component chunk bucket.
export function helpPopoverGeometry(
  trigger: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; top: number; width: number; height: number },
  align: 'left' | 'right' | 'auto' = 'right',
) {
  const gutter = Math.min(8, viewport.width / 4, viewport.height / 4)
  const leftEdge = viewport.left + gutter
  const topEdge = viewport.top + gutter
  const rightEdge = viewport.left + viewport.width - gutter
  const bottomEdge = viewport.top + viewport.height - gutter
  const width = Math.max(0, Math.min(288, rightEdge - leftEdge))
  const below = Math.max(0, bottomEdge - Math.max(topEdge, trigger.bottom + 6))
  const above = Math.max(0, Math.min(bottomEdge, trigger.top - 6) - topEdge)
  const placement = below >= 288 || below >= above ? 'below' : 'above'
  const maxHeight = Math.min(288, placement === 'below' ? below : above)
  const anchor = align === 'left' || (align === 'auto' && trigger.left + width <= rightEdge)
    ? trigger.left : trigger.right - width
  return {
    left: Math.max(leftEdge, Math.min(rightEdge - width, anchor)),
    top: Math.max(topEdge, Math.min(bottomEdge, placement === 'below' ? trigger.bottom + 6 : trigger.top - 6)),
    width, maxHeight, placement,
  }
}
