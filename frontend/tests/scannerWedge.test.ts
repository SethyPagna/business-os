// The scanner-gun burst detector (utils/scannerWedge.ts), on plain numbers.
//
// Owner report: with the Windows Khmer layout active the number row types Khmer
// digits, so a gun scan matched no barcode; a scan with nothing focused was
// lost; one into a quantity box became the quantity. Every case below feeds the
// detector what the browser reports: the PHYSICAL key (`code`) and a time.
import assert from 'node:assert/strict'
import {
  WEDGE_MAX_GAP_MS,
  WEDGE_MAX_LENGTH,
  WEDGE_MIN_LENGTH,
  classifyWedgeFocus,
  createWedgeDetector,
  wedgeCharFromCode,
  type WedgeKeyInput,
  type WedgeStep,
} from '../src/utils/scannerWedge.ts'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// What a Khmer-layout keyboard reports for the number row: key = Khmer digit,
// code = the physical key.
const KHMER_DIGIT_KEY = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩']
const digitKey = (digit: string): { key: string; code: string } => ({ key: KHMER_DIGIT_KEY[Number(digit)], code: `Digit${digit}` })

// Feed `keys` `gapMs` apart starting at `start`; returns every step.
function feed(keys: Array<Partial<WedgeKeyInput> & { code: string }>, gapMs: number, start = 1000): WedgeStep[] {
  const detector = createWedgeDetector()
  return keys.map((key, index) => detector.push({ timeStamp: start + index * gapMs, ...key }))
}

const digits = (text: string): Array<{ code: string }> => [...text].map((digit) => ({ code: digitKey(digit).code }))
const lastStep = (steps: WedgeStep[]): WedgeStep => steps[steps.length - 1]
const ENTER = { code: 'Enter' }

runTest('a fast Khmer-layout burst ending in Enter is rebuilt from the physical keys', () => {
  const khmerEvents = [...'3348901729222'].map(digitKey)
  assert.equal(khmerEvents[0].key, '៣', 'the fixture really reports Khmer digits as `key`')
  const steps = feed([...khmerEvents, ENTER], 4)
  assert.deepEqual(lastStep(steps), { kind: 'burst', code: '3348901729222' })
})

runTest('only the last step of a burst is a burst; the first character starts it', () => {
  const steps = feed([...digits('3348901729222'), ENTER], 4)
  assert.deepEqual(steps[0], { kind: 'char', startsBurst: true })
  assert.deepEqual(steps[1], { kind: 'char', startsBurst: false })
  assert.equal(steps.filter((step) => step.kind === 'burst').length, 1)
})

runTest('human-speed typing never becomes a burst', () => {
  const steps = feed([...digits('3348901729222'), ENTER], 120)
  assert.ok(steps.every((step) => step.kind !== 'burst'), 'a 120 ms rhythm is typing')
  assert.ok(steps.slice(0, -1).every((step) => step.kind === 'char' && step.startsBurst), 'every slow key restarts the run')
})

runTest('four fast characters are not a barcode, six are', () => {
  assert.notEqual(lastStep(feed([...digits('3348'), ENTER], 4)).kind, 'burst')
  assert.notEqual(lastStep(feed([...digits('33489'), ENTER], 4)).kind, 'burst')
  assert.deepEqual(lastStep(feed([...digits('334890'), ENTER], 4)), { kind: 'burst', code: '334890' })
  assert.equal(WEDGE_MIN_LENGTH, 6)
})

runTest('Tab terminates a burst the same way Enter does, and so does NumpadEnter', () => {
  assert.deepEqual(lastStep(feed([...digits('3348901729222'), { code: 'Tab' }], 4)), { kind: 'burst', code: '3348901729222' })
  assert.deepEqual(lastStep(feed([...digits('3348901729222'), { code: 'NumpadEnter' }], 4)), { kind: 'burst', code: '3348901729222' })
})

runTest('a burst needs a terminator: without Enter or Tab nothing is reported', () => {
  assert.ok(feed(digits('3348901729222'), 4).every((step) => step.kind !== 'burst'))
})

runTest('the gap is strict: 34 ms keeps the run, 35 ms ends it', () => {
  assert.equal(WEDGE_MAX_GAP_MS, 35)
  assert.equal(lastStep(feed([...digits('334890'), ENTER], 34)).kind, 'burst')
  assert.notEqual(lastStep(feed([...digits('334890'), ENTER], 35)).kind, 'burst')
})

runTest('an Enter that arrives late after the last character is a person pressing Enter', () => {
  const detector = createWedgeDetector()
  digits('3348901729222').forEach((key, index) => detector.push({ ...key, timeStamp: 1000 + index * 4 }))
  assert.equal(detector.push({ ...ENTER, timeStamp: 1000 + 13 * 4 + 200 }).kind, 'ignored')
})

runTest('one slow key splits the run: only the part after it can qualify', () => {
  const detector = createWedgeDetector()
  const pressAt = (code: string, at: number): WedgeStep => detector.push({ code, timeStamp: at })
  ;['Digit3', 'Digit3', 'Digit4'].forEach((code, index) => pressAt(code, 1000 + index * 4))
  // 500 ms pause, then only five fast keys follow
  ;['Digit8', 'Digit9', 'Digit0', 'Digit1', 'Digit7'].forEach((code, index) => pressAt(code, 1500 + index * 4))
  assert.equal(pressAt('Enter', 1500 + 5 * 4).kind, 'ignored', '3 + 5 fast keys around a pause are no 6-key burst')
  ;['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].forEach((code, index) => pressAt(code, 3000 + index * 4))
  assert.deepEqual(pressAt('Enter', 3000 + 6 * 4), { kind: 'burst', code: '123456' })
})

runTest('numpad digits and letters map to ASCII; upper case needs Shift xor CapsLock', () => {
  assert.equal(wedgeCharFromCode('Numpad7'), '7')
  assert.equal(wedgeCharFromCode('Digit0'), '0')
  assert.equal(wedgeCharFromCode('KeyQ'), 'q')
  assert.equal(wedgeCharFromCode('KeyQ', true), 'Q')
  assert.equal(wedgeCharFromCode('Minus'), '')
  assert.equal(wedgeCharFromCode('Space'), '')
  assert.equal(wedgeCharFromCode('NumpadEnter'), '')
  const withShift = (code: string) => ({ code, shiftKey: true })
  const steps = feed([
    { code: 'ShiftLeft' }, withShift('KeyA'), withShift('KeyB'), { code: 'Digit1' }, { code: 'Digit2' }, { code: 'Numpad3' }, { code: 'Numpad4' }, ENTER,
  ], 3)
  assert.deepEqual(lastStep(steps), { kind: 'burst', code: 'AB1234' }, 'a Shift keydown between characters does not break the run')
  const capsLocked = feed([...['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'].map((code) => ({ code, capsLock: true })), ENTER], 3)
  assert.deepEqual(lastStep(capsLocked), { kind: 'burst', code: 'ABCDEF' })
  const shiftAndCaps = feed([...['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'].map((code) => ({ code, capsLock: true, shiftKey: true })), ENTER], 3)
  assert.deepEqual(lastStep(shiftAndCaps), { kind: 'burst', code: 'abcdef' })
})

runTest('IME composition, held keys and shortcuts reset the run', () => {
  for (const poison of [{ isComposing: true }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    const keys = [...digits('33489'), { code: 'Digit0', ...poison }, ...digits('17'), ENTER]
    assert.ok(feed(keys, 3).every((step) => step.kind !== 'burst'), `${JSON.stringify(poison)} must break the run`)
  }
})

runTest('a key that is not a barcode character resets the run', () => {
  const keys = [...digits('33489'), { code: 'Space' }, ...digits('0172'), ENTER]
  assert.ok(feed(keys, 3).every((step) => step.kind !== 'burst'))
  const arrow = [...digits('3348901'), { code: 'ArrowLeft' }, ENTER]
  assert.ok(feed(arrow, 3).every((step) => step.kind !== 'burst'))
})

runTest('a run longer than any retail code is not a barcode', () => {
  assert.deepEqual(lastStep(feed([...digits('1'.repeat(WEDGE_MAX_LENGTH)), ENTER], 2)), { kind: 'burst', code: '1'.repeat(WEDGE_MAX_LENGTH) })
  assert.equal(lastStep(feed([...digits('1'.repeat(WEDGE_MAX_LENGTH + 1)), ENTER], 2)).kind, 'ignored')
  assert.equal(lastStep(feed([...digits('1'.repeat(WEDGE_MAX_LENGTH * 3)), ENTER], 2)).kind, 'ignored')
})

runTest('two bursts in a row are both reported; a failed run leaves nothing behind', () => {
  const detector = createWedgeDetector()
  const scan = (text: string, start: number): WedgeStep => {
    digits(text).forEach((key, index) => detector.push({ ...key, timeStamp: start + index * 3 }))
    return detector.push({ ...ENTER, timeStamp: start + text.length * 3 })
  }
  assert.deepEqual(scan('3348901729222', 1000), { kind: 'burst', code: '3348901729222' })
  assert.deepEqual(scan('4006381333931', 2000), { kind: 'burst', code: '4006381333931' })
  scan('123', 3000)
  assert.deepEqual(scan('5901234123457', 4000), { kind: 'burst', code: '5901234123457' })
})

runTest('where a burst lands: idle, search, restore or leave alone', () => {
  assert.equal(classifyWedgeFocus(null, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'BODY' }, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'BUTTON' }, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'DIV' }, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'checkbox' }, false), 'idle')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'text' }, true), 'search', 'the surface search wins over text')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'number' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'date' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'text', inputMode: 'decimal' }, false), 'restore', 'a text-typed quantity box is still a quantity box')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'text', inputMode: 'numeric' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'SELECT' }, false), 'restore')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'text', inputMode: '' }, false), 'text')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'search' }, false), 'text')
  assert.equal(classifyWedgeFocus({ tagName: 'INPUT', type: 'tel' }, false), 'text')
  assert.equal(classifyWedgeFocus({ tagName: 'TEXTAREA' }, false), 'text')
  assert.equal(classifyWedgeFocus({ tagName: 'DIV', isContentEditable: true }, false), 'text')
})

if (failed > 0) process.exitCode = 1
