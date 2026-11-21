import type { ReactNode } from 'react'

// The accessible name of a container whose content changes after it mounts.
// Google Translate never translates text added later inside an element that
// carries aria-label or title (measured on the real script, 21 Nov 2026), so such
// a container keeps its name through aria-labelledby pointing at this span.
// Ids come from useId() in the owning component.
export default function PortalHiddenLabel({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="sr-only">{children}</span>
}
