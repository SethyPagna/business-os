export type PhoneInputEdit = {
  value: string
  selectionStart: number
  selectionEnd: number
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

/** Formats a controlled phone input and restores its caret after React renders. */
export function formatPhoneInputElement(input: HTMLInputElement): string {
  const edit = formatPhoneInputEdit(input.value, input.selectionStart, input.selectionEnd)
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      try {
        if (typeof document === 'undefined' || document.activeElement === input) {
          input.setSelectionRange(edit.selectionStart, edit.selectionEnd)
        }
      } catch (_) {}
    })
  }
  return edit.value
}
