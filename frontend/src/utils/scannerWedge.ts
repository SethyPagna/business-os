// Pure burst detector for keyboard-wedge barcode guns.
//
// A gun types the code like a keyboard, far faster than a person (a few ms per
// key) and ends it with Enter or Tab. Two things make `event.key` useless for
// reading it: the Windows Khmer layout turns the number row into Khmer digits
// (3 -> ៣), and any other layout may remap letters. The PHYSICAL key
// (`event.code`) is the same on every layout, so the code is rebuilt from it.
//
// No DOM here: shared/useScannerWedge.ts feeds it keydown fields and acts on
// the result, so this file can be tested with plain numbers.

// Humans do not put two keys under 35 ms apart; guns put them 1-10 ms apart.
export const WEDGE_MAX_GAP_MS = 35
// Shorter runs are fast typing or key rollover, not a barcode.
export const WEDGE_MIN_LENGTH = 6
// Longer than any retail code: a longer run is not a barcode, and the buffer
// stops growing one character past it.
export const WEDGE_MAX_LENGTH = 64

const TERMINATOR_CODES = new Set(['Enter', 'NumpadEnter', 'Tab'])
// A gun sends Shift (or relies on CapsLock) around upper-case letters; that
// keydown sits between two characters and must not break the run.
const TRANSPARENT_CODES = new Set(['ShiftLeft', 'ShiftRight', 'CapsLock'])

export interface WedgeKeyInput {
  /** KeyboardEvent.code: the physical key, independent of the layout. */
  code: string
  /** KeyboardEvent.timeStamp in ms. */
  timeStamp: number
  shiftKey?: boolean
  capsLock?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  /** Auto-repeat of a held key: never a scanner. */
  repeat?: boolean
  /** IME composition (keyCode 229 included): the keys belong to the IME. */
  isComposing?: boolean
}

export type WedgeStep =
  /** Not part of a burst. */
  | { kind: 'ignored' }
  /** A character joined the run; `startsBurst` is true for the first one. */
  | { kind: 'char'; startsBurst: boolean }
  /** A terminator closed a qualifying run: `code` is the scanned text. */
  | { kind: 'burst'; code: string }

export interface WedgeDetector {
  push(key: WedgeKeyInput): WedgeStep
  reset(): void
}

/** Digit0-9 and Numpad0-9 to '0'-'9', KeyA-Z to a-z (A-Z when `upper`); '' for any other key. */
export function wedgeCharFromCode(code: string, upper = false): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  if (digit) return digit[1]
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return upper ? letter[1] : letter[1].toLowerCase()
  return ''
}

const IGNORED: WedgeStep = { kind: 'ignored' }

export function createWedgeDetector(): WedgeDetector {
  let buffer = ''
  let lastAt = 0
  const reset = () => { buffer = '' }
  return {
    reset,
    push(key) {
      if (key.isComposing || key.repeat || key.ctrlKey || key.altKey || key.metaKey) {
        reset()
        return IGNORED
      }
      if (TRANSPARENT_CODES.has(key.code)) return IGNORED
      const continuesRun = buffer !== '' && key.timeStamp - lastAt < WEDGE_MAX_GAP_MS
      if (TERMINATOR_CODES.has(key.code)) {
        const qualifies = continuesRun && buffer.length >= WEDGE_MIN_LENGTH && buffer.length <= WEDGE_MAX_LENGTH
        const code = qualifies ? buffer : ''
        reset()
        return code ? { kind: 'burst', code } : IGNORED
      }
      const char = wedgeCharFromCode(key.code, Boolean(key.shiftKey) !== Boolean(key.capsLock))
      if (!char) {
        reset()
        return IGNORED
      }
      lastAt = key.timeStamp
      if (continuesRun) {
        if (buffer.length <= WEDGE_MAX_LENGTH) buffer += char
        return { kind: 'char', startsBurst: false }
      }
      buffer = char
      return { kind: 'char', startsBurst: true }
    },
  }
}

// --- where the burst landed ---------------------------------------------
//
//   idle     nothing editable has focus (body, a button, a card): the code
//            belongs to the surface's search.
//   search   the surface's own search field: the code replaces its text.
//   restore  a field a person fills with a quantity, price, date or choice:
//            the burst changed it by accident, so put it back and send the
//            code to search instead.
//   text     any other text field or free-text box: the person is typing
//            there on purpose, so leave the burst alone.
export type WedgeFocus = 'idle' | 'search' | 'restore' | 'text'

export interface WedgeFocusLike {
  tagName?: string
  type?: string
  inputMode?: string
  isContentEditable?: boolean
}

const RESTORE_INPUT_TYPES = new Set(['number', 'date', 'time', 'datetime-local', 'month', 'week', 'range'])
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', ''])

export function classifyWedgeFocus(element: WedgeFocusLike | null | undefined, isSearchField: boolean): WedgeFocus {
  if (!element) return 'idle'
  if (isSearchField) return 'search'
  const tag = String(element.tagName || '').toUpperCase()
  if (tag === 'SELECT') return 'restore'
  if (tag === 'TEXTAREA' || element.isContentEditable) return 'text'
  if (tag !== 'INPUT') return 'idle'
  const type = String(element.type || '').toLowerCase()
  if (RESTORE_INPUT_TYPES.has(type)) return 'restore'
  if (!TEXT_INPUT_TYPES.has(type)) return 'idle'
  const mode = String(element.inputMode || '').toLowerCase()
  return mode === 'numeric' || mode === 'decimal' ? 'restore' : 'text'
}
