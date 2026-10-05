// The bell badge counts alert rows the person has not looked at lately (Settings -> "Unresolved alert
// repeat interval"). The Worker sends only a 50-row preview of a very long section (inventory), so the
// rows it did not list cannot each be stamped as seen; they are tracked as one block instead -- when
// the block was last seen and how many rows it held then.
//
// The rule is the per-row one, applied to the block: never seen, or last seen a full window ago, counts
// every unlisted row; inside the window only rows beyond the number seen then are new.

export type SeenTail = { at: number; count: number }

export function unseenTailCount(size: number, seen: SeenTail | undefined, now: number, realertMs: number): number {
  const rows = Math.max(0, Math.floor(Number(size) || 0))
  if (!rows) return 0
  if (!seen || !Number.isFinite(seen.at) || (now - seen.at) >= realertMs) return rows
  return Math.max(0, rows - Math.max(0, Math.floor(Number(seen.count) || 0)))
}
