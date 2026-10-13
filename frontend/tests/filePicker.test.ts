import assert from 'node:assert/strict'
import { pickFiles } from '../src/utils/filePicker.ts'
import { imageFile, installFakeFilePickerDom, wait } from './fakeFilePickerDom.ts'

// Daily-use A item 3. The picker must settle on whichever comes first -- the
// input's `cancel` event, a `change`, or the window regaining focus -- and a
// `change` that lands AFTER the focus fallback (Android returns a camera photo
// this way) must still reach the caller instead of being dropped.

const { inputs, windowListeners, heldListeners, focusWindow, showPage, hidePage, tapPage } = installFakeFilePickerDom()
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

// Review finding 7. iOS before 16.4 fires neither `cancel` nor a window `focus` when the picker is dismissed, so
// the picker has to notice another way. A tap on the page proves nothing is covering it; the page becoming visible
// again (a camera app, a restored page) is read like a focus. The caller's lock is released either way, and a photo
// that still arrives afterwards is delivered, not dropped.
{
  const late: File[][] = []
  const pending = pickFiles({ onLateChange: (files) => late.push(files) })
  const input = inputs.at(-1)!
  assert.equal(await settledWithin(pending, 100), 'pending', 'with no event at all the picker is still waiting')
  tapPage()
  assert.deepEqual(await settledWithin(pending, 50), [], 'the first tap on the page settles it at once, without the focus wait')
  assert.equal(heldListeners(), 0, 'the page listeners are released as soon as it settles')
  assert.equal(input.attached, true, 'the input stays so a late photo can still arrive')
  input.files = [file('after-tap.jpg')]
  input.fire('change')
  assert.deepEqual(late.map((files) => files.map((entry) => entry.name)), [['after-tap.jpg']], 'a photo that arrives after the tap is delivered')
  assert.equal(input.attached, false)
}

{
  const pending = pickFiles()
  const input = inputs.at(-1)!
  tapPage()
  tapPage()
  assert.deepEqual(await settledWithin(pending, 50), [], 'a caller with no late handler settles on the first tap')
  assert.equal(input.attached, false, 'and the input is released')
  assert.equal(input.listenerCount(), 0)
  assert.equal(heldListeners(), 0)
}

{
  const pending = pickFiles({ onLateChange: () => undefined })
  hidePage()
  assert.equal(await settledWithin(pending, 450), 'pending', 'the page going to the background is not a reason to settle')
  showPage()
  assert.equal(await settledWithin(pending, 50), 'pending', 'the page coming back waits out the same settle window as a focus')
  assert.deepEqual(await settledWithin(pending, 600), [], 'and then settles as cancelled')
  assert.equal(heldListeners(), 0, 'every fallback listener is released')
  inputs.at(-1)!.fire('cancel')
}

{
  const pending = pickFiles()
  const input = inputs.at(-1)!
  input.files = [file('from-camera.jpg')]
  showPage()
  assert.deepEqual((await pending).map((entry) => entry.name), ['from-camera.jpg'], 'files already on the input when the page returns are used')
  assert.equal(heldListeners(), 0)
}

{
  const pending = pickFiles({ maxCount: 3 })
  const input = inputs.at(-1)!
  input.files = [file('chosen.jpg')]
  input.fire('change')
  assert.deepEqual((await pending).map((entry) => entry.name), ['chosen.jpg'])
  assert.equal(heldListeners(), 0, 'a normal choice leaves no page listener behind either')
  tapPage()
}

console.log('PASS pickFiles settles on cancel, change or the focus fallback, and delivers a late change')
console.log('PASS pickFiles settles on a tap or the page returning when the browser reports neither cancel nor focus, and still delivers a late photo')
