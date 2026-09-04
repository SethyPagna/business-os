import { createContext, useContext } from 'react'

// S4-21: a modal's ✕ is not its only close affordance -- almost every form
// modal also has a Cancel button inside its own content, and that button
// calls the `onClose` prop it was handed, which walks straight past the
// chrome's guard. This context is how content reaches the SAME guarded
// close the ✕ uses: `const requestClose = useModalClose(onClose)`.
//
// The fallback is the raw close, so a component rendered outside any Modal
// (a hand-rolled overlay, a test) still closes rather than doing nothing.

export const ModalCloseContext = createContext<(() => void) | null>(null)

/**
 * The guarded close for the surrounding Modal, or `fallback` when there
 * isn't one. Pass the component's own `onClose` as the fallback.
 */
export function useModalClose(fallback: () => void): () => void {
  return useContext(ModalCloseContext) ?? fallback
}
