import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { apiFetch, route } from './http.ts'
import { buildCSVTemplate, dexieDb } from './localDb.ts'
import { mirrorTable, routeMirrored } from './localMirrors.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { readCachedQueryResult, writeCachedQueryResult } from './queryCache.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { withExpectedUpdatedAt, type ExpectedUpdatedAtPayload } from './expectedUpdatedAt.ts'

type ContactPayload = ExpectedUpdatedAtPayload
type ContactEntityConfig = {
  routeKey: string
  tableName: 'customers' | 'suppliers' | 'delivery_contacts'
  endpoint: string
  requestIdPrefix: string
}

const CONTACT_ENTITY = {
  customers: {
    routeKey: 'customers',
    tableName: 'customers',
    endpoint: '/api/customers',
    requestIdPrefix: 'customer',
  },
  suppliers: {
    routeKey: 'suppliers',
    tableName: 'suppliers',
    endpoint: '/api/suppliers',
    requestIdPrefix: 'supplier',
  },
  deliveryContacts: {
    routeKey: 'deliveryContacts',
    tableName: 'delivery_contacts',
    endpoint: '/api/delivery-contacts',
    requestIdPrefix: 'delivery_contact',
  },
} satisfies Record<string, ContactEntityConfig>

function getDevicePayload(): ContactPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

function hasPagedParams(params: QueryParams = {}): boolean {
  return Object.prototype.hasOwnProperty.call(params || {}, 'page')
    || Object.prototype.hasOwnProperty.call(params || {}, 'pageSize')
}

function localSortedRows(tableName: ContactEntityConfig['tableName']): Promise<unknown[]> {
  return dexieDb.table(tableName).orderBy('name').toArray()
}

function readContactList(config: ContactEntityConfig, params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  const cacheKey = `${config.routeKey}:get:${query}`
  const endpoint = appendQuery(config.endpoint, query)
  if (config.routeKey === 'customers' && hasPagedParams(params)) {
    return routeMirrored(
      cacheKey,
      () => apiFetch('GET', endpoint),
      () => readCachedQueryResult(cacheKey),
      (result) => writeCachedQueryResult(cacheKey, result),
    )
  }

  const mirror = query ? undefined : mirrorTable(config.tableName)
  return routeMirrored(
    cacheKey,
    () => apiFetch('GET', endpoint),
    () => localSortedRows(config.tableName),
    mirror,
  )
}

function createContact(config: ContactEntityConfig, payload: ContactPayload = {}): Promise<unknown> {
  const body = ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, config.requestIdPrefix)
  return route(
    `${config.routeKey}:create`,
    () => apiFetch('POST', config.endpoint, body),
    null,
    true,
  )
}

async function updateContact(
  config: ContactEntityConfig,
  id: string | number,
  payload: ContactPayload = {},
): Promise<unknown> {
  const body = await withExpectedUpdatedAt(config.tableName, id, payload)
  return route(
    `${config.routeKey}:update`,
    () => apiFetch('PUT', `${config.endpoint}/${encodeId(id)}`, body),
    null,
    true,
  )
}

async function deleteContact(config: ContactEntityConfig, id: string | number): Promise<unknown> {
  const body = await withExpectedUpdatedAt(config.tableName, id, {})
  return route(
    `${config.routeKey}:delete`,
    () => apiFetch('DELETE', `${config.endpoint}/${encodeId(id)}`, body),
    null,
    true,
  )
}

function bulkImportContact(config: ContactEntityConfig, payload: ContactPayload = {}): Promise<unknown> {
  return route(
    `${config.routeKey}:bulkImport`,
    () => apiFetch('POST', `${config.endpoint}/bulk-import`, payload),
    null,
    true,
  )
}

export function getCustomers(params: QueryParams = {}): Promise<unknown> {
  return readContactList(CONTACT_ENTITY.customers, params)
}

export function getCustomerPointSummaries(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `customers:points:${query}`,
    () => apiFetch('GET', appendQuery('/api/customers/points-summary', query)),
    () => [],
  )
}

export function createCustomer(payload: ContactPayload = {}): Promise<unknown> {
  return createContact(CONTACT_ENTITY.customers, payload)
}

export function updateCustomer(id: string | number, payload: ContactPayload = {}): Promise<unknown> {
  return updateContact(CONTACT_ENTITY.customers, id, payload)
}

export function deleteCustomer(id: string | number): Promise<unknown> {
  return deleteContact(CONTACT_ENTITY.customers, id)
}

export function bulkImportCustomers(payload: ContactPayload = {}): Promise<unknown> {
  return bulkImportContact(CONTACT_ENTITY.customers, payload)
}

export function downloadCustomerTemplate(): void {
  return buildCSVTemplate([
    '_conflict_mode', '_field_rules',
    'name', 'membership_number', 'phone', 'email', 'address', 'company', 'notes',
    'contact_label_1', 'contact_name_1', 'contact_phone_1', 'contact_email_1', 'contact_address_1',
    'contact_label_2', 'contact_name_2', 'contact_phone_2', 'contact_email_2', 'contact_address_2',
    'contact_label_3', 'contact_name_3', 'contact_phone_3', 'contact_email_3', 'contact_address_3',
  ], 'customers-template.csv')
}

export function getSuppliers(params: QueryParams = {}): Promise<unknown> {
  return readContactList(CONTACT_ENTITY.suppliers, params)
}

export function createSupplier(payload: ContactPayload = {}): Promise<unknown> {
  return createContact(CONTACT_ENTITY.suppliers, payload)
}

export function updateSupplier(id: string | number, payload: ContactPayload = {}): Promise<unknown> {
  return updateContact(CONTACT_ENTITY.suppliers, id, payload)
}

export function deleteSupplier(id: string | number): Promise<unknown> {
  return deleteContact(CONTACT_ENTITY.suppliers, id)
}

export function bulkImportSuppliers(payload: ContactPayload = {}): Promise<unknown> {
  return bulkImportContact(CONTACT_ENTITY.suppliers, payload)
}

export function downloadSupplierTemplate(): void {
  return buildCSVTemplate([
    '_conflict_mode', '_field_rules',
    'name', 'phone', 'email', 'address', 'company', 'contact_person', 'notes',
    'contact_label_1', 'contact_name_1', 'contact_phone_1', 'contact_email_1', 'contact_address_1',
    'contact_label_2', 'contact_name_2', 'contact_phone_2', 'contact_email_2', 'contact_address_2',
    'contact_label_3', 'contact_name_3', 'contact_phone_3', 'contact_email_3', 'contact_address_3',
  ], 'suppliers-template.csv')
}

export function getDeliveryContacts(params: QueryParams = {}): Promise<unknown> {
  return readContactList(CONTACT_ENTITY.deliveryContacts, params)
}

export function createDeliveryContact(payload: ContactPayload = {}): Promise<unknown> {
  return createContact(CONTACT_ENTITY.deliveryContacts, payload)
}

export function updateDeliveryContact(id: string | number, payload: ContactPayload = {}): Promise<unknown> {
  return updateContact(CONTACT_ENTITY.deliveryContacts, id, payload)
}

export function deleteDeliveryContact(id: string | number): Promise<unknown> {
  return deleteContact(CONTACT_ENTITY.deliveryContacts, id)
}

export function bulkImportDeliveryContacts(payload: ContactPayload = {}): Promise<unknown> {
  return bulkImportContact(CONTACT_ENTITY.deliveryContacts, payload)
}
