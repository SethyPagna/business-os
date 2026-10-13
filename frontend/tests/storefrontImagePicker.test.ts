import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { pickFiles } from '../src/utils/filePicker.ts'
import { imageFile, installFakeFilePickerDom, wait } from './fakeFilePickerDom.ts'

// Review finding 8. The storefront's share-proof screenshot picker (CatalogPage.tsx pickMultipleImagesAsDataUrls) built
// its own input: never attached to the page (some in-app webviews only fire `change` on an attached input) and
// listening for `change` alone, so a cancelled picker left its promise pending for good and a camera photo that arrived
// after the window refocused was missed. It now goes through the shared picker. This runs the REAL function from the
// component source, pulled out by the TypeScript parser, against the real picker and a fake input.

const { inputs, tapPage, focusWindow, heldListeners } = installFakeFilePickerDom()
const settled = async <T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> => Promise.race([promise, wait(ms).then(() => 'pending' as const)])

const path = 'catalog/CatalogPage.tsx'
const source = readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')
const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let found = ''
const visit = (node: ts.Node): void => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'pickMultipleImagesAsDataUrls') found = node.getText(parsed)
  ts.forEachChild(node, visit)
}
visit(parsed)
assert.ok(found, 'pickMultipleImagesAsDataUrls is defined in CatalogPage.tsx')

const CATALOG_SUBMISSION_MAX_SCREENSHOTS = 8
const reads: string[][] = []
// The real reader turns each File into a data URL; the fake does the same naming, without a FileReader.
const readImageFilesAsDataUrls = async (files: File[]): Promise<string[]> => {
  reads.push(files.map((file) => file.name))
  return files.map((file) => `data:${file.name}`)
}
const compiled = ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const pickMultipleImagesAsDataUrls = new Function('pickFiles', 'readImageFilesAsDataUrls', 'CATALOG_SUBMISSION_MAX_SCREENSHOTS', `${compiled}; return pickMultipleImagesAsDataUrls`)(
  pickFiles, readImageFilesAsDataUrls, CATALOG_SUBMISSION_MAX_SCREENSHOTS,
) as (onLateImages?: (images: Promise<string[]>) => void) => Promise<string[]>

{
  const start = inputs.length
  const pending = pickMultipleImagesAsDataUrls()
  const input = inputs[start]
  assert.equal(input.multiple, true, 'several screenshots can be chosen')
  assert.equal(input.accept, 'image/*')
  assert.equal(input.clicked, 1, 'the picker opens synchronously inside the tap')
  assert.equal(input.attached, true, 'the input is in the page while the picker is open')
  input.files = [imageFile('a.png'), imageFile('b.png')]
  input.fire('change')
  assert.deepEqual(await settled(pending, 200), ['data:a.png', 'data:b.png'], 'chosen screenshots come back as data URLs')
  assert.equal(input.attached, false, 'and the input is released')
}

{
  const start = inputs.length
  const pending = pickMultipleImagesAsDataUrls()
  inputs[start].fire('cancel')
  assert.deepEqual(await settled(pending, 100), [], 'cancelling settles with no screenshots instead of waiting forever')
  assert.equal(inputs[start].attached, false)
}

{
  // No cancel and no focus (iOS before 16.4): the next tap on the page settles it, and a screenshot that still arrives is handed over.
  const late: Array<Promise<string[]>> = []
  const start = inputs.length
  const pending = pickMultipleImagesAsDataUrls((images) => late.push(images))
  assert.equal(await settled(pending, 100), 'pending', 'with nothing reported the picker is still waiting')
  tapPage()
  assert.deepEqual(await settled(pending, 50), [], 'a tap on the page settles it with no screenshots')
  assert.equal(heldListeners(), 0)
  inputs[start].files = [imageFile('late.png')]
  inputs[start].fire('change')
  assert.equal(late.length, 1, 'a screenshot that arrives afterwards is handed to the caller, not dropped')
  assert.deepEqual(await late[0], ['data:late.png'])
}

{
  // The camera case: focus first, the photo a moment later.
  const late: Array<Promise<string[]>> = []
  const start = inputs.length
  const pending = pickMultipleImagesAsDataUrls((images) => late.push(images))
  focusWindow()
  assert.deepEqual(await settled(pending, 700), [], 'the focus fallback settles with no screenshots')
  inputs[start].files = [imageFile('camera.png')]
  inputs[start].fire('change')
  assert.deepEqual(await late[0], ['data:camera.png'], 'and the camera photo that follows is still delivered')
  inputs[start].fire('change')
  assert.equal(late.length, 1, 'once')
}

{
  // Without a late handler a settled picker simply lets go.
  const start = inputs.length
  const pending = pickMultipleImagesAsDataUrls()
  tapPage()
  assert.deepEqual(await settled(pending, 50), [])
  assert.equal(inputs[start].attached, false)
  assert.equal(heldListeners(), 0)
}

// The caller wires the late hand-over to the same draft the chosen screenshots go to, and reports a failed read.
const caller = /const handleUploadSubmissionImages = async \(\) => \{[\s\S]*?pickMultipleImagesAsDataUrls\(\(late\) => \{[\s\S]*?late\.then\(addSubmissionImages\)[\s\S]*?\.catch\([\s\S]*?notify\([\s\S]*?\}\)[\s\S]*?await addSubmissionImages\(images\)/
assert.match(source, caller, 'a late screenshot reaches the draft and a failed read is reported')
assert.doesNotMatch(source, /input\.onchange = \(\) => resolve\(Array\.from\(input\.files/, 'no hand-rolled change-only picker is left in the storefront')

console.log('PASS the storefront screenshot picker uses the shared picker: cancel and a bare tap settle it, and a late screenshot is delivered')
