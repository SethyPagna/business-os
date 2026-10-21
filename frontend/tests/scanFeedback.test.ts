// What an accepted scan does for the person: the guide flashes green and the phone
// buzzes once, and that is all. Owner answer, 21 Oct 2026: vibration and a green
// flash, NO beep and NO sound setting (the spec's `scanner_sound` key is not added).
//
// Run: node tests/scanFeedback.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SCAN_CLOSE_DELAY_MS, SCAN_FLASH_CLASS, SCAN_VIBRATE_MS, signalScanSuccess } from '../src/components/products/scanning/scanFeedback.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string) => fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

function fakeElement() {
  const classes = new Set<string>()
  return { classes, classList: { add: (name: string) => { classes.add(name) } } }
}

function withNavigator<T>(navigatorValue: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorValue })
  try {
    return run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}

// Sound must be impossible, not merely unused: the globals a beep would need throw.
const soundTraps: string[] = []
for (const name of ['Audio', 'AudioContext', 'webkitAudioContext']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: class { constructor() { soundTraps.push(name); throw new Error(`${name} must never be touched`) } } })
}

await runTest('one success buzzes once for 40 ms and flashes the target; two successes buzz twice', () => {
  const calls: number[] = []
  const target = fakeElement()
  withNavigator({ vibrate: (ms: number) => { calls.push(ms); return true } }, () => {
    signalScanSuccess(target)
    assert.deepEqual(calls, [40], 'exactly one vibrate(40) for one success')
    assert.ok(target.classes.has(SCAN_FLASH_CLASS), 'the flash class is on the target')
    signalScanSuccess(fakeElement())
    assert.deepEqual(calls, [40, 40], 'the next success buzzes again, once')
  })
  assert.equal(SCAN_VIBRATE_MS, 40)
  assert.equal(SCAN_CLOSE_DELAY_MS, 150, 'the sheet stays up ~150 ms so the flash is seen')
})

await runTest('where vibration is unsupported or refused it is a safe no-op, and the flash still shows', () => {
  for (const [label, value] of [
    ['no vibrate (iOS Safari, most desktops)', {}],
    ['no navigator at all', undefined],
    ['vibrate throws', { vibrate: () => { throw new Error('blocked: no recent tap') } }],
  ] as const) {
    const target = fakeElement()
    withNavigator(value, () => assert.doesNotThrow(() => signalScanSuccess(target), label))
    assert.ok(target.classes.has(SCAN_FLASH_CLASS), `${label}: still flashes`)
  }
  assert.doesNotThrow(() => signalScanSuccess(null), 'no target is fine (the photo path before the view exists)')
  assert.doesNotThrow(() => signalScanSuccess({}), 'a target without classList is fine')
})

await runTest('no sound anywhere: no Audio or AudioContext was constructed, and no source file mentions one or a sound setting', () => {
  assert.deepEqual(soundTraps, [], 'signalScanSuccess never touched a sound API')
  for (const file of [
    'components/products/scanning/scanFeedback.ts',
    'components/products/scanning/BarcodeScannerModal.tsx',
    'components/products/scanning/useBarcodeCamera.ts',
    'components/products/scanning/cameraChoice.ts',
  ]) {
    assert.doesNotMatch(read(file), /\bAudio\b|AudioContext|webkitAudioContext|\.play\(\)\s*;?\s*\/\/\s*beep|scanner_sound/, `${file} must not make a sound`)
  }
  for (const pack of ['en', 'km']) {
    assert.equal(JSON.parse(read(`lang/${pack}.json`)).scanner_sound, undefined, `${pack}.json has no scanner_sound key`)
  }
})

await runTest('the flash class applied in code is the class the stylesheet draws, and the scan line rests under reduced motion', () => {
  const css = read('styles/main.css')
  assert.ok(css.includes(`.${SCAN_FLASH_CLASS} .scanner-guide`), 'the guide turns green under the flash class')
  assert.ok(css.includes(`.${SCAN_FLASH_CLASS}::after`), 'and the whole view flashes')
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.scanner-scan-line')))
  assert.match(reduced.slice(0, 200), /\.scanner-scan-line \{ animation: none; \}/, 'the scan line stops moving when the person asked for less motion')
  assert.match(reduced.slice(0, 200), /\.scanner-read-flash::after \{ animation: none; \}/, 'and the read flash holds still')
  assert.match(css, /@keyframes scannerSweep/)
  assert.match(css, /@keyframes scannerFlash/)
  assert.match(css, /\.scanner-video-shell \{\s*height: min\(62vh, 520px\);\s*height: min\(62dvh, 520px\);/, 'the view is min(62dvh, 520px), with the vh line first as a fallback')
})

if (failed > 0) process.exitCode = 1
