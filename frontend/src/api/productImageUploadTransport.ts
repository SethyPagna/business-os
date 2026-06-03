import { getSyncServerUrl, requireLiveServerWrite } from './http.ts'

type ImageUploadPayload = {
  file?: File
  fileName?: string
  filePath?: string
  productId?: string | number
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
}: ImageUploadPayload): Promise<unknown> {
  requireLiveServerWrite('products:uploadImage', {
    offlineMessage: 'Server is offline. Product image uploads are invalid until the server reconnects.',
    notConfiguredMessage: 'Server is not connected. Product image uploads are invalid until a live server is configured.',
  })

  const form = new FormData()
  if (file instanceof File) {
    form.append('image', file, file.name || fileName || 'product.jpg')
  } else if (filePath?.startsWith('data:')) {
    form.append('image', dataUrlToBlob(filePath), fileName || 'product.jpg')
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
