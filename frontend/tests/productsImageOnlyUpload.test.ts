import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

// Daily-use A items 3-5 on the image-only Products view (the role whose one
// job is attaching photos). Same contract as the full product form: a cancelled
// or refocus-only picker lets go of the input, and a camera photo that arrives
// after the focus fallback is still uploaded and saved.

type Listener = (event?: unknown) => void
type PickerInput = MemoryNode & { files?: File[] | null; parentNode: MemoryNode | null }

const words = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const harness = await createHarness()

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

const rows = [
  { id: 1, name: 'Synthetic serum', image_path: null, updated_at: '2026-10-01T00:00:00Z' },
  { id: 2, name: 'Synthetic cream', image_path: null, updated_at: '2026-10-01T00:00:00Z' },
]
const uploads: Array<{ file: File; productId: number }> = []
const saves: Array<{ id: number; image_path: string }> = []
let gate: Promise<void> = Promise.resolve()
const doubles = {
  'api/productReadTransport.ts': { searchProducts: async () => ({ items: rows, total: rows.length }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/productWriteTransport.ts': {
    updateProduct: async (id: number, patch: { image_path: string }) => { saves.push({ id, image_path: patch.image_path }); return { success: true, item: { id, image_path: patch.image_path, updated_at: '2026-10-12T00:00:00Z' } } },
  },
  'api/productImageUploadTransport.ts': {
    uploadProductImage: async (payload: { file: File; productId: number }) => { uploads.push(payload); await gate; return { public_path: `/uploads/products/${payload.file.name}` } },
  },
}

async function mountView(): Promise<MountedSurface> {
  const app = {
    t: (key: string) => words[key] || key, notify() {}, hasPermission: () => false,
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
} finally {
  window.addEventListener = realAddListener
  window.removeEventListener = realRemoveListener
  document.createElement = realCreateElement as typeof document.createElement
  await harness.close()
}
