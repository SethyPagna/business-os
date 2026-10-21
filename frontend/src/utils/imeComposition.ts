// An Enter that confirms an IME candidate (Khmer, Chinese, Japanese...) must not also act as Enter.
export function isImeComposingKey(event: { nativeEvent?: { isComposing?: boolean; keyCode?: number } }): boolean {
  return event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229
}
