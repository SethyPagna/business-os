import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { classesOf, dimension, gapPx, horizontalPadding } from './tailwindPixels.ts'

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
const focusListeners = new Set<Listener>()
const realAddListener = window.addEventListener
const realRemoveListener = window.removeEventListener
window.addEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (type === 'focus') focusListeners.add(listener)
  else (realAddListener as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof window.addEventListener
window.removeEventListener = ((type: string, listener: Listener, ...rest: unknown[]) => {
  if (type === 'focus') focusListeners.delete(listener)
  else (realRemoveListener as (...args: unknown[]) => void)(type, listener, ...rest)
}) as typeof window.removeEventListener

const listenersOf = (input: MemoryNode, type: string): Listener[] => [...((input as unknown as { listeners: Map<string, Set<Listener>> }).listeners.get(type) ?? [])]
async function fire(input: Pending['input'], type: 'change' | 'cancel'): Promise<void> {
  await act(async () => {
    for (const listener of listenersOf(input, type)) listener({ type })
    ;(type === 'change' ? input.onchange : input.oncancel)?.({ type })
  })
}
const focusWindow = async (): Promise<void> => { await act(async () => { for (const listener of [...focusListeners]) listener() }) }
const photo = (name: string): File => new File(['pixels'], name, { type: 'image/jpeg' })

const objectUrls = { created: [] as string[], revoked: [] as string[] }
const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL
URL.createObjectURL = ((blob: Blob) => { const url = `blob:probe-${objectUrls.created.length + 1}-${(blob as File).name ?? 'blob'}`; objectUrls.created.push(url); return url }) as typeof URL.createObjectURL
URL.revokeObjectURL = ((url: string) => { objectUrls.revoked.push(url) }) as typeof URL.revokeObjectURL

const uploads: Array<{ file: File; fileName: string; productName?: string }> = []
let uploadImpl: (payload: { file: File }) => Promise<unknown> = async () => ({ public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' })
const doubles = {
  'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/productImageUploadTransport.ts': { uploadProductImage: async (payload: { file: File; fileName: string; productName?: string }) => { uploads.push(payload); return uploadImpl(payload) } },
}

async function mountForm(lang = 'en', overrides: Record<string, unknown> = {}): Promise<MountedSurface> {
  localStorage.clear()
  const words = packs[lang]
  const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
  const app = { user, page: 'products', t: (key: string) => words[key] || '', notify() {}, settings: {}, formatDateTime: String }
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
    assert.ok(surface.text().includes('Uploading...'), 'the form is locked while the picker is open')
    assert.equal(propsOf(saveButton(surface)).disabled, true, 'Save waits for the picker')
    await fire(input, 'cancel')
    await surface.settle()
    assert.ok(!surface.text().includes('Uploading...'), 'cancelling the picker releases the form')
    assert.equal(propsOf(saveButton(surface)).disabled, false, 'Save works again')
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

  console.log('PASS the product form releases the picker on cancel or focus and uploads a late camera photo')

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

  // Review finding 6. A photo that failed to upload is not part of the product, so Save used to drop it without a word.
  // Its tile now offers icon-only Retry and Remove that are real touch targets and fit the 3-column grid on a phone,
  // and Save (or Minimize) refuses, in the pack language, until the person has retried or removed it.
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

    // Both targets fit the tile on a 360 px and a 320 px phone: the Modal body pads the grid, the grid has 3 columns and a gap.
    const grid = failed.parentNode!
    const body = surface.find((node) => classesOf(node.className).includes('modal-scroll'), 'the modal body')
    assert.ok(classesOf(grid.className).includes('grid-cols-3'), `${lang}: the photos sit in a 3-column grid on a phone`)
    const footerClasses = classesOf(retry.parentNode!.className)
    const needed = dimension(classesOf(retry.className), 'w') + dimension(classesOf(remove.className), 'w') + horizontalPadding(footerClasses) + gapPx(footerClasses)
    for (const viewport of [360, 320]) {
      const content = viewport - horizontalPadding(classesOf(body.className))
      const tileWidth = (content - 2 * gapPx(classesOf(grid.className))) / 3
      const inner = tileWidth - 2
      assert.ok(needed <= inner, `${lang}: Retry and Remove need ${needed} px but a tile is ${inner.toFixed(1)} px wide on a ${viewport} px phone`)
    }

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

  console.log('PASS a failed photo tile has icon-only 44 px Retry and Remove that fit a phone, and Save and Minimize refuse until it is retried or removed')
} finally {
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
  window.addEventListener = realAddListener
  window.removeEventListener = realRemoveListener
  document.createElement = realCreateElement as typeof document.createElement
  await harness.close()
}
