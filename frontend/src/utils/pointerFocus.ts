// Script focus on a text field raises the on-screen keyboard on a phone or tablet,
// so only a mouse or trackpad primary pointer gets automatic focus.
export function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches)
}
