// Browser page translation vs React (P-public-1 follow-up, refuter 2026-09-25).
//
// Chrome's built-in translator rewrites text nodes in place -- it wraps them
// in <font> elements and moves them. React still holds the ORIGINAL text
// nodes, so the next commit that removes or inserts next to one calls
// parent.removeChild(child) / parent.insertBefore(node, ref) on a node whose
// parent is no longer `parent`, and the DOM throws NotFoundError. Until now
// the only recovery was publicErrorRecovery.ts reloading the page (rate
// limited to once per 10s), so a translated visitor could see repeated
// reloads while browsing.
//
// The widely used guard: when the node is not actually a child, skip the
// operation instead of throwing (removeChild returns the child; insertBefore
// with a foreign reference appends). React's own bookkeeping stays
// consistent, and the translated copy of the text is at worst left behind
// until the next render replaces it. The reload recovery stays as the last
// resort for anything this does not cover.
//
// Installed on EVERY storefront page load by PublicCatalogRoot.tsx (the
// storefront entry): Chrome's built-in translator and translation extensions
// cause this crash on the Khmer and English pages alike. The guard only
// changes calls that would otherwise throw. Never installed by the admin app
// (AdminRoot).

export const PORTAL_TRANSLATE_DOM_GUARD_FLAG = '__businessOsTranslateDomGuard'

type GuardableNodePrototype = {
  removeChild: (child: any) => any
  insertBefore: (node: any, ref: any) => any
  appendChild?: (node: any) => any
  [PORTAL_TRANSLATE_DOM_GUARD_FLAG]?: boolean
}

function resolveNodePrototype(explicit?: GuardableNodePrototype | null): GuardableNodePrototype | null {
  if (explicit) return explicit
  const NodeCtor = (globalThis as { Node?: { prototype?: GuardableNodePrototype } }).Node
  return NodeCtor?.prototype || null
}

export function isPortalTranslateDomGuardInstalled(proto?: GuardableNodePrototype | null): boolean {
  return Boolean(resolveNodePrototype(proto)?.[PORTAL_TRANSLATE_DOM_GUARD_FLAG])
}

/** Idempotent: a second call is a no-op. Returns true when the guard is (now) in place. */
export function installPortalTranslateDomGuard(proto?: GuardableNodePrototype | null): boolean {
  const target = resolveNodePrototype(proto)
  if (!target || typeof target.removeChild !== 'function' || typeof target.insertBefore !== 'function') return false
  if (target[PORTAL_TRANSLATE_DOM_GUARD_FLAG]) return true

  const nativeRemoveChild = target.removeChild
  const nativeInsertBefore = target.insertBefore

  target.removeChild = function guardedRemoveChild(this: unknown, child: { parentNode?: unknown } | null) {
    if (child && child.parentNode !== this) return child
    return nativeRemoveChild.call(this, child)
  }
  target.insertBefore = function guardedInsertBefore(this: { appendChild?: (node: unknown) => unknown }, node: unknown, ref: { parentNode?: unknown } | null) {
    if (ref && ref.parentNode !== this) {
      return typeof this.appendChild === 'function' ? this.appendChild(node) : node
    }
    return nativeInsertBefore.call(this, node, ref)
  }
  Object.defineProperty(target, PORTAL_TRANSLATE_DOM_GUARD_FLAG, { value: true, configurable: true })
  return true
}
