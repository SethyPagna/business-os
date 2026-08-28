import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const repoRoot = resolve(frontendRoot, '..')

type TestCallback = () => void | Promise<void>

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

function readRepo(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('POS checkout keeps client, API, and backend duplicate guards', () => {
  const pos = readFrontend('src/components/pos/POS.tsx')
  const methods = readFrontend('src/api/methods.ts')
  const saleWriteTransport = readFrontend('src/api/saleWriteTransport.ts')
  const salesTransport = readFrontend('src/api/salesTransport.ts')
  const salesRoute = readRepo('cloudflare/src/routes/sales.ts')

  assert.match(pos, /if \(loading \|\| checkoutInFlightRef\.current\) return/)
  assert.match(pos, /checkoutInFlightRef\.current = true[\s\S]*setLoading\(true\)/)
  assert.match(pos, /const POS_CHECKOUT_TIMEOUT_MS = 20000/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => createPosSale\(saleData\)[\s\S]*'Create POS sale',\s*POS_CHECKOUT_TIMEOUT_MS,\s*\)/)
  assert.match(pos, /finally \{[\s\S]*checkoutInFlightRef\.current = false[\s\S]*setLoading\(false\)/)

  assert.match(methods, /export async function createSale\(d\) \{[\s\S]*loadSaleWriteTransport\(\)/)
  assert.match(saleWriteTransport, /ensureSaleClientRequestId\(\{ \.\.\.getClientDeviceInfo\(\), \.\.\.payload \}, 'sale'\)/)
  assert.match(saleWriteTransport, /return await createSaleRequest\(salePayload\)/)
  assert.match(saleWriteTransport, /return queueOfflineSale\(salePayload, err\?\.reason \|\| 'server_offline'\)/)
  assert.match(salesTransport, /route\(\s*'sales:create',[\s\S]*apiFetch\('POST', '\/api\/sales', payload\)[\s\S]*null,[\s\S]*true,/)
  assert.match(salesTransport, /export function createSaleWithoutWriteDedupe/)
  assert.match(salesTransport, /skipWriteDedupe: true/)

  assert.match(salesRoute, /function normalizeClientRequestId\(value: unknown\)/)
  assert.match(salesRoute, /const existingSale = await db[\s\S]*WHERE client_request_id = \?[\s\S]*if \(existingSale\) return c\.json\(\{ id: existingSale\.id, receiptNumber: existingSale\.receipt_number, duplicate: true \}\)/)
  assert.match(salesRoute, /INSERT INTO sales \([\s\S]*receipt_number, client_request_id/)
})

await runTest('POS quick-add customer and delivery writes are bounded', () => {
  const pos = readFrontend('src/components/pos/POS.tsx')

  assert.match(pos, /const POS_CUSTOMER_CREATE_TIMEOUT_MS = 12000/)
  assert.match(pos, /const POS_DELIVERY_CREATE_TIMEOUT_MS = 12000/)
  assert.match(pos, /if \(savingCustomerRef\.current\) return/)
  assert.match(pos, /savingCustomerRef\.current = true[\s\S]*setSavingCustomer\(true\)/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => createPosCustomer\([^)]*newCustomerForm[^)]*\)[\s\S]*'Create POS customer',\s*POS_CUSTOMER_CREATE_TIMEOUT_MS,\s*\)/)
  assert.match(pos, /finally \{[\s\S]*savingCustomerRef\.current = false[\s\S]*setSavingCustomer\(false\)/)
  assert.match(pos, /if \(savingDeliveryRef\.current\) return/)
  assert.match(pos, /savingDeliveryRef\.current = true[\s\S]*setSavingDelivery\(true\)/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => createPosDeliveryContact\(payload\)[\s\S]*'Create POS delivery contact',\s*POS_DELIVERY_CREATE_TIMEOUT_MS,\s*\)/)
  assert.match(pos, /finally \{[\s\S]*savingDeliveryRef\.current = false[\s\S]*setSavingDelivery\(false\)/)
})

await runTest('bulk product import actions use a synchronous in-flight guard', () => {
  const source = readFrontend('src/components/products/import/BulkImportModal.tsx')

  assert.match(source, /import \{ beginNamedAction, finishNamedAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const actionInFlightRef = useRef\(''\)/)
  assert.match(source, /const beginImportAction = \(action: ImportActionName, options: \{ setLoading\?: boolean \} = \{\}\): boolean => \{[\s\S]*if \(!beginNamedAction\(actionInFlightRef, action, \{ blocked: loading \}\)\) return false/)
  assert.match(source, /const finishImportAction = \(action: ImportActionName\): void => \{[\s\S]*finishNamedAction\(actionInFlightRef, action\)[\s\S]*setLoading\(false\)/)
  assert.match(source, /const handleRetryCurrentJob = async \(\) => \{[\s\S]*if \(!beginImportAction\('retry'\)\) return/)
  assert.match(source, /const handleDeleteCurrentJob = async \(\) => \{[\s\S]*if \(!beginImportAction\('delete'\)\) return/)
  assert.match(source, /const handleImageOnlyImport = async \(\) => \{[\s\S]*if \(!beginImportAction\('image-only'\)\) return/)
  assert.match(source, /const handlePickCSV = async \(\) => \{[\s\S]*if \(!beginImportAction\('pick-csv', \{ setLoading: false \}\)\) return/)
  assert.match(source, /const handleImport = async \(\) => \{[\s\S]*if \(!beginImportAction\('import'\)\) return/)
  assert.match(source, /const api = getProductImportApi\(\)[\s\S]*withLoaderTimeout\(\s*\(\) => api\.createImportJob\(/, 'product import job creation should be bounded')
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobCsv\(/, 'product import CSV upload should be bounded')
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobZip\(/, 'product import ZIP upload should be bounded')
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.uploadImportJobImages\(/, 'product import image upload should be bounded')
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.startImportJob\(activeJobId, \{ source: 'products_modal' \}\)/, 'product import job start should be bounded')
})

await runTest('background import tracker actions use a synchronous action guard', () => {
  const source = readFrontend('src/components/shared/BackgroundImportTracker.tsx')

  assert.match(source, /import \{ beginNamedAction, finishNamedAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const actionInFlightRef = useRef\(''\)/)
  assert.match(source, /const beginTrackerAction = \(job: ImportJob, action: string\): TrackerAction \| null => \{[\s\S]*if \(!beginNamedAction\(actionInFlightRef, key, \{ blocked: !!busyJobId \}\)\) return null/)
  assert.match(source, /const finishTrackerAction = \(action: TrackerAction \| null\) => \{[\s\S]*finishNamedAction\(actionInFlightRef, action\?\.key \|\| ''\)[\s\S]*setBusyJobId\(''\)/)
  assert.match(source, /const handleCancel = async \(job: ImportJob\) => \{[\s\S]*const action = beginTrackerAction\(job, 'cancel'\)/)
  assert.match(source, /const handleRetry = async \(job: ImportJob\) => \{[\s\S]*const action = beginTrackerAction\(job, 'retry'\)/)
  assert.match(source, /const handleApprove = async \(job: ImportJob\) => \{[\s\S]*const action = beginTrackerAction\(job, 'approve'\)/)
  assert.match(source, /const handleDownloadErrors = async \(job: ImportJob\) => \{[\s\S]*const action = beginTrackerAction\(job, 'download-errors'\)/)
  assert.match(source, /const handleRemove = async \(job: ImportJob\) => \{[\s\S]*const action = beginTrackerAction\(job, 'remove'\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.cancelImportJob\(action\.jobId\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.retryImportJob\(action\.jobId\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.approveImportJob\(action\.jobId\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.downloadImportJobErrors\(action\.jobId\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.deleteImportJob\(removedId, \{ force \}\)/)
})

await runTest('backup export and restore keep local busy state and are permission-gated', () => {
  const backup = readFrontend('src/components/utils-settings/Backup.tsx')
  const backupsRoute = readRepo('cloudflare/src/routes/backups.ts')

  assert.match(backup, /data-testid="backup-export-create"[\s\S]*disabled=\{!!loading \|\| activeBackupJobRunning\}/)
  assert.match(backup, /data-testid="backup-restore-start"[\s\S]*disabled=\{!!loading \|\| activeBackupJobRunning\}/)
  // Cloudflare's export/restore run synchronously within a single request
  // (see routes/backups.ts's own comments) rather than the old Node
  // backend's background-job queue, so there's no async window for a
  // second identical job to race the first one -- the frontend's
  // activeBackupJobRunning disabled-state above is what prevents a
  // double-click resubmitting mid-request, and every action requires the
  // `backup` permission (previously only requireAuth, i.e. any staff
  // account) before it can run at all.
  assert.match(backupsRoute, /hasPermission\(user, 'backup'\)/)
  assert.match(backupsRoute, /status: 'completed'/)
})

await runTest('return create, edit, and supplier flows keep synchronous submit guards', () => {
  const returns = readFrontend('src/components/returns/Returns.tsx')
  const newReturn = readFrontend('src/components/returns/NewReturnModal.tsx')
  const editReturn = readFrontend('src/components/returns/EditReturnModal.tsx')
  const supplierReturn = readFrontend('src/components/returns/NewSupplierReturnModal.tsx')
  const methods = readFrontend('src/api/methods.ts')
  const returnsTransport = readFrontend('src/api/returnsTransport.ts')
  const returnsRoute = readRepo('cloudflare/src/routes/returns.ts')

  for (const source of [newReturn, editReturn, supplierReturn]) {
    assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
    assert.match(source, /const submitInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(!beginSingleAction\(submitInFlightRef\)\) return/)
    assert.match(source, /beginSingleAction\(submitInFlightRef\)[\s\S]*setSubmitting\(true\)/)
    assert.match(source, /finally \{[\s\S]*finishSingleAction\(submitInFlightRef\)[\s\S]*setSubmitting\(false\)/)
  }

  assert.match(newReturn, /const RETURN_CREATE_TIMEOUT_MS = 15000/)
  assert.match(newReturn, /function loadSalesTransport\(\): Promise<SalesTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/salesTransport\.ts'\)/)
  assert.match(newReturn, /function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/)
  assert.match(newReturn, /async function createReturnRequest\(payload: ReturnCreatePayload\): Promise<unknown>[\s\S]*createReturn\(payload\)/)
  assert.match(newReturn, /withLoaderTimeout\(\s*\(\) => createReturnRequest\(\{[\s\S]*\}\),\s*'Create return',\s*RETURN_CREATE_TIMEOUT_MS,\s*\)/)
  assert.doesNotMatch(newReturn, /getReturnApi|window\.api|api\.createReturn/)
  assert.match(editReturn, /const RETURN_UPDATE_TIMEOUT_MS = 15000/)
  assert.match(editReturn, /function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/)
  assert.match(editReturn, /async function updateReturnRequest\(id: number \| string, payload: ReturnUpdatePayload\): Promise<unknown>[\s\S]*updateReturn\(id, payload\)/)
  assert.match(editReturn, /const payload: ReturnUpdatePayload = \{[\s\S]*withLoaderTimeout\(\s*\(\) => updateReturnRequest\(ret\.id, payload\),\s*'Update return',\s*RETURN_UPDATE_TIMEOUT_MS,\s*\)/)
  assert.doesNotMatch(editReturn, /getReturnApi|window\.api|api\.updateReturn/)
  assert.match(supplierReturn, /const SUPPLIER_RETURN_CREATE_TIMEOUT_MS = 15000/)
  assert.match(supplierReturn, /function loadReturnsTransport\(\): Promise<ReturnsTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/)
  assert.match(supplierReturn, /async function createSupplierReturnRequest\(payload: SupplierReturnPayload\): Promise<unknown>[\s\S]*createSupplierReturn\(payload\)/)
  assert.match(supplierReturn, /withLoaderTimeout\(\s*\(\) => createSupplierReturnRequest\(\{[\s\S]*\}\),\s*'Create supplier return',\s*SUPPLIER_RETURN_CREATE_TIMEOUT_MS,\s*\)/)
  assert.doesNotMatch(supplierReturn, /getSupplierReturnApi|window\.api|api\.createSupplierReturn/)

  assert.match(newReturn, /const searchInFlightRef = useRef\(false\)/)
  assert.match(newReturn, /if \(!beginSingleAction\(searchInFlightRef\)\) return/)
  assert.match(newReturn, /finally \{[\s\S]*finishSingleAction\(searchInFlightRef\)[\s\S]*setSearching\(false\)/)
  assert.match(returns, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(returns, /const RETURNS_HISTORY_RESTORE_TIMEOUT_MS = 15000/)
  assert.match(returns, /getReturn as fetchReturnDetail[\s\S]*getReturns as fetchReturns[\s\S]*from '\.\.\/\.\.\/api\/returnsReadTransport\.ts'/)
  assert.match(returns, /function loadReturnsWriteTransport\(\): Promise<ReturnsWriteTransportModule>[\s\S]*import\('\.\.\/\.\.\/api\/returnsTransport\.ts'\)/)
  assert.match(returns, /const historyRestoreInFlightRef = useRef\(false\)/)
  assert.match(returns, /if \(!beginSingleAction\(historyRestoreInFlightRef\)\) return/)
  assert.match(returns, /withLoaderTimeout\(\s*\(\) => updateReturnRequest\(snapshot\.id as number \| string, \{[\s\S]*\}\),\s*'Restore return snapshot',\s*RETURNS_HISTORY_RESTORE_TIMEOUT_MS,\s*\)/)
  assert.match(returns, /finally \{[\s\S]*finishSingleAction\(historyRestoreInFlightRef\)/)
  assert.doesNotMatch(returns, /getReturnApi|window\.api|api\.(?:getReturn|updateReturn)/)

  assert.match(methods, /export async function createReturn\(d\) \{[\s\S]*loadReturnsTransport\(\)/)
  assert.match(methods, /export async function createSupplierReturn\(d\) \{[\s\S]*loadReturnsTransport\(\)/)
  assert.match(returnsTransport, /ensureClientRequestId\(\{ \.\.\.getDevicePayload\(\), \.\.\.\(payload \|\| \{\}\) \}, 'return'\)/)
  assert.match(returnsTransport, /ensureClientRequestId\(\{ \.\.\.getDevicePayload\(\), \.\.\.\(payload \|\| \{\}\) \}, 'supplier_return'\)/)
  assert.match(returnsRoute, /function normalizeClientRequestId\(value: unknown\)/)
  const returnDedupePattern = /if \(clientRequestId\) \{\s*const existing = await db\.prepare\('SELECT id, return_number FROM returns WHERE client_request_id = \? LIMIT 1'\)[\s\S]*?if \(existing\) return c\.json\(\{ id: existing\.id, returnNumber: existing\.return_number, duplicate: true \}\)\s*\}/g
  const returnDedupeMatches = returnsRoute.match(returnDedupePattern) || []
  assert.equal(returnDedupeMatches.length, 2, 'expected the same dedupe check in both the customer-return and supplier-return POST handlers')
})

await runTest('file picker and library upload/delete flows keep synchronous action guards', () => {
  const picker = readFrontend('src/components/files/FilePickerModal.tsx')
  const filesPage = readFrontend('src/components/files/FilesPage.tsx')
  const fileTransport = readFrontend('src/api/fileTransport.ts')

  for (const source of [picker, filesPage]) {
    assert.match(source, /const uploadInFlightRef = useRef\(false\)/)
    assert.match(source, /const deleteInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(uploadInFlightRef\.current\) return/)
    assert.match(source, /uploadInFlightRef\.current = true[\s\S]*setUploading\(true\)/)
    assert.match(source, /finally \{[\s\S]*uploadInFlightRef\.current = false[\s\S]*setUploading\(false\)/)
    assert.match(source, /finally \{[\s\S]*deleteInFlightRef\.current = false[\s\S]*setDeletingAssetId\(null\)/)
    assert.match(source, /disabled=\{uploading \|\| deletingAssetId != null\}/)
  }

  // Picker keeps the plain window.confirm gate; FilesPage.tsx replaced it
  // with a real "type CONFIRM DELETE" modal (with an unlock checkbox for
  // locked/in-use files) -- these diverged on purpose, so each gets its
  // own assertion instead of sharing the loop above.
  assert.match(picker, /deleteInFlightRef\.current = true[\s\S]*window\.confirm/)
  assert.match(filesPage, /deleteConfirmText\.trim\(\)\.toUpperCase\(\) !== 'CONFIRM DELETE'\) return[\s\S]*const locked = !asset\.canDelete[\s\S]*if \(locked && !deleteUnlockChecked\) return[\s\S]*deleteInFlightRef\.current = true/)

  assert.match(filesPage, /const FILES_ASSET_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(filesPage, /const FILES_ASSET_DELETE_TIMEOUT_MS = 12000/)
  assert.match(filesPage, /withLoaderTimeout\(\s*(?:\/\/[^\n]*\n\s*)*\(\) => filesApi\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name, compressOptions: LIBRARY_IMAGE_COMPRESS_OPTIONS \}\),\s*'Upload file asset',\s*FILES_ASSET_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /withLoaderTimeout\(\s*\(\) => filesApi\.deleteFileAsset\(asset\.id, \{\s*expectedUpdatedAt: asset\.updated_at \|\| undefined,\s*force: locked && deleteUnlockChecked,\s*confirmText: deleteConfirmText\.trim\(\),\s*\}\),\s*'Delete file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /withLoaderTimeout\(\s*\(\) => filesApi\.deleteFileAsset\(asset\.id, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete selected file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /Download className="mr-1\.5 inline h-3\.5 w-3\.5"/)
  assert.doesNotMatch(filesPage, /<Save className=/)

  assert.match(picker, /const FILE_PICKER_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(picker, /const FILE_PICKER_DELETE_TIMEOUT_MS = 12000/)
  assert.match(picker, /deleteFileAsset as deletePickerFileAsset[\s\S]*getFiles as fetchPickerFiles[\s\S]*uploadFileAsset as uploadPickerFileAsset[\s\S]*from '\.\.\/\.\.\/api\/fileTransport\.ts'/)
  assert.match(picker, /withLoaderTimeout<FileAsset>\(\s*\(\) => uploadFileAssetRequest\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload picker file asset',\s*FILE_PICKER_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(picker, /withLoaderTimeout\(\s*\(\) => deleteFileAssetRequest\(assetId, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete picker file asset',\s*FILE_PICKER_DELETE_TIMEOUT_MS,\s*\)/)
  assert.doesNotMatch(picker, /getFilePickerApi|window\.api|api\.(?:getFiles|uploadFileAsset|deleteFileAsset)/)

  assert.match(fileTransport, /export async function uploadFileAsset\(payload: FileUploadPayload = \{\}\): Promise<unknown> \{[\s\S]*requireLiveServerWrite\('files:upload'/)
  assert.match(fileTransport, /return route\([\s\S]*'files:delete'[\s\S]*apiFetch\('DELETE', `\/api\/files\/\$\{encodeURIComponent\(String\(id\)\)\}`/)
})

await runTest('product form image upload and save keep synchronous guards', () => {
  const source = readFrontend('src/components/products/forms/ProductForm.tsx')

  assert.match(source, /const imageUploadInFlightRef = useRef\(false\)/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(imageUploading \|\| imageUploadInFlightRef\.current\) return/)
  assert.match(source, /imageUploadInFlightRef\.current = true/)
  assert.match(source, /finally \{[\s\S]*imageUploadInFlightRef\.current = false[\s\S]*setImageUploading\(false\)/)
  // Guard now also blocks while an image is still uploading (Part 241
  // save-button race fix, ProductForm.tsx) -- accept either the original
  // two-condition guard or that extended form so this assertion doesn't
  // regress if a future session drops the extra condition again.
  assert.match(source, /if \(saving \|\| saveInFlightRef\.current(?: \|\| imageUploading)?\) return/)
  assert.match(source, /saveInFlightRef\.current = true[\s\S]*const payload(?:: ProductSavePayload)? = \{/)
  assert.match(source, /finally \{[\s\S]*saveInFlightRef\.current = false[\s\S]*setSaving\(false\)/)
  assert.match(source, /const PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /withLoaderTimeout\(\s*async \(\) => \(await loadProductImageUploadTransportModule\(\)\)\.uploadProductImage\(\{[\s\S]*productId: currentProductId \|\| undefined,[\s\S]*file,[\s\S]*fileName: file\.name \|\| 'product\.jpg',[\s\S]*\}\)[\s\S]*'Upload product form image',\s*PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/)
})

await runTest('catalog portal media upload keeps a per-target synchronous guard', () => {
  const source = readFrontend('src/components/catalog/CatalogPage.tsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const mediaUploadInFlightTargetsRef = useRef\(new Set<string>\(\)\)/)
  assert.match(source, /const CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /async function uploadPortalMedia\(target: unknown, accept = 'image\/\*'\): Promise<string> \{[\s\S]*if \(!beginKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)\) return ''/)
  assert.match(source, /beginKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)[\s\S]*document\.createElement\('input'\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}[\s\S]*\) => updateMediaUploadState\(targetKey, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload portal media',\s*CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)[\s\S]*mediaUploadControllersRef\.current\.delete\(targetKey\)/)
  assert.match(source, /function cancelPortalMediaUpload\(target: unknown\) \{[\s\S]*controller\?\.abort\?\.\(\)/)
})

await runTest('catalog portal submission writes use guarded bounded actions', () => {
  const source = readFrontend('src/components/catalog/CatalogPage.tsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS = 12000/)
  assert.match(source, /const submissionSavingRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(submissionSavingRef, \{ blocked: submissionSaving \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCatalogApi\(\)\.createPortalSubmission\(\{[\s\S]*membershipNumber: membershipNumberValue,[\s\S]*screenshots: submissionDraft\.screenshots,[\s\S]*\}\),\s*'Create portal submission',\s*CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(submissionSavingRef\)[\s\S]*setSubmissionSaving\(false\)/)
  // Portal-submission *review* (approve/reject) is not on this page -- it
  // moved to LoyaltyPointsPage.tsx (see the next test below) where staff
  // manage loyalty/membership submissions. reviewSavingRef/
  // CATALOG_PORTAL_REVIEW_TIMEOUT_MS never lived here after that move.
  assert.doesNotMatch(source, /reviewSavingRef|CATALOG_PORTAL_REVIEW_TIMEOUT_MS|reviewPortalSubmission/, 'Catalog page should not reintroduce portal-submission review actions that moved to LoyaltyPointsPage')
})

await runTest('loyalty portal submission review uses a guarded bounded action', () => {
  const source = readFrontend('src/components/loyalty-points/LoyaltyPointsPage.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const \[reviewSavingId, setReviewSavingId\] = useState<string \| number \| null>\(null\)/)
  assert.match(source, /const reviewSavingRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(reviewSavingRef, \{ blocked: reviewSavingId != null, value: item\.id \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => submitPortalReview\(item\.id, \{[\s\S]*status,[\s\S]*reward_points: Number\(item\.reward_points \|\| 0\),[\s\S]*\}\),\s*'Review portal submission',\s*LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(reviewSavingRef\)[\s\S]*setReviewSavingId\(null\)/)
})

await runTest('profile saves and avatar upload keep same-tick guards', () => {
  const source = readFrontend('src/components/users/UserProfileModal.tsx')

  assert.match(source, /const saveProfileInFlightRef = useRef\(false\)/)
  assert.match(source, /const savePasswordInFlightRef = useRef\(false\)/)
  assert.match(source, /const avatarUploadInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(savingProfile \|\| saveProfileInFlightRef\.current\) return/)
  assert.match(source, /saveProfileInFlightRef\.current = true[\s\S]*setSavingProfile\(true\)/)
  assert.match(source, /finally \{[\s\S]*saveProfileInFlightRef\.current = false[\s\S]*setSavingProfile\(false\)/)
  assert.match(source, /if \(savingPassword \|\| savePasswordInFlightRef\.current\) return/)
  assert.match(source, /savePasswordInFlightRef\.current = true[\s\S]*setSavingPassword\(true\)/)
  assert.match(source, /finally \{[\s\S]*savePasswordInFlightRef\.current = false[\s\S]*setSavingPassword\(false\)/)
  assert.match(source, /if \(uploadingAvatar \|\| avatarUploadInFlightRef\.current\) return/)
  assert.match(source, /avatarUploadInFlightRef\.current = true[\s\S]*setUploadingAvatar\(true\)/)
  assert.match(source, /finally \{[\s\S]*avatarUploadInFlightRef\.current = false[\s\S]*setUploadingAvatar\(false\)/)
})

await runTest('settings save and app favicon upload keep synchronous guards', () => {
  const source = readFrontend('src/components/utils-settings/Settings.tsx')
  const settingsTransport = readFrontend('src/api/settingsTransport.ts')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const \[savingSettings, setSavingSettings\] = useState\(false\)/)
  assert.match(source, /const settingsSaveInFlightRef = useRef\(false\)/)
  assert.match(source, /const uploadInFlightKeysRef = useRef<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /const SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /if \(!beginKeyedAction\(uploadInFlightKeysRef, key\)\) return/)
  assert.match(source, /beginKeyedAction\(uploadInFlightKeysRef, key\)[\s\S]*document\.createElement\('input'\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getSettingsApi\(\)\.uploadFileAsset\?\.\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateUploadState\(key, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload settings image',\s*SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(uploadInFlightKeysRef, key\)[\s\S]*uploadControllersRef\.current\.delete\(key\)/)
  assert.match(source, /if \(!beginSingleAction\(settingsSaveInFlightRef, \{ blocked: savingSettings \}\)\) return/)
  assert.match(source, /beginSingleAction\(settingsSaveInFlightRef, \{ blocked: savingSettings \}\)[\s\S]*setSavingSettings\(true\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(settingsSaveInFlightRef\)[\s\S]*setSavingSettings\(false\)/)
  assert.match(source, /disabled=\{savingSettings \|\| uploadingImage\}/)
  assert.match(settingsTransport, /let settingsSaveQueue: Promise<unknown> = Promise\.resolve\(\)/)
  assert.match(settingsTransport, /const queuedSave = settingsSaveQueue\.catch\(\(\) => \{\}\)\.then\(\(\) => saveSettingsOnce\(updates, options\)\)/)
})

await runTest('reset data and factory reset use guarded bounded actions', () => {
  const source = readFrontend('src/components/utils-settings/ResetData.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /import \{ withLoaderTimeout \} from '\.\.\/\.\.\/utils\/loaders\.ts'/)
  // Both raised from 60s/90s to a shared 10-minute ceiling (see
  // ResetData.tsx's own comment) so this outer client-side timeout isn't
  // shorter than what systemRuntime.ts's resetData()/factoryReset() calls
  // now allow the underlying request itself (LONG_SYSTEM_ACTION_TIMEOUT_MS).
  assert.match(source, /const RESET_DATA_TIMEOUT_MS = 10 \* 60 \* 1000/)
  assert.match(source, /const FACTORY_RESET_TIMEOUT_MS = 10 \* 60 \* 1000/)
  assert.match(source, /const resetInFlightRef = useRef\(false\)/)
  assert.match(source, /const factoryResetInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(resetInFlightRef, \{ blocked: working \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(factoryResetInFlightRef, \{ blocked: working \}\)\) return/)
  // resetData's call now also passes the mode='products'-only
  // includeMovements/includeSales toggles as a second argument (see this
  // file's own comment on ProductsResetToggles) -- regex widened to
  // `resetData\?\.\(mode[\s\S]*?\)` (anything up to the matching close
  // paren) instead of the old exact `resetData\?\.\(mode\)`, same
  // "regex updated to accept the extended guard condition" precedent as
  // Part 241's ProductForm.tsx save-guard change.
  assert.match(source, /withLoaderTimeout\(\s*\(\) => [\s\S]*resetData\?\.\(mode[\s\S]*?\)[\s\S]*'Reset business data',\s*RESET_DATA_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => [\s\S]*factoryReset\?\.\(\)[\s\S]*'Factory reset',\s*FACTORY_RESET_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(resetInFlightRef\)[\s\S]*setWorking\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(factoryResetInFlightRef\)[\s\S]*setWorking\(false\)/)
})

await runTest('server queue and connection actions use guarded bounded actions', () => {
  const source = readFrontend('src/components/server/ServerPage.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS = 12000/)
  assert.match(source, /const SERVER_SYNC_TEST_TIMEOUT_MS = 12000/)
  assert.match(source, /const queueActionInFlightRef = useRef\(false\)/)
  assert.match(source, /const testSyncInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(queueActionInFlightRef, \{ blocked: retryingQueue \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.retryPendingSyncNow\?\.\(\),\s*'Retry pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.discardPendingSyncQueue\?\.\(\),\s*'Discard pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(queueActionInFlightRef\)[\s\S]*setRetryingQueue\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(testSyncInFlightRef, \{ blocked: testing \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getServerApi\(\))\.testSyncServer\(url\),\s*'Test sync server',\s*SERVER_SYNC_TEST_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(testSyncInFlightRef\)[\s\S]*setTesting\(false\)/)
})

await runTest('audit log retention cleanup is automatic, not a guarded manual action', () => {
  // The manual "Clear 30d" button (and its guarded bounded action) was
  // removed from this route during the UI/UX cleanup pass in favor of an
  // automatic server-side sweep -- see AuditLog.tsx's code comment near the
  // Settings retention field, and cloudflare/src/lib/audit.ts's
  // maybeRunScheduledAuditLogRetention(), invoked from the Worker's
  // scheduled() handler on the cron in wrangler.toml. This route no longer
  // needs its own single-action guard, timeout constant, or in-flight ref
  // for that action, so the assertions this replaced (which required all of
  // that machinery) no longer apply.
  const source = readFrontend('src/components/utils-settings/AuditLog.tsx')

  assert.doesNotMatch(source, /deleteAuditLogsRetention/, 'Audit Log route should not reintroduce the removed manual retention-clear action')
  assert.doesNotMatch(source, /AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS|clearingOldLogs|clearOldLogsInFlightRef/, 'Audit Log route should not retain dead state/refs for the removed manual retention-clear action')
})

await runTest('secondary import modals use the shared single-action guard', () => {
  const sources = [
    ['contact', readFrontend('src/components/contacts/ContactImportModal.tsx')],
    ['inventory', readFrontend('src/components/inventory/InventoryImportModal.tsx')],
    ['sales', readFrontend('src/components/sales/SalesImportModal.tsx')],
  ]

  for (const [label, source] of sources) {
    assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
    assert.match(source, /const .*inFlightRef = useRef\(false\)|const importInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(!beginSingleAction\((?:inFlightRef|importInFlightRef)\)\) return/)
    assert.match(source, /finally \{[\s\S]*finishSingleAction\((?:inFlightRef|importInFlightRef)\)/)
    assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.createImportJob\(/, `${label} import job creation should be bounded`)
    assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.uploadImportJobCsv\(/, `${label} import CSV upload should be bounded`)
    assert.match(source, /withLoaderTimeout\(\s*\(\) => (?:window\.api|getImportApi\(\)|api)\.startImportJob\((?:job\.id|jobId)/, `${label} import job start should be bounded`)
  }
})

await runTest('OTP confirm and disable use the shared single-action guard', () => {
  const source = readFrontend('src/components/utils-settings/OtpModal.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const actionInFlightRef = useRef\(false\)/)
  assert.match(source, /const handleConfirm = useCallback\(async \(\) => \{[\s\S]*if \(!beginSingleAction\(actionInFlightRef\)\) return/)
  assert.match(source, /const handleDisable = useCallback\(async \(\) => \{[\s\S]*if \(!beginSingleAction\(actionInFlightRef\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(actionInFlightRef\)[\s\S]*setLoading\(false\)/)
  assert.match(source, /const handleClose = useCallback\(\(\) => \{[\s\S]*if \(actionInFlightRef\.current\) return/)
})

await runTest('loyalty point rule save uses the shared single-action guard', () => {
  const source = readFrontend('src/components/loyalty-points/LoyaltyPointsPage.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /async function handleSave\(\) \{[\s\S]*if \(!beginSingleAction\(saveInFlightRef\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)[\s\S]*setSaving\(false\)/)
})

await runTest('contact tabs use same-tick guards and bounded mutations', () => {
  const targets = [
    {
      label: 'customers',
      source: readFrontend('src/components/contacts/CustomersTab.tsx'),
      constant: 'CUSTOMER_MUTATION_TIMEOUT_MS',
      create: 'createCustomer',
      update: 'updateCustomer',
      remove: 'deleteCustomer',
    },
    {
      label: 'suppliers',
      source: readFrontend('src/components/contacts/SuppliersTab.tsx'),
      constant: 'SUPPLIER_MUTATION_TIMEOUT_MS',
      create: 'createSupplier',
      update: 'updateSupplier',
      remove: 'deleteSupplier',
    },
    {
      label: 'delivery contacts',
      source: readFrontend('src/components/contacts/DeliveryTab.tsx'),
      constant: 'DELIVERY_CONTACT_MUTATION_TIMEOUT_MS',
      create: 'createDeliveryContact',
      update: 'updateDeliveryContact',
      remove: 'deleteDeliveryContact',
    },
  ]

  for (const target of targets) {
    assert.match(target.source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/, `${target.label} should import shared action guards`)
    assert.match(target.source, new RegExp(`const ${target.constant} = 12000`), `${target.label} should define a mutation timeout`)
    assert.match(target.source, /const saveInFlightRef = useRef\(false\)/, `${target.label} should guard save`)
    assert.match(target.source, /const deleteInFlightRef = useRef\(false\)/, `${target.label} should guard delete`)
    assert.match(target.source, /const bulkDeleteInFlightRef = useRef\(false\)/, `${target.label} should guard bulk delete`)
    assert.match(target.source, /if \(!beginSingleAction\(saveInFlightRef\)\) return/, `${target.label} save should block same-tick repeats`)
    assert.match(target.source, /if \(!beginSingleAction\(deleteInFlightRef\)\) return/, `${target.label} delete should block same-tick repeats`)
    assert.match(target.source, /beginSingleAction\(bulkDeleteInFlightRef, \{ blocked: bulkActionBusy \}\)/, `${target.label} bulk delete should block same-tick repeats`)
    assert.match(target.source, new RegExp(`withLoaderTimeout\\(loader, label, ${target.constant}\\)`), `${target.label} should route mutations through the timeout helper`)
    const apiPattern = target.label === 'customers'
      ? 'getCustomerApi\\(\\)'
      : target.label === 'delivery contacts'
        ? 'getDeliveryApi\\(\\)'
        : target.label === 'suppliers'
          ? 'getSupplierApi\\(\\)'
        : 'window\\.api'
    assert.match(target.source, new RegExp(`${apiPattern}\\.${target.create}\\(`), `${target.label} should still create through the app API`)
    assert.match(target.source, new RegExp(`${apiPattern}\\.${target.update}\\(`), `${target.label} should still update through the app API`)
    assert.match(target.source, new RegExp(`${apiPattern}\\.${target.remove}\\(`), `${target.label} should still delete through the app API`)
    assert.match(target.source, /finally \{[\s\S]*finishSingleAction\(bulkDeleteInFlightRef\)[\s\S]*setBulkActionBusy\(false\)/, `${target.label} bulk guard should clear`)
  }
})

await runTest('sales status and membership actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/sales/Sales.tsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const SALES_STATUS_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const statusActionRef = useRef<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /const membershipActionRef = useRef<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /const bulkStatusInFlightRef = useRef\(false\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getSalesApi\(\)\.updateSaleStatus\(saleId, nextStatus, notes, extra \|\| undefined\),\s*'Update sale status',\s*SALES_STATUS_MUTATION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getSalesApi\(\)\.attachSaleCustomer\(saleId, payload\),\s*'Attach sale membership',\s*SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /if \(!beginKeyedAction\(statusActionRef, actionKey\)\) return false/)
  assert.match(source, /finishKeyedAction\(statusActionRef, actionKey\)[\s\S]*return false/)
  assert.match(source, /await runSaleStatusMutation\(saleId, newStatus, notes, extra\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(statusActionRef, actionKey\)/)
  assert.match(source, /if \(!beginKeyedAction\(membershipActionRef, actionKey\)\) return false/)
  assert.match(source, /await runSaleMembershipMutation\(saleId, \{/)
  assert.match(source, /await runSaleMembershipMutation\(saleId, payload\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(membershipActionRef, actionKey\)/)
  assert.match(source, /runConcurrentTasks<SaleStatusEntry, number>\(entries, async \(entry: SaleStatusEntry\) => \{[\s\S]*await runSaleStatusMutation\(saleId, nextStatus, notes, nextStatus === 'cancelled' \? extra : null\)/)
  assert.match(source, /if \(!selectedSales\.length \|\| !beginSingleAction\(bulkStatusInFlightRef, \{ blocked: !!bulkStatusSaving \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkStatusInFlightRef\)[\s\S]*setBulkStatusSaving\(''\)/)
})

await runTest('branch CRUD and transfer actions use shared guards and bounded mutations', () => {
  const branches = readFrontend('src/components/branches/Branches.tsx')
  const transfer = readFrontend('src/components/branches/TransferModal.tsx')

  assert.match(branches, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(branches, /const BRANCH_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(branches, /const \[bulkDeleteBusy, setBulkDeleteBusy\] = useState\(false\)/)
  assert.match(branches, /const saveInFlightRef = useRef\(false\)/)
  assert.match(branches, /const deleteInFlightRef = useRef\(false\)/)
  assert.match(branches, /const bulkDeleteInFlightRef = useRef\(false\)/)
  assert.match(branches, /withLoaderTimeout\(loader, label, BRANCH_MUTATION_TIMEOUT_MS\)/)
  assert.match(branches, /if \(!beginSingleAction\(saveInFlightRef\)\) return/)
  assert.match(branches, /await runBranchMutation\(\(\) => branchApi\.updateBranch\(selected\.id, payload\), 'Update branch'\)/)
  assert.match(branches, /await runBranchMutation\(\(\) => branchApi\.createBranch\(payload\), 'Create branch'\)/)
  assert.match(branches, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)/)
  assert.match(branches, /if \(!beginSingleAction\(deleteInFlightRef\)\) return/)
  assert.match(branches, /await runBranchMutation\(\s*\(\) => branchApi\.deleteBranch\(branch\.id, user\?\.id, user\?\.name\),\s*'Delete branch',\s*\)/)
  assert.match(branches, /finally \{[\s\S]*finishSingleAction\(deleteInFlightRef\)/)
  assert.match(branches, /if \(!beginSingleAction\(bulkDeleteInFlightRef, \{ blocked: bulkDeleteBusy \}\)\) return/)
  assert.match(branches, /await runBranchMutation\(\s*\(\) => branchApi\.deleteBranch\(branch\.id, user\?\.id, user\?\.name\),\s*'Bulk delete branches',\s*\)/)
  assert.match(branches, /finally \{[\s\S]*finishSingleAction\(bulkDeleteInFlightRef\)[\s\S]*setBulkDeleteBusy\(false\)/)
  assert.match(branches, /disabled=\{bulkDeleteBusy\}/)

  assert.match(transfer, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(transfer, /const TRANSFER_STOCK_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(transfer, /const transferInFlightRef = useRef\(false\)/)
  assert.match(transfer, /if \(!beginSingleAction\(transferInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(transfer, /function getTransferApi\(\): TransferApi/)
  assert.match(transfer, /withLoaderTimeout<TransferResult>\(\(\) => getTransferApi\(\)\.transferStock\(\{[\s\S]*'Transfer branch stock', TRANSFER_STOCK_MUTATION_TIMEOUT_MS\)/)
  assert.match(transfer, /finally \{[\s\S]*finishSingleAction\(transferInFlightRef\)[\s\S]*setSaving\(false\)/)
})

await runTest('inventory adjust, transfer, and batch actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/inventory/Inventory.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getInventoryApi\(\)\.(adjustStock|moveStockRow|transferInventoryStock)\(/.test(line))

  // Note: the standalone single-product "Move Stock" modal (moveModal/
  // moveForm/moveSaving/moveStockInFlightRef/openMove/handleMoveStock) was
  // removed -- Add Stock's unlock-pricing path (resolveAddStockTarget on
  // the backend) now covers what it used to require a second manual step
  // for. moveStockRow itself is still real and still guarded: it's called
  // from the batch-apply path for per-line "move" actions within a batch
  // session (see the batch assertion below), not from a standalone modal.
  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const INVENTORY_STOCK_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const adjustStockInFlightRef = useRef\(false\)/)
  assert.match(source, /const transferStockInFlightRef = useRef\(false\)/)
  assert.match(source, /const batchInventoryInFlightRef = useRef\(false\)/)
  assert.doesNotMatch(source, /moveStockInFlightRef|moveSaving|moveModal|moveForm|openMove\(|handleMoveStock/, 'standalone Move Stock modal should stay removed')
  assert.match(source, /const runInventoryMutation = useCallback\(\(loader: InventoryLoader, label: string\): Promise<any> => \([\s\S]*withLoaderTimeout\(loader, label, INVENTORY_STOCK_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(adjustStockInFlightRef, \{ blocked: adjustSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(transferStockInFlightRef, \{ blocked: transferSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(batchInventoryInFlightRef, \{ blocked: batchApplying \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(adjustStockInFlightRef\)[\s\S]*setAdjustSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(transferStockInFlightRef\)[\s\S]*setTransferSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(batchInventoryInFlightRef\)[\s\S]*setBatchApplying\(false\)/)
  assert.ok(mutationLines.length >= 3, 'inventory should still call adjust/move/transfer stock mutation APIs (move now only from the batch path)')
  assert.ok(
    mutationLines.every((line) => line.includes('runInventoryMutation')),
    `unbounded inventory mutation lines:\n${mutationLines.filter((line) => !line.includes('runInventoryMutation')).join('\n')}`,
  )
})

await runTest('product category manager actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/products/lookups/ManageCategoriesModal.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getCategoryApi\(\)\.(createCategory|updateCategory|deleteCategory)\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const PRODUCT_CATEGORY_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /const deleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const bulkDeleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const runCategoryMutation = useCallback\(\(loader: \(\) => Promise<CategoryMutationResult \| undefined>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_CATEGORY_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(saveInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(deleteInFlightRef, \{ blocked: deletingId != null \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(bulkDeleteInFlightRef, \{ blocked: deletingId != null \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)[\s\S]*setSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(deleteInFlightRef\)[\s\S]*setDeletingId\(null\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkDeleteInFlightRef\)[\s\S]*setDeletingId\(null\)/)
  assert.match(source, /disabled=\{!selectedIds\.size \|\| saving \|\| deletingId != null\}/)
  assert.ok(mutationLines.length >= 10, 'category manager should cover add/update/delete and undo/redo mutation paths')
  assert.ok(
    mutationLines.every((line) => line.includes('runCategoryMutation')),
    `unbounded category mutation lines:\n${mutationLines.filter((line) => !line.includes('runCategoryMutation')).join('\n')}`,
  )
})

await runTest('product unit manager actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/products/lookups/ManageUnitsModal.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getUnitApi\(\)\.(createUnit|updateUnit|deleteUnit)\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const PRODUCT_UNIT_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /const deleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const bulkDeleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const runUnitMutation = useCallback\(\(loader: \(\) => Promise<UnitMutationResult \| undefined>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_UNIT_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(saveInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(deleteInFlightRef, \{ blocked: deletingId != null \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(bulkDeleteInFlightRef, \{ blocked: deletingId != null \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)[\s\S]*setSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(deleteInFlightRef\)[\s\S]*setDeletingId\(null\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkDeleteInFlightRef\)[\s\S]*setDeletingId\(null\)/)
  assert.match(source, /disabled=\{!selectedIds\.size \|\| saving \|\| deletingId != null\}/)
  assert.ok(mutationLines.length >= 10, 'unit manager should cover add/update/delete and undo/redo mutation paths')
  assert.ok(
    mutationLines.every((line) => line.includes('runUnitMutation')),
    `unbounded unit mutation lines:\n${mutationLines.filter((line) => !line.includes('runUnitMutation')).join('\n')}`,
  )
})

await runTest('product brand manager actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/products/lookups/ManageBrandsModal.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getBrandApi\(\)\.(saveSettings|replaceProductLookupValues)\(/.test(line))

  assert.match(source, /import \{ beginNamedAction, finishNamedAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const PRODUCT_BRAND_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const actionInFlightRef = useRef\(''\)/)
  assert.match(source, /const runBrandMutation = useCallback\(<T,>\(loader: \(\) => T \| Promise<T>, label: string\): Promise<T> => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_BRAND_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginNamedAction\(actionInFlightRef, 'add-brand', \{ blocked: busy \}\)\) return/)
  assert.match(source, /if \(!beginNamedAction\(actionInFlightRef, 'rename-brand', \{ blocked: busy \}\)\) return/)
  assert.match(source, /if \(!beginNamedAction\(actionInFlightRef, 'delete-brand', \{ blocked: busy \}\)\) return/)
  assert.match(source, /finishNamedAction\(actionInFlightRef, 'add-brand'\)[\s\S]*setBusy\(false\)/)
  assert.match(source, /finishNamedAction\(actionInFlightRef, 'rename-brand'\)[\s\S]*setBusy\(false\)/)
  assert.match(source, /finishNamedAction\(actionInFlightRef, 'delete-brand'\)[\s\S]*setBusy\(false\)/)
  assert.match(source, /disabled=\{!selectedBrands\.size \|\| busy\}/)
  assert.ok(mutationLines.length >= 9, 'brand manager should cover settings writes, product rewires, and undo/redo mutation paths')
  assert.ok(
    mutationLines.every((line) => line.includes('runBrandMutation')),
    `unbounded brand mutation lines:\n${mutationLines.filter((line) => !line.includes('runBrandMutation')).join('\n')}`,
  )
})

await runTest('product variant creation uses shared guard and bounded mutation', () => {
  const source = readFrontend('src/components/products/forms/VariantFormModal.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getProductVariantApi\(\)\.createProductVariant\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /import \{ withLoaderTimeout \} from '\.\.\/\.\.\/\.\.\/utils\/loaders\.ts'/)
  assert.match(source, /const PRODUCT_VARIANT_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /const runVariantMutation = useCallback\(\(loader: \(\) => Promise<VariantMutationResponse \| undefined>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_VARIANT_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(saveInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(source, /finishSingleAction\(saveInFlightRef\)[\s\S]*return[\s\S]*setSaving\(true\)/, 'blank-name validation should release the guard before returning')
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)[\s\S]*setSaving\(false\)/)
  assert.ok(mutationLines.length === 1, 'variant modal should have one variant create mutation path')
  assert.ok(
    mutationLines.every((line) => line.includes('runVariantMutation')),
    `unbounded variant mutation lines:\n${mutationLines.filter((line) => !line.includes('runVariantMutation')).join('\n')}`,
  )
})

await runTest('product page save and delete actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/products/Products.tsx')
  const config = readFrontend('src/components/products/config/productPageConfig.ts')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(config, /export const PRODUCT_WRITE_MUTATION_TIMEOUT_MS = 15000/)
  assert.match(config, /export const PRODUCT_DELETE_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(config, /export const PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(config, /export const PRODUCT_STOCK_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const productSaveInFlightRef = useRef\(false\)/)
  assert.match(source, /const productDeleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const bulkActionInFlightRef = useRef\(false\)/)
  assert.match(source, /const runProductWriteMutation = useCallback\([\s\S]*withLoaderTimeout\(loader, label, timeoutMs\)/)
  assert.match(source, /const runProductDeleteMutation = useCallback\([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_DELETE_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /const runProductStockMutation = useCallback\([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_STOCK_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(productSaveInFlightRef\)\) return[\s\S]*runProductWriteMutation\(\(\) => productApi\.createProduct\(payload\), 'Create product'\)/)
  assert.match(source, /runProductWriteMutation\(\(\) => productApi\.updateProduct\(selected\.id \|\| 0, payload\), 'Update product'\)/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => productApi\.uploadProductImage\(\{ productId, filePath: entry, fileName \}\),[\s\S]*PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS/)
  assert.match(source, /const payload = await buildProductWritePayload\(snapshot\)[\s\S]*runProductWriteMutation\(\(\) => productApi\.updateProduct\(productId, payload\), 'Restore product'\)/)
  assert.match(source, /runProductWriteMutation\(\(\) => productApi\.createProduct\(createPayload\), 'Restore deleted product'\)/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => productApi\.updateProduct\([\s\S]*'Bulk update product'/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => productApi\.updateProduct\([\s\S]*'Redo product bulk update'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => productApi\.adjustStock\([\s\S]*'Restore product branch stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => productApi\.adjustStock\([\s\S]*'Clear product stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => productApi\.adjustStock\([\s\S]*'Bulk add product stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => productApi\.transferStock\([\s\S]*'Move product branch stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => productApi\.adjustStock\([\s\S]*'Initialize product branch stock'/)
  assert.doesNotMatch(source, /await\s+(?:window\.api|productApi)\.(adjustStock|transferStock|createProduct|updateProduct|deleteProduct)\(/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(productSaveInFlightRef\)/)
  // Delete now goes through DeleteConfirmModal (progress.md part 202: "show
  // what will be affected and require explicit confirmation") instead of a
  // bare window.confirm() -- handleDelete/handleBulkDelete only claim the
  // guard and open the modal; the actual mutation + guard release moved to
  // runSingleDeleteConfirmed/runBulkDeleteConfirmed, called from the
  // modal's confirm button via runPendingDeleteConfirmed.
  assert.match(source, /const handleDelete = \(p: ProductRecord\) => \{[\s\S]*if \(!beginSingleAction\(productDeleteInFlightRef\)\) return/)
  assert.match(source, /const runSingleDeleteConfirmed = async \(p: ProductRecord, reason: string\) => \{[\s\S]*runProductDeleteMutation\(\(\) => productApi\.deleteProduct\(p\.id \|\| 0, reason\), 'Delete product'\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(productDeleteInFlightRef\)[\s\S]*setDeleteConfirmBusy\(false\)[\s\S]*setPendingDelete\(null\)[\s\S]*\}/)
  assert.match(source, /const handleBulkDelete = \(\) => \{[\s\S]*if \(!selectedVisibleIds\.length \|\| bulkActionBusy\) return/)
  assert.match(source, /const runBulkDeleteConfirmed = async \(ids: EntityId\[\], reason: string\) => \{[\s\S]*if \(!beginSingleAction\(bulkActionInFlightRef, \{ blocked: bulkActionBusy \}\)\) return[\s\S]*runProductDeleteMutation\(\(\) => productApi\.deleteProduct\(id, reason\), 'Delete product'\)/)
  // Delete now requires a reason (progress.md's product-delete-reason
  // item): runPendingDeleteConfirmed forwards DeleteConfirmModal's own
  // required-reason field straight into both delete runners above.
  assert.match(source, /const runPendingDeleteConfirmed = async \(reason: string\) => \{/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkActionInFlightRef\)[\s\S]*setBulkActionBusy\(false\)[\s\S]*setDeleteConfirmBusy\(false\)[\s\S]*setPendingDelete\(null\)/)
  assert.match(source, /<DeleteConfirmModal[\s\S]*onConfirm=\{runPendingDeleteConfirmed\}[\s\S]*summary=\{summarizeDeleteImpact\(snapshotProductsByIds\(pendingDelete\.ids\)\)\}/)
})

await runTest('product stock helper modals use shared guards and bounded mutations', () => {
  const bulk = readFrontend('src/components/products/forms/BulkAddStockModal.tsx')
  const branch = readFrontend('src/components/products/forms/BranchStockAdjuster.tsx')

  for (const [label, source, constant, runner] of [
    ['bulk stock add', bulk, 'BULK_ADD_STOCK_MUTATION_TIMEOUT_MS', 'runBulkStockMutation'],
    ['branch stock adjuster', branch, 'BRANCH_STOCK_ADJUSTMENT_TIMEOUT_MS', 'runBranchStockMutation'],
  ]) {
    assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/\.\.\/utils\/actionGuards\.ts'/, `${label} should import shared action guards`)
    assert.match(source, /import \{ withLoaderTimeout \} from '\.\.\/\.\.\/\.\.\/utils\/loaders\.ts'/, `${label} should import loader timeout helper`)
    assert.match(source, new RegExp(`const ${constant} = 12000`), `${label} should define a stock mutation timeout`)
    assert.match(source, /const saveInFlightRef = useRef\(false\)/, `${label} should keep a same-tick save guard`)
    assert.match(source, new RegExp(`const ${runner} = useCallback\\(\\(loader[^,]*, label[^)]*\\) => \\([\\s\\S]*withLoaderTimeout\\(loader, label, ${constant}\\)`), `${label} should route mutations through a timeout helper`)
    assert.match(source, /if \(!beginSingleAction\(saveInFlightRef, \{ blocked: saving \}\)\) return/, `${label} should block repeat saves`)
    assert.match(source, new RegExp(`const result = await ${runner}\\(\\(\\) => getProductApi\\(\\)\\.adjustStock\\(`), `${label} adjustStock should be bounded`)
    assert.match(source, /result\?\.success === false/, `${label} should treat explicit API failures as failures`)
    assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)[\s\S]*setSaving\(false\)/, `${label} should release the guard in finally`)
  }
})

await runTest('files AI provider actions use shared guards and bounded mutations', () => {
  const page = readFrontend('src/components/files/FilesPage.tsx')
  const tab = readFrontend('src/components/files/FilesProvidersTab.tsx')
  const mutationLines = page
    .split('\n')
    .filter((line) => /filesApi\.(createAiProvider|updateAiProvider|deleteAiProvider|testAiProvider)\(/.test(line))

  assert.match(page, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(page, /const AI_PROVIDER_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(page, /const AI_PROVIDER_TEST_TIMEOUT_MS = 30000/)
  assert.match(page, /const saveProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const testProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const deleteProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const \[deletingProviderId, setDeletingProviderId\] = useState<string \| number \| null>\(null\)/)
  assert.match(page, /const runProviderMutation = useCallback\(\(loader: \(\) => Promise<ProviderMutationResult>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, AI_PROVIDER_MUTATION_TIMEOUT_MS\)/)
  assert.match(page, /const runProviderTest = useCallback\(\(loader: \(\) => Promise<ProviderTestResult>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, AI_PROVIDER_TEST_TIMEOUT_MS\)/)
  assert.match(page, /if \(!beginSingleAction\(saveProviderInFlightRef, \{ blocked: savingProvider \}\)\) return/)
  assert.match(page, /if \(!beginSingleAction\(testProviderInFlightRef, \{ blocked: testingProviderId != null \}\)\) return/)
  assert.match(page, /if \(!beginSingleAction\(deleteProviderInFlightRef, \{ blocked: deletingProviderId != null \}\)\) return/)
  assert.match(page, /finally \{[\s\S]*finishSingleAction\(saveProviderInFlightRef\)[\s\S]*setSavingProvider\(false\)/)
  assert.match(page, /finally \{[\s\S]*finishSingleAction\(testProviderInFlightRef\)[\s\S]*setTestingProviderId\(null\)/)
  assert.match(page, /finally \{[\s\S]*finishSingleAction\(deleteProviderInFlightRef\)[\s\S]*setDeletingProviderId\(null\)/)
  assert.match(tab, /disabled=\{testingProviderId != null\}/)
  assert.match(tab, /disabled=\{deletingProviderId != null\}/)
  assert.match(tab, /deletingProviderId === provider\.id \? 'Deleting\.\.\.' : 'Delete'/)
  assert.ok(mutationLines.length >= 8, 'files provider paths should include normal, test, delete, and undo/redo mutations')
  assert.ok(
    mutationLines.every((line) => line.includes('runProviderMutation') || line.includes('runProviderTest')),
    `unbounded provider mutation lines:\n${mutationLines.filter((line) => !line.includes('runProviderMutation') && !line.includes('runProviderTest')).join('\n')}`,
  )
})

await runTest('users and roles security mutations use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/users/Users.tsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /getUsersApi\(\)\.(createUser|updateUser|changeUserPassword|createRole|updateRole|deleteRole)\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const USER_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const ROLE_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const saveUserInFlightRef = useRef\(false\)/)
  assert.match(source, /const passwordInFlightRef = useRef\(false\)/)
  assert.match(source, /const saveRoleInFlightRef = useRef\(false\)/)
  assert.match(source, /const deleteRoleInFlightRef = useRef\(false\)/)
  assert.match(source, /const runUserMutation = useCallback\(\(loader: \(\) => Promise<MutationResult>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, USER_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /const runRoleMutation = useCallback\(\(loader: \(\) => Promise<MutationResult>, label: string\) => \([\s\S]*withLoaderTimeout\(loader, label, ROLE_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(saveUserInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(passwordInFlightRef, \{ blocked: passwordSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(saveRoleInFlightRef, \{ blocked: saving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(deleteRoleInFlightRef, \{ blocked: deletingRoleId != null, value: role\.id \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveUserInFlightRef\)[\s\S]*setSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(passwordInFlightRef\)[\s\S]*setPasswordSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveRoleInFlightRef\)[\s\S]*setSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(deleteRoleInFlightRef\)[\s\S]*setDeletingRoleId\(null\)/)
  assert.match(source, /disabled=\{passwordSaving\}/)
  assert.match(source, /disabled=\{deletingRoleId === role\.id\}/)
  assert.ok(mutationLines.length >= 12, 'users page should still cover user/role normal and undo/redo mutation paths')
  assert.ok(
    mutationLines.every((line) => line.includes('runUserMutation') || line.includes('runRoleMutation')),
    `unbounded users/roles mutation lines:\n${mutationLines.filter((line) => !line.includes('runUserMutation') && !line.includes('runRoleMutation')).join('\n')}`,
  )
})

if (failed > 0) {
  process.exitCode = 1
}
