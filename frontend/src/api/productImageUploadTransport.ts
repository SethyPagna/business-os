import { getSyncServerUrl, requireLiveServerWrite } from './http.ts'
import { appendImageThumbnails, compressImageFile, createImageThumbnails } from '../utils/imageCompression.ts'
import { canonicalizePersistedMediaPath } from '../utils/mediaUpload.ts'
import { assertActorSessionDispatchAllowed, assertActorReadScope, captureActorReadScope } from './actorReadScope.ts'

type ImageUploadPayload = {
  file?: File
  fileName?: string
  filePath?: string
  productId?: string | number
  /** Product name to rename the stored file to when it matches ("same image name = same product name"). */
  productName?: string
}

type ProductImageUploadResponse = Record<string, unknown> & {
  public_path?: unknown
  path?: unknown
  asset?: (Record<string, unknown> & { public_path?: unknown }) | null
}

function normalizeStoredImageResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as ProductImageUploadResponse
  const rawPath = record.public_path || record.path || record.asset?.public_path || ''
  const publicPath = canonicalizePersistedMediaPath(rawPath)
  if (!publicPath) return record
  return {
    ...record,
    public_path: publicPath,
    path: publicPath,
    ...(record.asset ? { asset: { ...record.asset, public_path: publicPath } } : {}),
  }
}

// S-uploads2b: a product image is an image. When the Worker refuses a file
// for its type, its message was written for the Library ("images ... and
// videos (MP4, MOV, WebM)") or is plain English. On this surface the person
// gets this surface's own images-only message, in their language, instead.
// The set holds the Worker's exact sentences: cloudflare/src/lib/
// uploadSecurity.ts's UNSUPPORTED_UPLOAD_MESSAGE, UNSUPPORTED_IMAGE_MESSAGE
// and MISMATCHED_UPLOAD_MESSAGE, and routes/products.ts's POST /upload-image
// refusal of a non-image claim. tests/imageOnlyUploadMessages.test.ts feeds
// each one through this transport, so a reworded Worker message fails there.
// A refusal for what an image CONTAINS (embedded markup) keeps its own
// message, and so does every other failure.
const PRODUCT_IMAGE_TYPE_REFUSALS: ReadonlySet<string> = new Set([
  'This file type is not supported. The Library only stores images (JPEG, PNG, WebP, GIF, AVIF) and videos (MP4, MOV, WebM).',
  'This file type is not supported. Upload a JPEG, PNG, WebP, GIF or AVIF image.',
  'Uploaded file contents do not match the selected file type. Please choose a valid image or video file.',
  'Only image files are accepted here',
])

// English only when the language pack cannot be loaded; equal to en.json's
// value (the test pins it).
const PRODUCT_IMAGE_UNSUPPORTED_TYPE_ENGLISH = 'Product images must be JPEG, PNG, WebP, GIF or AVIF. Choose another image.'

// The message in the UI language AppContext applies to <html lang>, read from
// the same language pack the screens use. Callers show error.message as is.
// fileTransport.ts's avatarTypeRefusal is the avatar surface's twin; this
// transport may not import fileTransport.ts (tests/performanceLoadingUx.test.ts).
async function productImageTypeRefusal(): Promise<Error> {
  let message = PRODUCT_IMAGE_UNSUPPORTED_TYPE_ENGLISH
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    const pack = (language.startsWith('km') ? (await import('../lang/km.json')).default : (await import('../lang/en.json')).default) as Record<string, unknown>
    const value = pack['product_image_unsupported_type']
    if (typeof value === 'string' && value.trim()) message = value
  } catch {
    // Keep the English.
  }
  return Object.assign(new Error(message), { code: 'unsupported_image_type' })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta = '', base64 = ''] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export async function uploadProductImage({
  file,
  fileName,
  filePath,
  productName,
}: ImageUploadPayload, assertCurrent?: () => void): Promise<unknown> {
  const scope = captureActorReadScope('products')
  const check = () => { assertActorReadScope(scope, false); assertCurrent?.() }
  check()
  requireLiveServerWrite('products:uploadImage', {
    offlineMessage: 'Server is offline. Product image uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Product image uploads are invalid until a live server is configured.',
  })

  const form = new FormData()
  if (file instanceof File) {
    const compressed = await compressImageFile(file, { renameTo: productName })
    // Video or audio is never a product image: refuse it here instead of
    // uploading all of it only for the Worker to refuse it.
    if (/^(?:video|audio)\//i.test(String(compressed.type || ''))) throw await productImageTypeRefusal()
    form.append('image', compressed, compressed.name || fileName || 'product.jpg')
    // Small WebP copies for lists and grids, stored beside the original (best effort).
    appendImageThumbnails(form, await createImageThumbnails(compressed))
  } else if (filePath?.startsWith('data:')) {
    // Real bug fixed this session: this branch used to upload the raw
    // data-URL blob completely uncompressed -- Products.tsx's
    // uploadGalleryImages() (the product-edit gallery grid, which stages
    // picked/cropped images as data URLs before this transport ever runs)
    // was the one real caller, so every gallery image saved through that
    // path shipped at its full original size no matter what the `file`
    // branch above does, which is the most likely source of "many still
    // went over the limit" reported this session. Route it through the
    // same compressImageFile() the File branch already uses.
    const sourceBlob = dataUrlToBlob(filePath)
    const sourceFile = new File([sourceBlob], fileName || 'product.jpg', { type: sourceBlob.type })
    const compressed = await compressImageFile(sourceFile, { renameTo: productName })
    if (/^(?:video|audio)\//i.test(String(compressed.type || ''))) throw await productImageTypeRefusal()
    form.append('image', compressed, compressed.name || fileName || 'product.jpg')
    appendImageThumbnails(form, await createImageThumbnails(compressed))
  } else if (filePath) {
    throw new Error('Native file path upload not supported in browser mode')
  } else {
    throw new Error('No image file provided')
  }

  const base = getSyncServerUrl().replace(/\/$/, '')
  check()
  assertActorSessionDispatchAllowed(scope)
  const res = await fetch(`${base}/api/products/upload-image`, {
    method: 'POST',
    headers: { 'bypass-tunnel-reminder': 'true' },
    credentials: 'include',
    body: form,
  })
  const text = await res.text()
  check()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    const record = data as { error?: string; message?: string }
    const serverMessage = String(record.error || record.message || '').trim()
    if (PRODUCT_IMAGE_TYPE_REFUSALS.has(serverMessage)) throw await productImageTypeRefusal()
    throw new Error(record.error || record.message || `Image upload failed (${res.status})`)
  }
  const record = data as { data?: unknown }
  return normalizeStoredImageResponse(record.data || data)
}
