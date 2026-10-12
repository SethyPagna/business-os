import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

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

const uploads: Array<{ file: File; fileName: string; productName?: string }> = []
let uploadImpl: (payload: { file: File }) => Promise<unknown> = async () => ({ public_path: '/uploads/products/probe-1.jpg', cache_version: 'v1' })
const doubles = {
  'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/productImageUploadTransport.ts': { uploadProductImage: async (payload: { file: File; fileName: string; productName?: string }) => { uploads.push(payload); return uploadImpl(payload) } },
}

async function mountForm(lang = 'en'): Promise<MountedSurface> {
  localStorage.clear()
  const words = packs[lang]
  const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
  const app = { user, page: 'products', t: (key: string) => words[key] || '', notify() {}, settings: {}, formatDateTime: String }
  return harness.mount({
    component: 'components/products/forms/ProductForm.tsx',
    props: {
      product: null, categories: [], units: [], branches: [], user, t: (key: string) => words[key] || '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
      onClose() {}, onSave: async () => undefined,
    },
    app, doubles,
  })
}
const pickerButton = (surface: MountedSurface, label: string): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && node.textContent === label, `the ${label} button`)
const saveButton = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && node.className.includes('btn-primary') && node.textContent.length > 0, 'the Save button')
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
} finally {
  window.addEventListener = realAddListener
  window.removeEventListener = realRemoveListener
  document.createElement = realCreateElement as typeof document.createElement
  await harness.close()
}
