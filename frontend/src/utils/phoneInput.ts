export type PhoneInputEdit = {
  value: string
  selectionStart: number
  selectionEnd: number
}

type PhoneInputKeyEvent = {
  key: string
  currentTarget: HTMLInputElement
  preventDefault: () => void
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

type PhoneInputBeforeInputEvent = {
  currentTarget: HTMLInputElement
  preventDefault: () => void
  nativeEvent?: unknown
}

type PhoneDeleteDirection = 'backward' | 'forward'

const handledKeyDownInputs = new WeakSet<HTMLInputElement>()
const modifiedKeyDownInputs = new WeakSet<HTMLInputElement>()
const composingKeyDownInputs = new WeakSet<HTMLInputElement>()

function markForNextBeforeInput(group: WeakSet<HTMLInputElement>, input: HTMLInputElement): void {
  group.add(input)
  setTimeout(() => group.delete(input), 0)
}

function hasLeadingPlus(value: string): boolean {
  const plusIndex = value.indexOf('+')
  if (plusIndex < 0) return false
  const firstDigitIndex = value.search(/\d/)
  return firstDigitIndex < 0 || plusIndex < firstDigitIndex
}

function groupEveryThree(digits: string): string {
  return digits.match(/.{1,3}/g)?.join(' ') || ''
}

function formatCambodianNational(digits: string): string {
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
  if (digits.length <= 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  return groupEveryThree(digits)
}

/**
 * Formats a phone for editing without changing its identity-bearing digits.
 * Cambodian local numbers follow the existing 0XX XXX XXX[X] display shape.
 * +855 numbers keep their country prefix and use the matching national shape;
 * other international numbers remain untruncated and are grouped progressively.
 */
export function formatPhoneInputValue(value: unknown): string {
  const raw = String(value ?? '')
  const digits = raw.replace(/\D/g, '')
  const leadingPlus = hasLeadingPlus(raw)

  if (!digits) return leadingPlus ? '+' : ''
  if (!leadingPlus) {
    return digits.startsWith('0') ? formatCambodianNational(digits) : groupEveryThree(digits)
  }

  if (digits.startsWith('855')) {
    const nationalDigits = digits.slice(3)
    if (!nationalDigits) return '+855'
    const localShape = formatCambodianNational(`0${nationalDigits}`)
    return `+855 ${localShape.slice(1)}`
  }

  return `+${groupEveryThree(digits)}`
}

function digitCountBefore(value: string, position: number): number {
  return (value.slice(0, Math.max(0, position)).match(/\d/g) || []).length
}

function positionAfterDigits(value: string, digitCount: number, includePlus: boolean): number {
  if (digitCount <= 0) return includePlus && value.startsWith('+') ? 1 : 0
  let seen = 0
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) seen += 1
    if (seen === digitCount) return index + 1
  }
  return value.length
}

/** Keeps a selection anchored to the same digits when formatting inserts spaces. */
export function formatPhoneInputEdit(
  value: string,
  selectionStart: number | null = value.length,
  selectionEnd: number | null = selectionStart,
): PhoneInputEdit {
  const nextValue = formatPhoneInputValue(value)
  const start = selectionStart ?? value.length
  const end = selectionEnd ?? start
  const plusIndex = value.indexOf('+')
  const startIncludesPlus = plusIndex >= 0 && plusIndex < start && hasLeadingPlus(value)
  const endIncludesPlus = plusIndex >= 0 && plusIndex < end && hasLeadingPlus(value)

  return {
    value: nextValue,
    selectionStart: positionAfterDigits(nextValue, digitCountBefore(value, start), startIncludesPlus),
    selectionEnd: positionAfterDigits(nextValue, digitCountBefore(value, end), endIncludesPlus),
  }
}

function restorePhoneInputSelection(input: HTMLInputElement, edit: PhoneInputEdit): void {
  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => {
    try {
      if (typeof document === 'undefined' || document.activeElement === input) {
        input.setSelectionRange(edit.selectionStart, edit.selectionEnd)
      }
    } catch (_) {}
  })
}

/** Formats a controlled phone input and restores its caret after React renders. */
export function formatPhoneInputElement(input: HTMLInputElement): string {
  const edit = formatPhoneInputEdit(input.value, input.selectionStart, input.selectionEnd)
  restorePhoneInputSelection(input, edit)
  return edit.value
}

function applyPhoneSeparatorDeletion(
  input: HTMLInputElement,
  direction: PhoneDeleteDirection,
  preventDefault: () => void,
  onValue: (value: string) => void,
): boolean {
  const start = input.selectionStart
  const end = input.selectionEnd
  if (start == null || end == null || start !== end) return false

  const separatorIndex = direction === 'backward' ? start - 1 : start
  if (separatorIndex < 0 || input.value[separatorIndex] !== ' ') return false

  let digitIndex = direction === 'backward' ? separatorIndex - 1 : separatorIndex + 1
  const step = direction === 'backward' ? -1 : 1
  while (digitIndex >= 0 && digitIndex < input.value.length && !/\d/.test(input.value[digitIndex])) {
    digitIndex += step
  }
  if (digitIndex < 0 || digitIndex >= input.value.length) return false

  const unformatted = `${input.value.slice(0, digitIndex)}${input.value.slice(digitIndex + 1)}`
  const rawCaret = direction === 'backward' ? digitIndex : start
  const edit = formatPhoneInputEdit(unformatted, rawCaret, rawCaret)
  preventDefault()
  onValue(edit.value)
  restorePhoneInputSelection(input, edit)
  return true
}

/**
 * Makes deletion across an auto-inserted separator take one key press.
 * Native editing remains in charge for selections, composition, and keys that
 * are not immediately beside a formatting space.
 */
export function handlePhoneInputKeyDown(event: PhoneInputKeyEvent, onValue: (value: string) => void): boolean {
  if (event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229) {
    markForNextBeforeInput(composingKeyDownInputs, event.currentTarget)
    return false
  }
  const direction = event.key === 'Backspace' ? 'backward' : event.key === 'Delete' ? 'forward' : null
  if (!direction) return false

  if (event.ctrlKey || event.metaKey || event.altKey) {
    markForNextBeforeInput(modifiedKeyDownInputs, event.currentTarget)
    return false
  }

  const handled = applyPhoneSeparatorDeletion(event.currentTarget, direction, () => event.preventDefault(), onValue)
  if (handled) markForNextBeforeInput(handledKeyDownInputs, event.currentTarget)
  return handled
}

/** Handles beforeinput-only deletion from virtual keyboards and assistive input. */
export function handlePhoneInputBeforeInput(event: PhoneInputBeforeInputEvent, onValue: (value: string) => void): boolean {
  const nativeEvent = event.nativeEvent as { inputType?: unknown; isComposing?: unknown } | undefined
  if (nativeEvent?.isComposing === true) return false
  const inputType = String(nativeEvent?.inputType || '')
  const direction = inputType === 'deleteContentBackward'
    ? 'backward'
    : inputType === 'deleteContentForward'
      ? 'forward'
      : null
  if (!direction) return false

  const input = event.currentTarget
  if (composingKeyDownInputs.has(input)) return false
  if (modifiedKeyDownInputs.has(input)) return false
  if (handledKeyDownInputs.has(input)) {
    event.preventDefault()
    return true
  }
  return applyPhoneSeparatorDeletion(input, direction, () => event.preventDefault(), onValue)
}
