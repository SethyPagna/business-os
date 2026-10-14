import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beginKeyedAction, finishKeyedAction } from '../src/utils/actionGuards.ts'
import { buildCacheBustedMediaPath } from '../src/utils/mediaUpload.ts'
import { pickFiles } from '../src/utils/filePicker.ts'
import { imageFile, installFakeFilePickerDom, wait } from './fakeFilePickerDom.ts'

// Daily-use A item 3. Settings and the Website Editor claim a per-key upload
// lock BEFORE opening the file picker and only released it in the `finally`
// after a chosen file. A picker that was cancelled never settled, so the key
// stayed locked and the next tap on Upload did nothing. These run the real
// uploadImageSetting (Settings.tsx) and uploadPortalMedia (CatalogPage.tsx)
// source, pulled out of the components by the TypeScript parser, against the
// real picker and a fake input.

const { inputs, focusWindow, tapPage, heldListeners } = installFakeFilePickerDom()

function extract(path: string, name: string): string {
  const source = readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = ''
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = `const ${name} = ${node.initializer.getText(file)}`
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found, `${name} is defined in ${path}`)
  return found.replace(/import\('\.\.\/\.\.\/utils\/mediaUpload\.ts'\)/g, '__importMedia()')
}
const compile = (code: string): string => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const settled = async (promise: Promise<unknown>, ms = 100): Promise<boolean> => Promise.race([promise.then(() => true), wait(ms).then(() => false)])

interface Probe {
  lock: { current: Set<string> }
  uploads: File[]
  applied: string[]
  open: () => Promise<unknown>
  holdUploads: () => () => void
}

function probeOf(kind: 'settings' | 'catalog'): Probe {
  const lock = { current: new Set<string>() }
  const uploads: File[] = []
  const applied: string[] = []
  let gate: Promise<void> = Promise.resolve()
  const upload = async ({ file }: { file: File }, folder: string) => { uploads.push(file); await gate; return { public_path: `${folder}${file.name}`, cache_version: 'v9' } }
  const shared = {
    beginKeyedAction, finishKeyedAction, pickFiles, aliveRef: { current: true }, user: { id: 1, name: 'Fixture' }, notify() {},
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} }, AbortController,
    withLoaderTimeout: async (task: () => Promise<unknown>) => task(),
  }
  const holdUploads = (): (() => void) => {
    let release!: () => void
    gate = new Promise<void>((resolve) => { release = resolve })
    return release
  }
  if (kind === 'settings') {
    const scope: Record<string, unknown> = {
      ...shared, uploadInFlightKeysRef: lock, lateUploadFilesRef: { current: new Map() },
      uploadOriginalValuesRef: { current: new Map() }, uploadPreviewUrlsRef: { current: new Map() }, uploadControllersRef: { current: new Map() },
      form: {}, settings: {}, getErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
      SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS: 30_000, updateUploadState() {},
      setValue: (_key: string, value: string) => { applied.push(value) },
      getSettingsApi: () => ({ uploadFileAsset: (args: { file: File }) => upload(args, '/uploads/settings/') }),
      __importMedia: async () => ({ buildCacheBustedMediaPath }),
    }
    const fn = new Function(...Object.keys(scope), `${compile(extract('utils-settings/Settings.tsx', 'uploadImageSetting'))}; return uploadImageSetting`)(...Object.values(scope)) as (key: string) => Promise<unknown>
    return { lock, uploads, applied, open: () => fn('ui_app_logo'), holdUploads }
  }
  const scope: Record<string, unknown> = {
    ...shared, mediaUploadInFlightTargetsRef: lock, lateMediaFilesRef: { current: new Map() },
    mediaUploadOriginalValuesRef: { current: new Map() }, mediaUploadPreviewUrlsRef: { current: new Map() }, mediaUploadControllersRef: { current: new Map() },
    getPortalMediaValue: () => '', clearPortalUploadPreview() {}, getCatalogErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
    CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS: 30_000, updateMediaUploadState() {}, buildCacheBustedMediaPath,
    setPortalMediaValue: (_key: string, value: string) => { applied.push(value) },
    getCatalogApi: () => ({ uploadFileAsset: (args: { file: File }) => upload(args, '/uploads/portal/') }),
  }
  const fn = new Function(...Object.keys(scope), `${compile(extract('catalog/CatalogPage.tsx', 'uploadPortalMedia'))}; return uploadPortalMedia`)(...Object.values(scope)) as (target: string, accept: string) => Promise<unknown>
  return { lock, uploads, applied, open: () => fn('hero', 'image/*'), holdUploads }
}

for (const [name, kind] of [['Settings uploadImageSetting', 'settings'], ['Website Editor uploadPortalMedia', 'catalog']] as const) {
  const probe = probeOf(kind)

  const start = inputs.length
  const first = probe.open()
  assert.equal(probe.lock.current.size, 1, `${name}: the key is held while the picker is open`)
  inputs[start].fire('cancel')
  assert.equal(await settled(first), true, `${name}: cancelling the picker settles the upload`)
  assert.equal(probe.lock.current.size, 0, `${name}: and releases the key`)
  const second = probe.open()
  assert.equal(inputs.length, start + 2, `${name}: Upload opens a fresh picker after a cancel`)
  inputs[start + 1].fire('cancel')
  await second

  const third = probe.open()
  focusWindow()
  assert.equal(await settled(third, 700), true, `${name}: the focus fallback settles the upload`)
  assert.equal(probe.lock.current.size, 0, `${name}: and releases the key`)
  const abandoned = inputs.at(-1)!
  assert.equal(probe.uploads.length, 0)

  abandoned.files = [imageFile('camera.png')]
  abandoned.fire('change')
  await wait(50)
  assert.deepEqual(probe.uploads.map((file) => file.name), ['camera.png'], `${name}: a photo that arrives after the fallback is uploaded, not dropped`)
  assert.ok(probe.applied.some((value) => value.includes('camera.png')), `${name}: its stored path is applied`)
  assert.equal(probe.lock.current.size, 0, `${name}: the key is free again`)
  probe.uploads.length = 0
  probe.applied.length = 0

  // No cancel and no focus: the first tap on the page settles the picker and frees the key; a photo that still arrives uploads.
  const stuck = probe.open()
  assert.equal(probe.lock.current.size, 1, `${name}: the key is held while a picker that reports nothing is open`)
  assert.equal(await settled(stuck, 150), false, `${name}: and nothing releases it by itself`)
  tapPage()
  assert.equal(await settled(stuck, 100), true, `${name}: a tap on the page settles the upload`)
  assert.equal(probe.lock.current.size, 0, `${name}: and releases the key`)
  assert.equal(heldListeners(), 0, `${name}: no page listener is left behind`)
  const reopened = probe.open()
  assert.equal(inputs.at(-1) !== undefined && probe.lock.current.size === 1, true, `${name}: Upload opens a fresh picker after the tap`)
  const stale = inputs.at(-2)!
  inputs.at(-1)!.fire('cancel')
  await reopened
  stale.files = [imageFile('after-tap.png')]
  stale.fire('change')
  await wait(50)
  assert.deepEqual(probe.uploads.map((file) => file.name), ['after-tap.png'], `${name}: a photo that arrives after the tap is uploaded`)
  probe.uploads.length = 0
  probe.applied.length = 0

  const release = probe.holdUploads()
  const fourth = probe.open()
  focusWindow()
  assert.equal(await settled(fourth, 700), true)
  const waiting = inputs.at(-1)!
  const fifth = probe.open()
  const current = inputs.at(-1)!
  current.files = [imageFile('first.png')]
  current.fire('change')
  await wait(50)
  assert.deepEqual(probe.uploads.map((file) => file.name), ['first.png'], `${name}: the running upload holds the key`)
  waiting.files = [imageFile('late.png')]
  waiting.fire('change')
  await wait(50)
  assert.deepEqual(probe.uploads.map((file) => file.name), ['first.png'], `${name}: a late photo for a busy key waits instead of racing it`)
  release()
  await fifth
  await wait(50)
  assert.deepEqual(probe.uploads.map((file) => file.name), ['first.png', 'late.png'], `${name}: and uploads when the key is free`)
  assert.equal(probe.lock.current.size, 0)
  console.log(`PASS ${name}: cancel and focus release the key, a late photo is uploaded`)
}
