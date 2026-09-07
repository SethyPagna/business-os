import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatPhoneInputEdit, formatPhoneInputValue, handlePhoneInputBeforeInput, handlePhoneInputKeyDown } from '../src/utils/phoneInput.ts'

assert.equal(formatPhoneInputValue(''), '')
assert.equal(formatPhoneInputValue('0'), '0')
assert.equal(formatPhoneInputValue('0123'), '012 3')
assert.equal(formatPhoneInputValue('0123456'), '012 345 6')
assert.equal(formatPhoneInputValue('012345678'), '012 345 678')
assert.equal(formatPhoneInputValue('0962345678'), '096 234 5678')

assert.equal(formatPhoneInputValue('012-345 (678)'), '012 345 678', 'paste removes visual separators without changing digits')
assert.equal(formatPhoneInputValue('(+855) 12 345 678'), '+855 12 345 678', 'Cambodian country prefix remains explicit')
assert.equal(formatPhoneInputValue('+855 96 234 5678'), '+855 96 234 5678')
assert.equal(formatPhoneInputValue('+123456789012345'), '+123 456 789 012 345', 'valid international length is not truncated')

assert.deepEqual(
  formatPhoneInputEdit('012345', 3, 3),
  { value: '012 345', selectionStart: 3, selectionEnd: 3 },
  'backspace at an inserted separator keeps the caret before that separator',
)

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  callback(0)
  return 1
}) as typeof requestAnimationFrame

function deletionEvent(
  value: string,
  caret: number,
  key: 'Backspace' | 'Delete',
  composing = false,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
) {
  let prevented = false
  let selection: [number, number] = [caret, caret]
  const input = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    setSelectionRange(start: number, end: number) {
      selection = [start, end]
    },
  } as HTMLInputElement
  const event = {
    key,
    currentTarget: input,
    preventDefault() { prevented = true },
    nativeEvent: { isComposing: composing, keyCode: composing ? 229 : 0 },
    ...modifiers,
  }
  let nextValue = value
  const handled = handlePhoneInputKeyDown(event, (next) => {
    nextValue = next
    input.value = next
  })
  return { handled, prevented, nextValue, selection }
}

function beforeInputEvent(value: string, caret: number, inputType: string, composing = false) {
  let prevented = false
  let selection: [number, number] = [caret, caret]
  const input = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    setSelectionRange(start: number, end: number) {
      selection = [start, end]
    },
  } as HTMLInputElement
  const event = {
    currentTarget: input,
    preventDefault() { prevented = true },
    nativeEvent: { inputType, isComposing: composing },
  }
  let nextValue = value
  const handled = handlePhoneInputBeforeInput(event, (next) => {
    nextValue = next
    input.value = next
  })
  return { handled, prevented, nextValue, selection }
}

assert.deepEqual(
  deletionEvent('012 345', 4, 'Backspace'),
  { handled: true, prevented: true, nextValue: '013 45', selection: [2, 2] },
  'Backspace after an inserted space removes the preceding digit in one press',
)
assert.deepEqual(
  deletionEvent('012 345', 3, 'Delete'),
  { handled: true, prevented: true, nextValue: '012 45', selection: [3, 3] },
  'Delete before an inserted space removes the following digit instead of recreating the space',
)
assert.deepEqual(
  deletionEvent('012 345', 5, 'Backspace'),
  { handled: false, prevented: false, nextValue: '012 345', selection: [5, 5] },
  'ordinary digit deletion stays native',
)
assert.deepEqual(
  deletionEvent('012 345', 4, 'Backspace', true),
  { handled: false, prevented: false, nextValue: '012 345', selection: [4, 4] },
  'IME composition is never intercepted',
)
assert.deepEqual(
  deletionEvent('012 345', 4, 'Backspace', false, { ctrlKey: true }),
  { handled: false, prevented: false, nextValue: '012 345', selection: [4, 4] },
  'modified Backspace remains a native word deletion',
)
assert.deepEqual(
  deletionEvent('012 345', 3, 'Delete', false, { metaKey: true }),
  { handled: false, prevented: false, nextValue: '012 345', selection: [3, 3] },
  'modified Delete remains native',
)
assert.deepEqual(
  beforeInputEvent('012 345', 4, 'deleteContentBackward'),
  { handled: true, prevented: true, nextValue: '013 45', selection: [2, 2] },
  'a virtual-keyboard backward deletion removes the intended digit in one event',
)
assert.deepEqual(
  beforeInputEvent('012 345', 3, 'deleteContentForward'),
  { handled: true, prevented: true, nextValue: '012 45', selection: [3, 3] },
  'a virtual-keyboard forward deletion removes the intended digit in one event',
)
assert.deepEqual(
  beforeInputEvent('012 345', 4, 'deleteContentBackward', true),
  { handled: false, prevented: false, nextValue: '012 345', selection: [4, 4] },
  'composing beforeinput deletion remains native',
)

{
  const input = {
    value: '012 345',
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange() {},
  } as unknown as HTMLInputElement
  let writes = 0
  let beforeInputPrevented = false
  const onValue = (nextValue: string) => {
    writes += 1
    input.value = nextValue
  }
  assert.equal(handlePhoneInputKeyDown({
    key: 'Backspace',
    currentTarget: input,
    preventDefault() {},
    nativeEvent: { isComposing: false, keyCode: 0 },
  }, onValue), true)
  assert.equal(handlePhoneInputBeforeInput({
    currentTarget: input,
    preventDefault() { beforeInputPrevented = true },
    nativeEvent: { inputType: 'deleteContentBackward', isComposing: false },
  }, onValue), true)
  assert.equal(writes, 1, 'a browser that emits keydown and beforeinput must delete only once')
  assert.equal(beforeInputPrevented, true, 'the duplicate beforeinput mutation is cancelled')
}

{
  const input = {
    value: '012 345',
    selectionStart: 4,
    selectionEnd: 4,
    setSelectionRange() {},
  } as unknown as HTMLInputElement
  let writes = 0
  let keyPrevented = false
  let beforeInputPrevented = false
  const onValue = () => { writes += 1 }
  assert.equal(handlePhoneInputKeyDown({
    key: 'Backspace',
    currentTarget: input,
    preventDefault() { keyPrevented = true },
    nativeEvent: { isComposing: true, keyCode: 229 },
  }, onValue), false)
  assert.equal(handlePhoneInputBeforeInput({
    currentTarget: input,
    preventDefault() { beforeInputPrevented = true },
    nativeEvent: { inputType: 'deleteContentBackward', isComposing: false },
  }, onValue), false)
  assert.equal(writes, 0, 'a composing keydown followed by a non-composing beforeinput must not mutate the value')
  assert.equal(keyPrevented, false, 'the composing keydown remains native')
  assert.equal(beforeInputPrevented, false, 'the related beforeinput remains native')
}

globalThis.requestAnimationFrame = originalRequestAnimationFrame
assert.deepEqual(
  formatPhoneInputEdit('012 3945 678', 6, 6),
  { value: '012 394 5678', selectionStart: 6, selectionEnd: 6 },
  'middle insertion keeps the caret after the same digit',
)
assert.deepEqual(
  formatPhoneInputEdit('012 39 678', 4, 6),
  { value: '012 396 78', selectionStart: 3, selectionEnd: 6 },
  'selection editing remains anchored by digit position',
)

const contactSources = [
  '../src/components/contacts/CustomerFormModal.tsx',
  '../src/components/contacts/SuppliersTab.tsx',
  '../src/components/contacts/DeliveryTab.tsx',
  '../src/components/pos/POSQuickAddModals.tsx',
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8'))

for (const source of contactSources) {
  assert.match(source, /formatPhoneInputElement\(e(?:vent)?\.currentTarget\)/, 'every owned form family wires its phone edits through the formatter')
}

const combinedSource = contactSources.join('\n')
assert.equal((combinedSource.match(/autoComplete="tel"/g) || []).length, 7, 'all seven owned primary, option, and POS quick-add phone inputs remain telephone inputs')
assert.equal((combinedSource.match(/formatPhoneInputElement\(/g) || []).length, 7, 'all seven owned phone inputs format progressively')
assert.equal((combinedSource.match(/handlePhoneInputKeyDown\(event/g) || []).length, 7, 'all seven owned phone inputs handle deletion across inserted spaces')
assert.equal((combinedSource.match(/handlePhoneInputBeforeInput\(event/g) || []).length, 7, 'all seven owned phone inputs support beforeinput-only virtual keyboards')

console.log('phone input tests passed')
