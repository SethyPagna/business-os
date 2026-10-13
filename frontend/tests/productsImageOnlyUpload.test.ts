import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { classesOf, dimension } from './tailwindPixels.ts'

// Daily-use A items 3-5 on the image-only Products view (the role whose one
// job is attaching photos). Same contract as the full product form: a cancelled
// or refocus-only picker lets go of the input, and a camera photo that arrives
// after the focus fallback is still uploaded and saved.

type Listener = (event?: unknown) => void
type PickerInput = MemoryNode & { files?: File[] | null; parentNode: MemoryNode | null }

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const words = packs.en
const harness = await createHarness({ observe: ['utils/dirtyWork.ts'] })

const pickers: PickerInput[] = []
const realCreateElement = document.createElement.bind(document)
document.createElement = ((name: string) => {
  const node = realCreateElement(name) as unknown as PickerInput
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
async function fire(input: PickerInput, type: 'change' | 'cancel'): Promise<void> {
  await act(async () => { for (const listener of listenersOf(input, type)) listener({ type }) })
}
const focusWindow = async (): Promise<void> => { await act(async () => { for (const listener of [...focusListeners]) listener() }) }
const photo = (name: string): File => new File(['pixels'], name, { type: 'image/jpeg' })

const objectUrls = { created: [] as string[], revoked: [] as string[] }
const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL
URL.createObjectURL = ((blob: Blob) => { const url = `blob:probe-${objectUrls.created.length + 1}-${(blob as File).name ?? 'blob'}`; objectUrls.created.push(url); return url }) as typeof URL.createObjectURL
URL.revokeObjectURL = ((url: string) => { objectUrls.revoked.push(url) }) as typeof URL.revokeObjectURL

const rows = [
  { id: 1, name: 'Synthetic serum', image_path: null, updated_at: '2026-10-01T00:00:00Z' },
  { id: 2, name: 'Synthetic cream', image_path: null, updated_at: '2026-10-01T00:00:00Z' },
]
const uploads: Array<{ file: File; productId: number }> = []
const saves: Array<{ id: number; image_path: string }> = []
let gate: Promise<void> = Promise.resolve()
let uploadFailure: unknown = null
let saveFailure: unknown = null
// The navigation guard's registry, so the test can ask the same question the guard asks: is any work at risk right now?
const dirtyWork: Array<{ key: string; label: string; isDirty: () => boolean; discard?: () => void }> = []
const workAtRisk = (): string[] => dirtyWork.filter((entry) => entry.isDirty()).map((entry) => entry.label)
const doubles = {
  'utils/dirtyWork.ts': { registerDirtyWork: (entry: (typeof dirtyWork)[number]) => { dirtyWork.push(entry); return () => { dirtyWork.splice(dirtyWork.indexOf(entry), 1) } } },
  'api/productReadTransport.ts': { searchProducts: async () => ({ items: rows, total: rows.length }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/productWriteTransport.ts': {
    updateProduct: async (id: number, patch: { image_path: string }) => { saves.push({ id, image_path: patch.image_path }); if (saveFailure) { const failure = saveFailure; saveFailure = null; throw failure } return { success: true, item: { id, image_path: patch.image_path, updated_at: '2026-10-12T00:00:00Z' } } },
  },
  'api/productImageUploadTransport.ts': {
    uploadProductImage: async (payload: { file: File; productId: number }) => { uploads.push(payload); await gate; if (uploadFailure) { const failure = uploadFailure; uploadFailure = null; throw failure } return { public_path: `/uploads/products/${payload.file.name}` } },
  },
}

async function mountView(lang = 'en'): Promise<MountedSurface> {
  const pack = packs[lang]
  const app = {
    t: (key: string) => pack[key] || key, notify() {}, hasPermission: () => false,
    fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
    user: { id: 1, username: 'fixture-image-only', role_code: 'products_image_only' },
  }
  return harness.mount({ component: 'components/products/ProductsImageOnlyView.tsx', app, doubles })
}
const rowButton = (surface: MountedSurface, productName: string, label: string): MemoryNode => {
  const card = surface.find((node) => node.tagName === 'DIV' && node.className.includes('card') && node.textContent.includes(productName), `${productName} row`)
  return surface.button(label, card)
}

try {
  {
    const surface = await mountView()
    const before = pickers.length
    await surface.click(rowButton(surface, 'Synthetic serum', words.choose_file))
    const input = pickers[before]
    assert.ok(input?.parentNode, 'the hidden picker input is attached while the picker is open')
    await fire(input, 'cancel')
    assert.ok(input.parentNode === null, 'cancelling the picker removes the hidden input at once')
    assert.equal(uploads.length, 0)
    await surface.click(rowButton(surface, 'Synthetic serum', words.take_photo))
    assert.equal(pickers.length, before + 2, 'the next tap opens a new picker')
    assert.equal(pickers[before + 1].getAttribute('capture'), 'environment')
    await fire(pickers[before + 1], 'cancel')
    await surface.unmount()
  }

  {
    const surface = await mountView()
    const before = pickers.length
    await surface.click(rowButton(surface, 'Synthetic serum', words.take_photo))
    await focusWindow()
    await surface.settle()
    const input = pickers[before]
    input.files = [photo('camera.jpg')]
    await fire(input, 'change')
    await surface.settle({ until: () => saves.length === 1 })
    assert.deepEqual(uploads.map((upload) => [upload.file.name, upload.productId]), [['camera.jpg', 1]], 'a photo that arrives after the fallback is uploaded for its row')
    assert.deepEqual(saves, [{ id: 1, image_path: '/uploads/products/camera.jpg' }], 'and saved on that product')
    await surface.unmount()
    uploads.length = 0
    saves.length = 0
  }

  {
    const surface = await mountView()
    const before = pickers.length
    await surface.click(rowButton(surface, 'Synthetic serum', words.take_photo))
    await focusWindow()
    await surface.settle()
    const abandoned = pickers[before]
    let release!: () => void
    gate = new Promise<void>((resolve) => { release = resolve })
    await surface.click(rowButton(surface, 'Synthetic cream', words.choose_file))
    const current = pickers[before + 1]
    current.files = [photo('cream.jpg')]
    await fire(current, 'change')
    await surface.settle({ until: () => uploads.length === 1 })
    abandoned.files = [photo('serum-late.jpg')]
    await fire(abandoned, 'change')
    await surface.settle()
    assert.deepEqual(uploads.map((upload) => upload.file.name), ['cream.jpg'], 'a late photo waits while another row is saving')
    release()
    await surface.settle({ until: () => saves.length === 2 })
    assert.deepEqual(uploads.map((upload) => [upload.file.name, upload.productId]), [['cream.jpg', 2], ['serum-late.jpg', 1]], 'and is uploaded for its own row afterwards')
    assert.deepEqual(saves.map((save) => save.id), [2, 1])
    await surface.unmount()
    gate = Promise.resolve()
    uploads.length = 0
    saves.length = 0
  }

  console.log('PASS the image-only view releases the picker on cancel and uploads a late camera photo for its own row')

  const card = (surface: MountedSurface, productName: string): MemoryNode => surface.find((node) => node.tagName === 'DIV' && node.className.includes('card') && node.textContent.includes(productName), `${productName} row`)
  const previews = (surface: MountedSurface, productName: string): string[] => {
    const row = card(surface, productName)
    return surface.findAll((node) => node.tagName === 'IMG' && row.contains(node)).map((node) => node.getAttribute('src') || '')
  }
  const alertsIn = (surface: MountedSurface, productName: string): string[] => {
    const row = card(surface, productName)
    return surface.findAll((node) => node.getAttribute('role') === 'alert' && row.contains(node)).map((node) => node.textContent)
  }
  const spinnersIn = (surface: MountedSurface, productName: string): number => {
    const row = card(surface, productName)
    return surface.findAll((node) => node.getAttribute('role') === 'status' && row.contains(node)).length
  }
  async function pickFor(surface: MountedSurface, productName: string, name: string, label = words.choose_file): Promise<void> {
    const before = pickers.length
    await surface.click(rowButton(surface, productName, label))
    pickers[before].files = [photo(name)]
    await fire(pickers[before], 'change')
  }
  const reset = (): void => {
    uploads.length = 0
    saves.length = 0
    gate = Promise.resolve()
    uploadFailure = null
    saveFailure = null
    objectUrls.created.length = 0
    objectUrls.revoked.length = 0
  }

  // The chosen photo is on the row the moment it is picked, before the upload resolves; the stored one replaces it.
  {
    reset()
    let release!: () => void
    gate = new Promise<void>((resolve) => { release = resolve })
    const surface = await mountView()
    await pickFor(surface, 'Synthetic serum', 'camera.jpg', words.take_photo)
    await surface.waitFor(() => uploads.length === 1, 'the upload to start')
    await surface.settle()
    assert.ok(previews(surface, 'Synthetic serum').includes('blob:probe-1-camera.jpg'), 'the picked photo is shown on its row while the upload is pending')
    assert.equal(spinnersIn(surface, 'Synthetic serum'), 1, 'with an uploading indicator')
    assert.ok(propsOf(rowButton(surface, 'Synthetic serum', words.choose_file)).disabled === true, 'the row cannot start a second upload meanwhile')
    assert.deepEqual(objectUrls.revoked, [], 'the preview URL stays alive while it is shown')
    release()
    await surface.waitFor(() => saves.length === 1 && previews(surface, 'Synthetic serum').every((src) => !src.startsWith('blob:')), 'the stored photo to replace the preview')
    await surface.settle()
    assert.deepEqual(saves, [{ id: 1, image_path: '/uploads/products/camera.jpg' }])
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-camera.jpg'], 'the preview URL is revoked once the stored photo replaces it')
    assert.equal(spinnersIn(surface, 'Synthetic serum'), 0)
    await surface.unmount()
  }

  // A failed upload keeps the photo on the row with an inline alert and Retry (never a native popup); Retry sends the same file.
  for (const lang of ['en', 'km']) {
    reset()
    const pack = packs[lang]
    uploadFailure = 'offline'
    const surface = await mountView(lang)
    await pickFor(surface, 'Synthetic serum', 'one.jpg', pack.choose_file)
    await surface.waitFor(() => alertsIn(surface, 'Synthetic serum').length === 1, 'the inline alert')
    await surface.settle()
    assert.deepEqual(alertsIn(surface, 'Synthetic serum'), [pack.image_upload_failed], `${lang}: the alert names the failure in the pack language`)
    assert.ok(previews(surface, 'Synthetic serum').includes('blob:probe-1-one.jpg'), `${lang}: the failed photo stays visible`)
    assert.equal(spinnersIn(surface, 'Synthetic serum'), 0, `${lang}: nothing claims to be uploading`)
    assert.ok(propsOf(rowButton(surface, 'Synthetic serum', pack.choose_file)).disabled !== true, `${lang}: the row is usable again`)
    assert.deepEqual(objectUrls.revoked, [], `${lang}: the preview is kept for Retry`)
    // Review finding 6, sibling surface: the row's Retry and Discard are icon-only 44 px targets named in the pack language.
    for (const [control, name, label] of [[surface.button(pack.retry, card(surface, 'Synthetic serum')), pack.retry, 'Retry'], [surface.button(pack.discard, card(surface, 'Synthetic serum')), pack.discard, 'Discard']] as const) {
      assert.equal(control.textContent, '', `${lang}: ${label} on the failed row is icon-only`)
      assert.equal(control.getAttribute('aria-label'), name, `${lang}: ${label} is named in the pack language`)
      assert.equal(control.getAttribute('title'), name, `${lang}: ${label} carries its name as a tooltip`)
      const classes = classesOf(control.className)
      assert.ok(dimension(classes, 'w') >= 44 && dimension(classes, 'h') >= 44, `${lang}: ${label} is at least 44 x 44 px (${control.className})`)
    }
    assert.ok(classesOf(surface.find((node) => node.getAttribute('role') === 'alert', 'the row alert').className).includes('leading-relaxed'), `${lang}: the alert uses leading-relaxed`)
    // A failed photo is work at risk: leaving the page now would drop it, so the navigation guard must ask first.
    assert.deepEqual(workAtRisk(), [pack.image_upload_failed], `${lang}: the guard sees the failed photo`)
    await surface.click(surface.button(pack.retry, card(surface, 'Synthetic serum')))
    await surface.waitFor(() => saves.length === 1 && alertsIn(surface, 'Synthetic serum').length === 0, 'the retried photo to land')
    await surface.settle()
    assert.equal(uploads.length, 2, `${lang}: Retry uploads again`)
    assert.ok(uploads[1].file === uploads[0].file, `${lang}: the same photo, without picking it twice`)
    assert.deepEqual(saves, [{ id: 1, image_path: '/uploads/products/one.jpg' }])
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-one.jpg'], `${lang}: the preview is revoked once the stored photo replaces it`)
    assert.deepEqual(workAtRisk(), [], `${lang}: nothing is at risk once the photo is stored`)
    await surface.unmount()
    assert.deepEqual(dirtyWork, [], `${lang}: closing the view unregisters its guard`)
  }

  // When the upload worked but linking it to the product failed, Retry links the stored file instead of uploading again.
  {
    reset()
    saveFailure = new Error('Product is locked')
    const surface = await mountView()
    await pickFor(surface, 'Synthetic serum', 'linked.jpg')
    await surface.waitFor(() => alertsIn(surface, 'Synthetic serum').length === 1, 'the inline alert')
    await surface.settle()
    assert.deepEqual(alertsIn(surface, 'Synthetic serum'), ['Product is locked'], 'the server message is shown as is')
    await surface.click(surface.button(words.retry, card(surface, 'Synthetic serum')))
    await surface.waitFor(() => saves.length === 2 && alertsIn(surface, 'Synthetic serum').length === 0, 'the retried link')
    await surface.settle()
    assert.equal(uploads.length, 1, 'the file is not uploaded a second time')
    assert.deepEqual(saves.map((save) => save.image_path), ['/uploads/products/linked.jpg', '/uploads/products/linked.jpg'])
    await surface.unmount()
  }

  // Discarding, replacing and closing the view each release the preview URL they hold.
  {
    reset()
    uploadFailure = 'offline'
    const surface = await mountView()
    await pickFor(surface, 'Synthetic serum', 'first.jpg')
    await surface.waitFor(() => alertsIn(surface, 'Synthetic serum').length === 1, 'the inline alert')
    await surface.settle()
    await surface.click(surface.button(words.discard, card(surface, 'Synthetic serum')))
    assert.deepEqual(alertsIn(surface, 'Synthetic serum'), [])
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-first.jpg'], 'discarding a failed photo revokes its preview URL')
    assert.deepEqual(workAtRisk(), [], 'a discarded failed photo is no longer at risk')

    uploadFailure = 'offline'
    await pickFor(surface, 'Synthetic serum', 'second.jpg')
    await surface.waitFor(() => alertsIn(surface, 'Synthetic serum').length === 1, 'the inline alert')
    await surface.settle()
    uploadFailure = 'offline'
    await pickFor(surface, 'Synthetic serum', 'third.jpg')
    await surface.waitFor(() => objectUrls.created.length === 3, 'the replacement preview')
    await surface.waitFor(() => alertsIn(surface, 'Synthetic serum').length === 1, 'the replacement alert')
    await surface.settle()
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-first.jpg', 'blob:probe-2-second.jpg'], 'replacing a failed photo revokes the one it replaces')
    await surface.unmount()
    assert.deepEqual(objectUrls.revoked, ['blob:probe-1-first.jpg', 'blob:probe-2-second.jpg', 'blob:probe-3-third.jpg'], 'closing the view revokes the photo still on a row')
  }

  console.log('PASS the image-only view previews a picked photo at once, shows a failure inline with Retry, and revokes preview URLs')
} finally {
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
  window.addEventListener = realAddListener
  window.removeEventListener = realRemoveListener
  document.createElement = realCreateElement as typeof document.createElement
  await harness.close()
}
