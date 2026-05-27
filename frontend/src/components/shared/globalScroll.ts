type ScrollNode = {
  scrollHeight?: number
  clientHeight?: number
  getClientRects?: () => { length: number }
}

type DocumentLike = {
  querySelector?: (selector: string) => ScrollNode | null
  querySelectorAll?: (selector: string) => Iterable<ScrollNode> | ArrayLike<ScrollNode>
  scrollingElement?: ScrollNode | null
  documentElement?: ScrollNode | null
}

type RootLike = {
  document?: DocumentLike
  getComputedStyle?: (node: ScrollNode) => { display?: string; visibility?: string } | null
}

type ScrollTarget = ScrollNode | RootLike | Window

function getDocumentLike(root: ScrollTarget): DocumentLike | null {
  return (root as RootLike | null | undefined)?.document || null
}

function getPageScrollCandidates(root: ScrollTarget): ScrollNode[] {
  const documentLike = getDocumentLike(root)
  if (!documentLike) return []
  if (typeof documentLike.querySelectorAll === 'function') {
    return Array.from(documentLike.querySelectorAll('.page-scroll'))
  }
  if (typeof documentLike.querySelector === 'function') {
    const node = documentLike.querySelector('.page-scroll')
    return node ? [node] : []
  }
  return []
}

function isVisibleScrollNode(root: ScrollTarget, node: ScrollNode): boolean {
  const style = (root as RootLike).getComputedStyle ? (root as RootLike).getComputedStyle?.(node) : null
  if (style?.display === 'none' || style?.visibility === 'hidden') return false
  const clientRectCount = node.getClientRects?.().length
  if (clientRectCount != null) return clientRectCount > 0
  return true
}

export function getScrollTarget(root: ScrollTarget = window): ScrollTarget {
  const documentLike = getDocumentLike(root)
  if (!documentLike?.querySelector && !documentLike?.querySelectorAll) return root
  const candidates = getPageScrollCandidates(root)
  const activeTarget = candidates.find((node) => {
    if (!node) return false
    if (!isVisibleScrollNode(root, node)) return false
    return Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 4
  })
  if (activeTarget) return activeTarget
  const visibleTarget = candidates.find((node) => {
    if (!node) return false
    return isVisibleScrollNode(root, node)
  })
  return visibleTarget || documentLike.scrollingElement || documentLike.documentElement || root
}

export function getScrollToPosition(target: ScrollTarget, direction = 'top'): number {
  if (direction === 'top') return 0
  if ((target as ScrollNode)?.scrollHeight != null && (target as ScrollNode)?.clientHeight != null) {
    const node = target as ScrollNode
    return Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0))
  }
  const doc = (target as RootLike)?.document?.documentElement
  return Math.max(0, Number(doc?.scrollHeight || 0) - Number(doc?.clientHeight || 0))
}
