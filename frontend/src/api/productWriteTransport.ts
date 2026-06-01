import { apiFetch, cacheInvalidate, route } from './http.ts'
import { dexieDb } from './localDb.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type ProductPayload = ExpectedUpdatedAtPayload

function getDevicePayload(): ProductPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

async function ensureSupplierExists(name: unknown): Promise<void> {
  const supplierName = String(name || '').trim()
  if (!supplierName) return

  try {
    const suppliers = dexieDb.table('suppliers') as unknown as {
      where: (field: string) => {
        equalsIgnoreCase: (value: string) => {
          first: () => Promise<unknown>
        }
      }
    }
    const existing = await suppliers.where('name').equalsIgnoreCase(supplierName).first()
    if (existing) return

    await apiFetch('POST', '/api/suppliers', { name: supplierName, ...getDevicePayload() })
    cacheInvalidate('suppliers')
  } catch (_) {}
}

export async function createProduct(payload: ProductPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'product')
  await ensureSupplierExists(body.supplier)
  return route(
    'products:create',
    () => apiFetch('POST', '/api/products', body),
    null,
    true,
  )
}

export async function updateProduct(id: string | number, payload: ProductPayload = {}): Promise<unknown> {
  await ensureSupplierExists(payload.supplier)
  const body = await withExpectedUpdatedAt('products', id, { ...getDevicePayload(), ...(payload || {}) })
  return route(
    'products:update',
    () => apiFetch('PUT', `/api/products/${encodeId(id)}`, body),
    null,
    true,
  )
}

export async function deleteProduct(id: string | number): Promise<unknown> {
  const payload = await withExpectedUpdatedAt('products', id, {})
  return route(
    'products:delete',
    () => apiFetch('DELETE', `/api/products/${encodeId(id)}`, payload),
    null,
    true,
  )
}

export function createProductVariant(payload: ProductPayload = {}): Promise<unknown> {
  return route(
    'products:create',
    () => apiFetch('POST', '/api/products/variant', payload),
    null,
    true,
  )
}

export function bulkImportProducts(payload: ProductPayload = {}): Promise<unknown> {
  return route(
    'products:bulkImport',
    () => apiFetch('POST', '/api/products/bulk-import', payload),
    null,
    true,
  )
}
