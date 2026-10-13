import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, expireWaitsSince, propsOf, timerMark, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { classesOf, dimension, gapPx, gridColumns, horizontalPadding } from './tailwindPixels.ts'

// Daily-use A items 3-5, run against the real ProductForm. The photo picker
// has to give the form back when the person backs out (iOS and some Android
// pickers report nothing but a window focus), and a camera photo that arrives
// after that fallback -- Android returns it through a late `change` -- must
// still be uploaded, not dropped.

type Listener = (event?: unknown) => void
type Pending = { input: MemoryNode & { files?: File[] | null; onchange?: Listener; oncancel?: Listener } }

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const harness = await createHarness({ observe: ['api/methods.ts'] })

const pickers: Pending['input'][] = []
const realCreateElement = document.createElement.bind(document)
document.createElement = ((name: string) => {
  const node = realCreateElement(name) as unknown as Pending['input']
  if (name.toLowerCase() === 'input') pickers.push(node)
  return node
}) as typeof document.createElement
// What the picker watches the page for: the window regaining focus, a restored page, the first tap (pointer or touch)
// and the document becoming visible again. The test fires them by hand, the way a browser would, and nothing else.
const PICKER_WINDOW_EVENTS = new Set(['focus', 'pageshow', 'pointerdown', 'touchstart'])
const pageListeners = new Map<string, Set<Listener>>()
const listenersFor = (type: string): Set<Listener> => pageListeners.get(type) ?? pageListeners.set(type, new Set()).get(type)!
const realAddListener = window.addEventListener
const realRemoveListener = window.removeEventListener
const realDocumentAdd = document.addEventListener
const realDocumentRemove = document.removeEventListener
window.addEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (PICKER_WINDOW_EVENTS.has(type)) listenersFor(type).add(listener)
  else (realAddListener as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof window.addEventListener
window.removeEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (PICKER_WINDOW_EVENTS.has(type)) listenersFor(type).delete(listener)
  else (realRemoveListener as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof window.removeEventListener
document.addEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (type === 'visibilitychange') listenersFor(type).add(listener)
  else (realDocumentAdd as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof document.addEventListener
document.removeEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (type === 'visibilitychange') listenersFor(type).delete(listener)
  else (realDocumentRemove as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof document.removeEventListener

const listenersOf = (input: MemoryNode, type: string): Listener[] => [...((input as unknown as { listeners: Map<string, Set<Listener>> }).listeners.get(type) ?? [])]
async function fire(input: Pending['input'], type: 'change' | 'cancel'): Promise<void> {
  await act(async () => {
    for (const listener of listenersOf(input, type)) listener({ type })
    ;(type === 'change' ? input.onchange : input.oncancel)?.({ type })
  })
}
const emitPageEvent = async (...types: string[]): Promise<void> => { await act(async () => { for (const type of types) for (const listener of [...listenersFor(type)]) listener({ type }) }) }
const focusWindow = (): Promise<void> => emitPageEvent('focus')
// The first touch or click on the page: pointer events where there are any, touch events on the old iOS this is for.
const tapPage = (): Promise<void> => emitPageEvent('pointerdown', 'touchstart')
// The page visible again, as after a camera app or a restored page.
const showPage = (): Promise<void> => emitPageEvent('visibilitychange', 'pageshow')
const notices: string[] = []
const heldPageListeners = (): number => [...pageListeners.values()].reduce((sum, set) => sum + set.size, 0)
const photo = (name: string): File => new File(['pixels'], name, { type: 'image/jpeg' })

const objectUrls = { created: [] as string[], revoked: [] as string[] }
const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL
URL.createObjectURL = ((blob: Blob) => { const url = `blob:probe-${objectUrls.created.length + 1}-${(blob as File).name ?? 'blob'}`; objectUrls.created.push(url); return url }) as typeof URL.createObjectURL
URL.revokeObjectURL = ((url: string) => { objectUrls.revoked.push(url) }) as typeof URL.revokeObjectURL

const uploads: Array<{ file: File; fileName: string; productName?: string }> = []
let uploadImpl: (payload: { file: File }) => Promise<unknown> = async () => ({ public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' })
let createMatchRows: unknown[] = []
const doubles = {
  'api/methods.ts': { searchProducts: async () => ({ items: createMatchRows }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/productImageUploadTransport.ts': { uploadProductImage: async (payload: { file: File; fileName: string; productName?: string }) => { uploads.push(payload); return uploadImpl(payload) } },
}

async function mountForm(lang = 'en', overrides: Record<string, unknown> = {}): Promise<MountedSurface> {
  localStorage.clear()
  const words = packs[lang]
  const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
  const app = { user, page: 'products', t: (key: string) => words[key] || '', notify: (message: unknown) => { notices.push(String(message)) }, settings: {}, formatDateTime: String }
  return harness.mount({
    component: 'components/products/forms/ProductForm.tsx',
    props: {
      product: null, categories: [], units: [], branches: [], user, t: (key: string) => words[key] || '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
      onClose() {}, onSave: async () => undefined, ...overrides,
    },
    app, doubles,
  })
}
const pickerButton = (surface: MountedSurface, label: string): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && node.textContent === label, `the ${label} button`)
const saveButton = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && node.className.includes('btn-primary') && node.textContent.length > 0, 'the Save button')
const saveReview = (surface: MountedSurface, words: Record<string, string>): MemoryNode => surface.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(words.label_selling_price), 'the save review')
const galleryImages = (surface: MountedSurface): string[] => surface.findAll((node) => node.tagName === 'IMG').map((node) => node.getAttribute('src') || '')
const pathOf = (src: string): string => (src.startsWith('blob:') ? src : new URL(src, 'https://admin.example.test').pathname)

try {
  // Cancel through the input's own event releases the form.
  {
    const surface = await mountForm()
    const before = pickers.length
    await surface.click(pickerButton(surface, 'Take Photo'))
    const input = pickers[before]
    assert.ok(input, 'Take Photo opens a picker')
    assert.equal(input.getAttribute('capture'), 'environment', 'Take Photo asks for the rear camera')
    // Waiting on the picker is not an upload: nothing says "Uploading..." and Save, Cancel and Close stay usable.
    assert.ok(!surface.text().includes('Uploading...'), 'waiting on the picker is not shown as an upload')
    assert.notEqual(propsOf(saveButton(surface)).disabled, true, 'Save does not wait for the picker')
    await fire(input, 'cancel')
    await surface.settle()
    assert.ok(!surface.text().includes('Uploading...'), 'cancelling the picker leaves the form as it was')
    assert.notEqual(propsOf(saveButton(surface)).disabled, true, 'Save still works')
    await surface.click(pickerButton(surface, 'Take Photo'))
    assert.equal(pickers.length, before + 2, 'the next tap opens a fresh picker')
    await fire(pickers[before + 1], 'cancel')
    await surface.settle()
    await surface.unmount()
  }

  // A picker that only returns window focus releases the form after the fallback.
  {
    const surface = await mountForm()
    const before = pickers.length
    await surface.click(pickerButton(surface, 'Choose File'))
    await focusWindow()
    await surface.settle()
    assert.ok(!surface.text().includes('Uploading...'), 'window focus without a choice releases the form')
    assert.equal(uploads.length, 0)

    // The late change: Android hands the photo back after the fallback.
    const input = pickers[before]
    input.files = [photo('camera.jpg')]
    await fire(input, 'change')
    await surface.waitFor(() => uploads.length === 1, 'the late photo upload')
    await surface.settle()
    assert.equal(uploads.length, 1, 'a change after the fallback still uploads the photo')
    assert.equal(uploads[0].file.name, 'camera.jpg')
    assert.ok(galleryImages(surface).map(pathOf).includes('/uploads/products/probe-1.jpg'), 'and the stored photo lands in the gallery')
    await surface.unmount()
  }
  uploads.length = 0

  // A change that arrives while another upload runs is queued, not lost.
  {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    uploadImpl = async (payload) => {
      if (payload.file.name === 'first.jpg') await gate
      return { public_path: `/uploads/products/${payload.file.name}`, cache_version: 'v1' }
    }
    const surface = await mountForm()
    const before = pickers.length
    await surface.click(pickerButton(surface, 'Choose File'))
    await focusWindow()
    await surface.settle()
    const abandoned = pickers[before]
    await surface.click(pickerButton(surface, 'Choose File'))
    const second = pickers[before + 1]
    second.files = [photo('first.jpg')]
    await fire(second, 'change')
    await surface.settle({ until: () => uploads.length === 1 })
    abandoned.files = [photo('late.jpg')]
    await fire(abandoned, 'change')
    await surface.settle()
    assert.equal(uploads.length, 1, 'the late photo waits for the running upload')
    release()
    await surface.settle({ until: () => uploads.length === 2 })
    await surface.settle()
    assert.deepEqual(uploads.map((upload) => upload.file.name), ['first.jpg', 'late.jpg'], 'the late photo uploads once the first finishes')
    assert.deepEqual(galleryImages(surface).map(pathOf), ['/uploads/products/first.jpg', '/uploads/products/late.jpg'])
    await surface.unmount()
    uploadImpl = async () => ({ public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' })
    uploads.length = 0
  }

  // A picker that reports neither cancel nor focus must not lock the form; only an upload in flight does, and that is bounded.
  {
    const closed: number[] = []
    const surface = await mountForm('en', { onClose() { closed.push(1) }, onMinimize() {} })
    const close = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === packs.en.close, 'the header Close')
    const before = pickers.length
    // The app's own page listeners share this registry; the picker's are the ones added on top.
    const appListeners = heldPageListeners()
    await surface.click(pickerButton(surface, 'Take Photo'))
    const first = pickers[before]
    assert.ok(first, 'Take Photo opens a picker, and the browser reports nothing: no cancel, no focus')
    assert.ok(heldPageListeners() > appListeners, 'the picker is waiting on the page')
    for (const [name, control] of [['Close', close], ['Cancel', surface.button(packs.en.cancel)], ['Save', saveButton(surface)], ['Minimize', surface.button(packs.en.minimize)]] as const) {
      assert.notEqual(propsOf(control).disabled, true, `${name} is not locked by a picker that never reports`)
    }
    assert.ok(!surface.text().includes('Uploading...'), 'and the form does not claim an upload is running')
    await surface.click(pickerButton(surface, 'Take Photo'))
    assert.equal(pickers.length, before + 1, 'a second press with no tap in between does not open a second picker')
    // The next real press arrives as a tap first: that ends the wait, and the same press opens a fresh picker.
    await tapPage()
    assert.equal(heldPageListeners(), appListeners, 'the tap ended the wait and the picker let go of the page')
    await surface.click(pickerButton(surface, 'Take Photo'))
    assert.equal(pickers.length, before + 2, 'the press that follows a tap opens a fresh picker')
    // A photo the first picker still delivers is attached, not dropped.
    first.files = [photo('late-after-tap.jpg')]
    await fire(first, 'change')
    await surface.waitFor(() => uploads.length === 1, 'the late photo upload')
    await surface.settle()
    assert.equal(uploads[0].file.name, 'late-after-tap.jpg')
    assert.ok(galleryImages(surface).map(pathOf).includes('/uploads/products/probe-1.jpg'), 'and the stored photo lands in the gallery')
    await fire(pickers[before + 1], 'cancel')
    await surface.unmount()
    uploads.length = 0
  }

  // Cancel and the header Close both leave the form while a picker that never reported is still waiting.
  for (const control of ['Cancel', 'Close'] as const) {
    const closed: number[] = []
    const surface = await mountForm('en', { onClose() { closed.push(1) } })
    const before = pickers.length
    await surface.click(pickerButton(surface, 'Choose File'))
    assert.equal(pickers.length, before + 1)
    const target = control === 'Close'
      ? surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === packs.en.close, 'the header Close')
      : surface.button(packs.en.cancel)
    await surface.click(target)
    assert.deepEqual(closed, [1], `${control} closes the form while the picker is still waiting`)
    await surface.unmount()
    await fire(pickers[before], 'cancel')
  }

  // The page coming back (a camera app, a restored page) ends the wait too, after the same short settle as a focus.
  {
    const surface = await mountForm()
    const before = pickers.length
    const appListeners = heldPageListeners()
    await surface.click(pickerButton(surface, 'Choose File'))
    await showPage()
    await surface.settle()
    assert.equal(heldPageListeners(), appListeners, 'the page returning ended the wait')
    await surface.click(pickerButton(surface, 'Choose File'))
    assert.equal(pickers.length, before + 2, 'the next press opens a fresh picker without a tap')
    pickers[before].files = [photo('from-camera.jpg')]
    await fire(pickers[before], 'change')
    await surface.waitFor(() => uploads.length === 1, 'the late photo upload')
    await surface.settle()
    assert.equal(uploads[0].file.name, 'from-camera.jpg', 'a photo that arrives after the page returned still attaches')
    await fire(pickers[before + 1], 'cancel')
    await surface.unmount()
    uploads.length = 0
  }

  console.log('PASS the product form releases the picker on cancel or focus and uploads a late camera photo')
  console.log('PASS waiting on a picker that reports nothing never locks Close, Cancel or Save, a tap or the page returning ends the wait, and a late photo attaches')

  const tile = (surface: MountedSurface, status: string): MemoryNode | undefined => surface.findAll((node) => node.getAttribute('data-image-tile') === status)[0]
  const alerts = (surface: MountedSurface): string[] => surface.findAll((node) => node.getAttribute('role') === 'alert').map((node) => node.textContent)
  async function pickOne(surface: MountedSurface, name: string, label = 'Choose File'): Promise<void> {
    const before = pickers.length
    await surface.click(pickerButton(surface, label))
    pickers[before].files = [photo(name)]
    await fire(pickers[before], 'change')
  }
  const resetProbes = (): void => {
    uploads.length = 0
    objectUrls.created.length = 0
    objectUrls.revoked.length = 0
    createMatchRows = []
    uploadImpl = async () => ({ public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' })
  }

  // The picked photo is on screen the moment it is chosen, before compression and upload finish.
  {
    resetProbes()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    uploadImpl = async () => { await gate; return { public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' } }
    const surface = await mountForm()
    await pickOne(surface, 'camera.jpg', 'Take Photo')
    await surface.waitFor(() => uploads.length === 1, 'the upload to start')
    await surface.settle()
    assert.equal(uploads.length, 1, 'the upload has started and is still waiting')
    assert.deepEqual(galleryImages(surface), ['blob:probe-1-camera.jpg'], 'the local preview is shown while the upload is pending')
    const pending = tile(surface, 'uploading')
    assert.ok(pending, 'the preview tile is marked uploading')
    assert.equal(surface.findAll((node) => node.getAttribute('role') === 'status' && pending.contains(node)).length, 1, 'the tile carries an uploading indicator')
    assert.equal(propsOf(saveButton(surface)).disabled, true, 'Save still waits for the upload')
    assert.deepEqual(objectUrls.revoked, [], 'the preview URL stays alive while it is shown')
    release()
    await surface.waitFor(() => !tile(surface, 'uploading'), 'the stored photo to replace the preview')
    await surface.settle()
    assert.deepEqual(galleryImages(surface).map(pathOf), ['/uploads/products/probe-1.jpg'], 'the stored photo replaces the preview')
    assert.ok(!tile(surface, 'uploading'), 'no pending tile is left')
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-camera.jpg'], 'the preview URL is revoked when the stored path swaps in')
    assert.equal(propsOf(saveButton(surface)).disabled, false)
    await surface.unmount()
  }

  // A failed upload keeps its tile, shows an inline alert with Retry, never a native popup, and Retry swaps in the stored photo.
  for (const lang of ['en', 'km']) {
    resetProbes()
    const words = packs[lang]
    let attempts = 0
    uploadImpl = async () => {
      attempts += 1
      if (attempts === 1) throw 'offline'
      return { public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' }
    }
    const surface = await mountForm(lang)
    await pickOne(surface, 'camera.jpg', words.take_photo)
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the failed photo tile')
    await surface.settle()
    const failed = tile(surface, 'failed')
    assert.ok(failed, `${lang}: the failed photo keeps its tile`)
    assert.deepEqual(galleryImages(surface), ['blob:probe-1-camera.jpg'], `${lang}: the tile still shows the photo`)
    assert.deepEqual(alerts(surface), [words.image_upload_failed], `${lang}: an inline alert says the upload failed, in the pack language`)
    assert.equal(propsOf(saveButton(surface)).disabled, false, `${lang}: the form is usable again`)
    assert.ok(!surface.text().includes(words.uploading), `${lang}: nothing claims to be uploading`)
    await surface.click(surface.button(words.retry, failed))
    await surface.waitFor(() => attempts === 2 && !tile(surface, 'failed') && !tile(surface, 'uploading'), 'the retried photo to land')
    await surface.settle()
    assert.equal(attempts, 2, `${lang}: Retry uploads the same photo again`)
    assert.equal(uploads[1].file, uploads[0].file, `${lang}: without picking it again`)
    assert.deepEqual(alerts(surface), [], `${lang}: the alert clears`)
    assert.deepEqual(galleryImages(surface).map(pathOf), ['/uploads/products/probe-1.jpg'])
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-camera.jpg'])
    await surface.unmount()
  }

  // Removing a failed tile and closing the form both release the preview URL.
  {
    resetProbes()
    uploadImpl = async () => { throw new Error('Server said no') }
    const surface = await mountForm()
    await pickOne(surface, 'one.jpg')
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the failed photo tile')
    await surface.settle()
    assert.deepEqual(alerts(surface), ['Server said no'], 'the server message is shown as is')
    await surface.click(surface.button('Remove', tile(surface, 'failed')))
    assert.ok(!tile(surface, 'failed'))
    assert.deepEqual(alerts(surface), [])
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-one.jpg'], 'removing the tile revokes its preview URL')
    await pickOne(surface, 'two.jpg')
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the second failed photo tile')
    await surface.settle()
    assert.ok(tile(surface, 'failed'))
    await surface.unmount()
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-one.jpg', 'blob:probe-2-two.jpg'], 'closing the form revokes the preview URL of a tile still on screen')
  }
  {
    resetProbes()
    let release!: () => void
    uploadImpl = async () => { await new Promise<void>((resolve) => { release = resolve }); return { public_path: '/uploads/products/probe-1.jpg' } }
    const surface = await mountForm()
    await pickOne(surface, 'mid-flight.jpg')
    await surface.waitFor(() => uploads.length === 1, 'the upload to start')
    await surface.settle()
    await surface.unmount()
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-mid-flight.jpg'], 'unmounting mid-upload revokes the preview URL')
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  // The stored photo is what Save sends, and it is what a reopened product shows.
  {
    resetProbes()
    const saved: Array<{ image_gallery: string[]; image_path: string }> = []
    const surface = await mountForm('en', { onSave: async (payload: { image_gallery: string[]; image_path: string }) => { saved.push(payload) } })
    await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
    await pickOne(surface, 'camera.jpg')
    await surface.waitFor(() => galleryImages(surface).some((src) => !src.startsWith('blob:')), 'the stored photo')
    await surface.settle()
    await surface.click(saveButton(surface))
    await surface.click(surface.button('Create Products', surface.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes('Selling price'), 'the save review')))
    assert.deepEqual(saved.map((payload) => payload.image_gallery), [['/uploads/products/probe-1.jpg']], 'Save sends the stored path, never a blob URL')
    assert.equal(saved[0].image_path, '/uploads/products/probe-1.jpg')
    await surface.unmount()
    const reopened = await mountForm('en', { product: { id: 7, name: 'Probe serum', image_path: '/uploads/products/probe-1.jpg', image_gallery: ['/uploads/products/probe-1.jpg'] } })
    assert.deepEqual(galleryImages(reopened).map(pathOf), ['/uploads/products/probe-1.jpg'], 'the reopened product shows its stored photo')
    await reopened.unmount()
  }

  console.log('PASS a picked photo shows at once with an uploading indicator, a failure shows an inline alert with Retry, and preview URLs are revoked')

  // A failed photo's tile has icon-only 44 px Retry and Remove that fit at every phone width; Save and Minimize refuse until
  // it is retried or removed.
  for (const lang of ['en', 'km']) {
    resetProbes()
    const words = packs[lang]
    const saved: unknown[] = []
    const minimized: unknown[] = []
    let attempts = 0
    uploadImpl = async () => {
      attempts += 1
      if (attempts === 1) throw 'offline'
      return { public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' }
    }
    const surface = await mountForm(lang, { onSave: async (payload: unknown) => { saved.push(payload) }, onMinimize: (...args: unknown[]) => { minimized.push(args) } })
    await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
    await pickOne(surface, 'camera.jpg', words.take_photo)
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the failed photo tile')
    await surface.settle()
    const failed = tile(surface, 'failed')!
    const [retry, remove, ...extra] = surface.findAll((node) => node.tagName === 'BUTTON' && failed.contains(node))
    assert.ok(retry && remove && extra.length === 0, `${lang}: the failed tile offers exactly Retry and Remove`)

    // Icon-only, named once in the pack language, and a thumb-sized target.
    for (const [control, name, label] of [[retry, words.retry, 'Retry'], [remove, words.remove, 'Remove']] as const) {
      assert.equal(control.textContent, '', `${lang}: ${label} on the tile is icon-only, with no text to wrap`)
      assert.equal(control.getAttribute('aria-label'), name, `${lang}: ${label} is named in the pack language`)
      assert.equal(control.getAttribute('title'), name, `${lang}: ${label} carries its name as a tooltip`)
      const classes = classesOf(control.className)
      assert.ok(dimension(classes, 'w') >= 44 && dimension(classes, 'h') >= 44, `${lang}: ${label} is at least 44 x 44 px (${control.className})`)
    }

    // Panel = viewport less the Modal root's side padding (main.css .modal-viewport-safe); the body pads it again.
    const grid = failed.parentNode!
    const body = surface.find((node) => classesOf(node.className).includes('modal-scroll'), 'the modal body')
    const rootRem = Number(/\.modal-viewport-safe\s*\{[^}]*padding-left:\s*calc\(\s*([\d.]+)rem/.exec(readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8'))?.[1])
    assert.ok(rootRem > 0, 'the Modal root padding is read from main.css')
    const footerClasses = classesOf(retry.parentNode!.className)
    const needed = dimension(classesOf(retry.className), 'w') + dimension(classesOf(remove.className), 'w') + horizontalPadding(footerClasses) + gapPx(footerClasses)
    const tilePx = (viewport: number): { columns: number; inner: number } => {
      const columns = gridColumns(classesOf(grid.className), viewport)
      const content = viewport - 2 * rootRem * 16 - horizontalPadding(classesOf(body.className))
      return { columns, inner: (content - (columns - 1) * gapPx(classesOf(grid.className))) / columns - 2 }
    }
    for (const viewport of [360, 340, 339, 320, 300]) {
      const { columns, inner } = tilePx(viewport)
      assert.ok(needed <= inner, `${lang}: Retry and Remove need ${needed} px but a tile is ${inner.toFixed(1)} px wide in ${columns} columns on a ${viewport} px phone`)
    }
    assert.equal(tilePx(360).columns, 3, `${lang}: a 360 px phone keeps three columns`)
    assert.equal(tilePx(320).columns, 2, `${lang}: and a 320 px phone drops to two`)

    // The inline alert has room for Khmer lines.
    const alertText = surface.find((node) => node.getAttribute('role') === 'alert' && node.textContent.includes(words.image_upload_failed), 'the failed-upload alert')
    assert.ok(classesOf(alertText.className).includes('leading-relaxed'), `${lang}: the alert uses leading-relaxed so Khmer is not clipped`)

    // Save refuses, says why, and sends the person to the tile that offers Retry and Remove, even from another tab.
    await surface.click(surface.button(words.pricing))
    assert.ok(!surface.findAll((node) => node.getAttribute('data-image-tile') === 'failed').length, `${lang}: the Pricing tab does not show the photo`)
    await surface.click(saveButton(surface))
    assert.deepEqual(saved, [], `${lang}: Save does not write while a photo is failed`)
    const refusal = surface.findAll((node) => node.getAttribute('role') === 'alert' && node.textContent === words.image_failed_before_save)
    assert.equal(refusal.length, 1, `${lang}: one inline alert explains the refusal in the pack language (${words.image_failed_before_save})`)
    assert.ok(classesOf(refusal[0].className).includes('leading-relaxed'), `${lang}: the refusal uses leading-relaxed`)
    assert.ok(tile(surface, 'failed'), `${lang}: the form went back to the tab with the failed photo`)
    assert.equal(document.activeElement, surface.button(words.retry, tile(surface, 'failed')), `${lang}: focus lands on Retry, the way through`)
    assert.equal(surface.findAll((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(words.label_selling_price)).length, 0, `${lang}: no save review opened`)

    // Minimize would park the draft without the photo, so it refuses the same way.
    await surface.click(surface.button(words.minimize))
    assert.deepEqual(minimized, [], `${lang}: Minimize does not park a form that holds a failed photo`)

    // Retry is the way through: the message goes, the stored photo is in the gallery, and Save reaches the review.
    await surface.click(surface.button(words.retry, tile(surface, 'failed')))
    await surface.waitFor(() => attempts === 2 && !tile(surface, 'failed') && !tile(surface, 'uploading'), 'the retried photo to land')
    await surface.settle()
    assert.equal(surface.findAll((node) => node.getAttribute('role') === 'alert' && node.textContent === words.image_failed_before_save).length, 0, `${lang}: the refusal clears once the photo is stored`)
    await surface.click(saveButton(surface))
    await surface.click(surface.button(words.add_product, saveReview(surface, words)))
    assert.equal(saved.length, 1, `${lang}: Save writes once the photo is stored`)
    assert.deepEqual((saved[0] as { image_gallery: string[] }).image_gallery, ['/uploads/products/probe-1.jpg'])
    await surface.unmount()
  }

  // Remove is the other way through: with the failed tile gone Save has nothing to refuse.
  {
    resetProbes()
    uploadImpl = async () => { throw new Error('Server said no') }
    const saved: unknown[] = []
    const surface = await mountForm('en', { onSave: async (payload: unknown) => { saved.push(payload) } })
    await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
    await pickOne(surface, 'one.jpg')
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the failed photo tile')
    await surface.settle()
    await surface.click(saveButton(surface))
    assert.equal(surface.findAll((node) => node.getAttribute('role') === 'alert' && node.textContent === packs.en.image_failed_before_save).length, 1)
    await surface.click(surface.button('Remove', tile(surface, 'failed')))
    assert.deepEqual(surface.findAll((node) => node.getAttribute('role') === 'alert'), [], 'removing the failed photo clears both alerts')
    await surface.click(saveButton(surface))
    await surface.click(surface.button(packs.en.add_product, saveReview(surface, packs.en)))
    assert.equal(saved.length, 1, 'Save goes through once the failed photo is removed')
    assert.deepEqual((saved[0] as { image_gallery: string[] }).image_gallery, [])
    await surface.unmount()
  }

  // A running upload locks Save, Cancel and Close, and an upload that never answers times out and unlocks them.
  {
    resetProbes()
    uploadImpl = () => new Promise(() => undefined)
    const surface = await mountForm('en', { onMinimize() {} })
    const close = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === packs.en.close, 'the header Close')
    const mark = timerMark()
    await pickOne(surface, 'slow.jpg')
    await surface.waitFor(() => uploads.length === 1, 'the upload to start')
    await surface.settle()
    for (const [name, control] of [['Close', close], ['Cancel', surface.button(packs.en.cancel)], ['Save', saveButton(surface)], ['Minimize', surface.button(packs.en.minimize)]] as const) {
      assert.equal(propsOf(control).disabled, true, `${name} waits for an upload that is really running`)
    }
    assert.ok(surface.text().includes('Uploading...'))
    expireWaitsSince(mark)
    await surface.waitFor(() => Boolean(tile(surface, 'failed')), 'the timed-out upload to fail')
    await surface.settle()
    assert.ok(alerts(surface).some((text) => text.includes('took longer')), 'the failure says the upload took too long')
    for (const [name, control] of [['Close', close], ['Cancel', surface.button(packs.en.cancel)], ['Save', saveButton(surface)], ['Minimize', surface.button(packs.en.minimize)]] as const) {
      assert.notEqual(propsOf(control).disabled, true, `${name} is usable again once the upload has timed out`)
    }
    await surface.unmount()
  }

  // A photo that arrives after Save started, or after the form closed, cannot join the product: it is reported, not dropped.
  for (const lang of ['en', 'km']) {
    resetProbes()
    notices.length = 0
    const words = packs[lang]
    const saved: unknown[] = []
    const surface = await mountForm(lang, { onSave: async (payload: unknown) => { saved.push(payload) } })
    await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
    const before = pickers.length
    await surface.click(pickerButton(surface, words.take_photo))
    const duringSave = pickers[before]
    await tapPage()
    await surface.click(saveButton(surface))
    surface.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(words.label_selling_price), `${lang}: the save review`)
    duringSave.files = [photo('during-save.jpg')]
    await fire(duringSave, 'change')
    await surface.settle()
    assert.deepEqual(notices, [words.image_arrived_too_late], `${lang}: a photo that arrives while the save review is open is reported in the pack language`)
    assert.equal(uploads.length, 0, `${lang}: and not uploaded to a product whose gallery was already taken`)
    assert.deepEqual(saved, [])
    await surface.unmount()
    notices.length = 0
    const afterClose = await mountForm(lang)
    const second = pickers.length
    await afterClose.click(pickerButton(afterClose, words.take_photo))
    await tapPage()
    await afterClose.unmount()
    pickers[second].files = [photo('after-close.jpg')]
    await fire(pickers[second], 'change')
    assert.deepEqual(notices, [words.image_arrived_too_late], `${lang}: a photo that arrives after the form closed is reported too`)
    assert.equal(uploads.length, 0)
  }

  // The create-verdict dialog ("Name already exists") is part of the save too: a photo arriving behind it is reported, not uploaded and left out.
  for (const lang of ['en', 'km']) {
    resetProbes()
    notices.length = 0
    createMatchRows = [{ id: 9, name: 'Probe serum', barcode: '880999', selling_price_usd: 5 }]
    const words = packs[lang]
    const saved: Array<{ image_gallery: string[] }> = []
    const surface = await mountForm(lang, { onSave: async (payload: { image_gallery: string[] }) => { saved.push(payload) } })
    await surface.type(surface.find((node) => node.id === 'product-name', 'name'), 'Probe serum')
    await surface.type(surface.find((node) => node.id === 'product-barcode', 'barcode'), '880123')
    await surface.waitFor(() => surface.text().includes(words.create_match_name_hint.split('{n}')[0]), `${lang}: the name-match hint`)
    const before = pickers.length
    await surface.click(pickerButton(surface, words.take_photo))
    const duringVerdict = pickers[before]
    await tapPage()
    await surface.click(saveButton(surface))
    surface.find((node) => node.getAttribute('role') === 'dialog' && node.textContent.includes(words.create_match_name_title), `${lang}: the verdict dialog`)
    duringVerdict.files = [photo('during-verdict.jpg')]
    await fire(duringVerdict, 'change')
    await surface.settle()
    assert.deepEqual(notices, [words.image_arrived_too_late], `${lang}: a photo that arrives behind the verdict dialog is reported`)
    assert.equal(uploads.length, 0, `${lang}: and not uploaded`)
    await surface.click(surface.find((node) => node.tagName === 'BUTTON' && node.textContent.startsWith(words.create_match_group_button.split('{name}')[0]), `${lang}: the group button`))
    await surface.click(surface.button(words.add_product, saveReview(surface, words)))
    assert.equal(saved.length, 1, `${lang}: the save carries on after the verdict`)
    assert.deepEqual(saved[0].image_gallery, [], `${lang}: with the gallery the form had when Save was pressed`)
    assert.equal(uploads.length, 0, `${lang}: nothing was uploaded behind the person's back`)
    await surface.unmount()
  }

  console.log('PASS a failed photo tile has icon-only 44 px Retry and Remove that fit a phone, and Save and Minimize refuse until it is retried or removed')
  console.log('PASS a photo that arrives after Save started, behind the create-verdict dialog, or after the form closed is reported in English and Khmer, never dropped silently')
  console.log('PASS only an upload that is really running locks the form, and an upload that never answers times out and unlocks it')
} finally {
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
  window.addEventListener = realAddListener
  window.removeEventListener = realRemoveListener
  document.addEventListener = realDocumentAdd
  document.removeEventListener = realDocumentRemove
  document.createElement = realCreateElement as typeof document.createElement
  await harness.close()
}
