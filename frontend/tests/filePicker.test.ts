import assert from 'node:assert/strict'
import { pickFiles } from '../src/utils/filePicker.ts'
import { imageFile, installFakeFilePickerDom, wait } from './fakeFilePickerDom.ts'

// Daily-use A item 3. The picker must settle on whichever comes first -- the
// input's `cancel` event, a `change`, or the window regaining focus -- and a
// `change` that lands AFTER the focus fallback (Android returns a camera photo
// this way) must still reach the caller instead of being dropped.

const { inputs, windowListeners, focusWindow } = installFakeFilePickerDom()
const file = imageFile
const settledWithin = async (promise: Promise<File[]>, ms: number): Promise<File[] | 'pending'> => Promise.race([promise, wait(ms).then(() => 'pending' as const)])

{
  const pending = pickFiles({ accept: 'image/*', capture: 'environment', maxCount: 3 })
  const input = inputs.at(-1)!
  assert.equal(input.type, 'file')
  assert.equal(input.accept, 'image/*')
  assert.equal(input.multiple, true, 'maxCount above 1 allows several files')
  assert.equal(input.attributes.get('capture'), 'environment')
  assert.equal(input.clicked, 1, 'the picker opens synchronously inside the gesture')
  assert.equal(input.style.pointerEvents, 'none', 'the input is invisible')
  input.files = [file('a.png'), file('b.png'), file('c.png'), file('d.png')]
  input.fire('change')
  const picked = await pending
  assert.deepEqual(picked.map((entry) => entry.name), ['a.png', 'b.png', 'c.png'], 'change resolves the files, capped at maxCount')
  assert.equal(input.attached, false, 'the input is removed')
  assert.equal(input.listenerCount(), 0)
  assert.equal(windowListeners.size, 0, 'the focus listener is removed')
}

{
  const pending = pickFiles()
  const input = inputs.at(-1)!
  assert.equal(input.multiple, false)
  input.fire('cancel')
  assert.deepEqual(await settledWithin(pending, 100), [], 'cancel settles at once, without waiting for the focus fallback')
  assert.equal(input.attached, false)
  assert.equal(windowListeners.size, 0)
}

{
  const late: File[][] = []
  const pending = pickFiles({ onLateChange: (files) => late.push(files) })
  const input = inputs.at(-1)!
  focusWindow()
  assert.equal(await settledWithin(pending, 50), 'pending', 'the focus fallback waits before deciding nothing was chosen')
  assert.deepEqual(await settledWithin(pending, 600), [], 'focus without a choice settles as cancelled')
  assert.equal(input.attached, true, 'the input stays so a late change can still arrive')
  assert.equal(windowListeners.size, 0, 'further window focus is ignored')
  input.files = [file('camera.jpg')]
  input.fire('change')
  assert.deepEqual(late.map((files) => files.map((entry) => entry.name)), [['camera.jpg']], 'a change after the fallback is delivered, not dropped')
  assert.equal(input.attached, false)
  assert.equal(input.listenerCount(), 0)
  input.fire('change')
  assert.equal(late.length, 1, 'a second change is not delivered twice')
}

{
  const late: File[][] = []
  const pending = pickFiles({ onLateChange: (files) => late.push(files) })
  const input = inputs.at(-1)!
  focusWindow()
  await pending
  input.fire('cancel')
  assert.equal(input.attached, false, 'a cancel after the fallback releases the input')
  input.files = [file('ignored.jpg')]
  input.fire('change')
  assert.equal(late.length, 0, 'nothing is delivered once the input was released')
}

{
  const late: File[][] = []
  const pending = pickFiles({ onLateChange: (files) => late.push(files) })
  const input = inputs.at(-1)!
  focusWindow()
  await wait(50)
  input.files = []
  input.fire('change')
  assert.deepEqual(await settledWithin(pending, 100), [], 'a change before the fallback that chose nothing settles as cancelled')
  assert.equal(late.length, 0)
}

{
  const pending = pickFiles({ maxCount: 2 })
  const input = inputs.at(-1)!
  input.files = [file('picked.png')]
  focusWindow()
  assert.deepEqual((await pending).map((entry) => entry.name), ['picked.png'], 'files already on the input when focus returns are used')
  assert.equal(input.attached, false, 'nothing late to wait for, so the input is released')
}

{
  const pending = pickFiles()
  const input = inputs.at(-1)!
  focusWindow()
  assert.deepEqual(await pending, [])
  assert.equal(input.attached, false, 'a caller with no late handler releases the input straight after the fallback')
  assert.equal(input.listenerCount(), 0)
}

{
  const pending = pickFiles()
  const input = inputs.at(-1)!
  focusWindow()
  focusWindow()
  focusWindow()
  assert.deepEqual(await settledWithin(pending, 700), [], 'repeated focus events settle once')
  assert.equal(input.attached, false)
}

console.log('PASS pickFiles settles on cancel, change or the focus fallback, and delivers a late change')
