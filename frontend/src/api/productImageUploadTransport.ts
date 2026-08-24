import { getSyncServerUrl, requireLiveServerWrite } from './http.ts'
import { compressImageFile } from '../utils/imageCompression.ts'

type ImageUploadPayload = {
  file?: File
  fileName?: string
  filePath?: string
  productId?: string | number
  /** Product name to rename the stored file to when it matches ("same image name = same product name"). */
  productName?: string
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
}: ImageUploadPayload): Promise<unknown> {
  requireLiveServerWrite('products:uploadImage', {
    offlineMessage: 'Server is offline. Product image uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Product image uploads are invalid until a live server is configured.',
  })

  const form = new FormData()
  if (file instanceof File) {
    const compressed = await compressImageFile(file, { renameTo: productName })
    form.append('image', compressed, compressed.name || fileName || 'product.jpg')
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
    form.append('image', compressed, compressed.name || fileName || 'product.jpg')
  } else if (filePath) {
    throw new Error('Native file path upload not supported in browser mode')
  } else {
    throw new Error('No image file provided')
  }

  const base = getSyncServerUrl().replace(/\/$/, '')
  const res = await fetch(`${base}/api/products/upload-image`, {
    method: 'POST',
    headers: { 'bypass-tunnel-reminder': 'true' },
    credentials: 'include',
    body: form,
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    const record = data as { error?: string; message?: string }
    throw new Error(record.error || record.message || `Image upload failed (${res.status})`)
  }
  const record = data as { data?: unknown }
  return record.data || data
}
