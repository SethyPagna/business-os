import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizePersistedMediaPath } from '../src/utils/mediaUpload.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '../src/components/products/forms/ProductForm.tsx'), 'utf8')
const modalSource = fs.readFileSync(path.join(here, '../src/components/shared/Modal.tsx'), 'utf8')

assert.match(source, /readWorkDraft<Partial<ProductFormState> \| ProductFormDraftPayload>/,
  'restore accepts the deployed form-only draft and the gallery-aware draft')
assert.match(source, /normalizeProductFormDraft\(restoredDraft\.data\)[\s\S]*?setForm[\s\S]*?canManageImages && restored\.imageList[\s\S]*?setImageList\(restored\.imageList\)/,
  'restore applies gallery order only while image permission is currently granted')
assert.match(source, /scheduleWorkDraftWrite<ProductFormDraftPayload>\(draftKey, \{[\s\S]*?form,[\s\S]*?imageList:/,
  'form and gallery persist atomically under the existing scoped draft key')
assert.match(source, /setImageUploading\(true\)[\s\S]*?await pickImageFiles/,
  'the form locks dismissal before the native picker/upload awaits')
assert.match(source, /for \(const \[index, file\] of files\.entries\(\)\)[\s\S]*?updateImageList\([\s\S]*?persistImmediately: true/,
  'every successful file is linked and flushed before the next upload can fail')
assert.doesNotMatch(source, /stagedImages/, 'uploads are not held only in volatile batch-local state')
assert.match(source, /closeDisabled=\{imageUploading\}/)
assert.match(source, /disabled=\{saving \|\| imageUploading\}[\s\S]*?onMinimize=\{preserveAndMinimize\}/)
assert.match(source, /<ModalCloseContext\.Consumer>[\s\S]*?onClick=\{requestClose \|\| onClose\}[\s\S]*?disabled=\{saving \|\| imageUploading\}/,
  'Cancel uses the Modal close guard and cannot unmount an active upload')
assert.match(modalSource, /closeDisabled\?: boolean[\s\S]*?const requestClose = closeDisabled \? \(\) => \{\} : closeGuard\.requestClose/,
  'the shared close button and context honor the upload lock')
assert.match(source, /const savableImageList = canManageImages[\s\S]*?: normalizeGallery\(initialForm/,
  'revoked image permission submits the unchanged server gallery')

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

const lifecycleListeners = new Map<string, Array<() => void>>()
Object.assign(globalThis, {
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  window: {
    setTimeout,
    clearTimeout,
    addEventListener(name: string, listener: () => void) {
      lifecycleListeners.set(name, [...(lifecycleListeners.get(name) || []), listener])
    },
  },
  document: {
    visibilityState: 'visible',
    addEventListener(name: string, listener: () => void) {
      lifecycleListeners.set(name, [...(lifecycleListeners.get(name) || []), listener])
    },
  },
})

const { flushPendingWorkDraft, readWorkDraft, scheduleWorkDraftWrite } = await import('../src/utils/workDrafts.ts')
const draftKey = 'product-gallery-lifecycle-fixture'
const firstPath = canonicalizePersistedMediaPath('/uploads/Lovenude Lip Stain 7.webp?v=1')
const secondPath = canonicalizePersistedMediaPath('/uploads/ក្រែម ខ្មែរ.webp?v=2')
assert.equal(canonicalizePersistedMediaPath('blob:temporary-preview'), '', 'draft normalization cannot persist blob previews')
assert.equal(canonicalizePersistedMediaPath('data:image/png;base64,AAAA'), '', 'draft normalization cannot persist data previews')
const payload = { form: { name: 'Lovenude Lip Stain 7' }, imageList: [secondPath, firstPath] }
scheduleWorkDraftWrite(draftKey, payload, 60_000)
assert.equal(flushPendingWorkDraft(draftKey), true)
assert.deepEqual(readWorkDraft<typeof payload>(draftKey)?.data, payload,
  'minimize/unmount flush restores exact primary order and literal identities')

const partialKey = 'product-gallery-partial-upload-fixture'
scheduleWorkDraftWrite(partialKey, { form: payload.form, imageList: [firstPath] }, 60_000)
flushPendingWorkDraft(partialKey)
// Model the next transport rejecting: the already successful file remains
// durable because ProductForm flushes inside the upload loop, before await #2.
assert.deepEqual(readWorkDraft<{ form: object; imageList: string[] }>(partialKey)?.data.imageList, [firstPath])

const pagehideKey = 'product-gallery-pagehide-fixture'
scheduleWorkDraftWrite(pagehideKey, payload, 60_000)
for (const listener of lifecycleListeners.get('pagehide') || []) listener()
assert.deepEqual(readWorkDraft<typeof payload>(pagehideKey)?.data, payload,
  'iOS pagehide flush preserves the same form/gallery payload')

console.log('PASS ProductForm gallery drafts survive minimize, partial upload failure, reload and PWA pagehide')
