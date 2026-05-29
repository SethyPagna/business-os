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
  const pos = readFrontend('src/components/pos/POS.jsx')
  const methods = readFrontend('src/api/methods.js')
  const salesRoute = readRepo('backend/src/routes/sales.js')

  assert.match(pos, /if \(loading \|\| checkoutInFlightRef\.current\) return/)
  assert.match(pos, /checkoutInFlightRef\.current = true[\s\S]*setLoading\(true\)/)
  assert.match(pos, /const POS_CHECKOUT_TIMEOUT_MS = 20000/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => window\.api\.createSale\(saleData\),\s*'Create POS sale',\s*POS_CHECKOUT_TIMEOUT_MS,\s*\)/)
  assert.match(pos, /finally \{[\s\S]*checkoutInFlightRef\.current = false[\s\S]*setLoading\(false\)/)

  assert.match(methods, /export async function createSale\(d\) \{[\s\S]*ensureClientRequestId\(\{ \.\.\.getDeviceInfo\(\), \.\.\.d \}, 'sale'\)/)
  assert.match(methods, /route\('sales:create', \(\) => apiFetch\('POST', '\/api\/sales', payload\), null, true\)/)
  assert.match(methods, /return queueOfflineSale\(payload, error\?\.reason \|\| 'server_offline'\)/)

  assert.match(salesRoute, /function findSaleByClientRequestId\(clientRequestId\)/)
  assert.match(salesRoute, /const existingSale = findSaleByClientRequestId\(clientRequestId\)[\s\S]*if \(existingSale\)/)
  assert.match(salesRoute, /INSERT INTO sales \([\s\S]*receipt_number, client_request_id/)
  assert.match(salesRoute, /const duplicateSale = findSaleByClientRequestId\(clientRequestId\)/)
})

await runTest('POS quick-add customer and delivery writes are bounded', () => {
  const pos = readFrontend('src/components/pos/POS.jsx')

  assert.match(pos, /const POS_CUSTOMER_CREATE_TIMEOUT_MS = 12000/)
  assert.match(pos, /const POS_DELIVERY_CREATE_TIMEOUT_MS = 12000/)
  assert.match(pos, /if \(savingCustomerRef\.current\) return/)
  assert.match(pos, /savingCustomerRef\.current = true[\s\S]*setSavingCustomer\(true\)/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => window\.api\.createCustomer\(newCustomerForm\),\s*'Create POS customer',\s*POS_CUSTOMER_CREATE_TIMEOUT_MS,\s*\)/)
  assert.match(pos, /finally \{[\s\S]*savingCustomerRef\.current = false[\s\S]*setSavingCustomer\(false\)/)
  assert.match(pos, /if \(savingDeliveryRef\.current\) return/)
  assert.match(pos, /savingDeliveryRef\.current = true[\s\S]*setSavingDelivery\(true\)/)
  assert.match(pos, /withLoaderTimeout\(\s*\(\) => window\.api\.createDeliveryContact\(payload\),\s*'Create POS delivery contact',\s*POS_DELIVERY_CREATE_TIMEOUT_MS,\s*\)/)
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

await runTest('backup export and restore keep local busy state plus backend job dedupe', () => {
  const backup = readFrontend('src/components/utils-settings/Backup.jsx')
  const systemRoute = readRepo('backend/src/routes/system/index.js')
  const systemJobs = readRepo('backend/src/systemJobs.js')

  assert.match(backup, /data-testid="backup-export-create"[\s\S]*disabled=\{!!loading \|\| activeBackupJobRunning\}/)
  assert.match(backup, /data-testid="backup-restore-start"[\s\S]*disabled=\{!!loading \|\| activeBackupJobRunning\}/)
  assert.match(systemJobs, /function findActiveJob\(dedupeKey\)/)
  assert.match(systemJobs, /const activeJob = findActiveJob\(dedupeKey\)/)
  assert.match(systemRoute, /dedupeKey: `backup_export_folder:\$\{path\.resolve\(destinationDir\)\}`/)
  assert.match(systemRoute, /dedupeKey: `backup_restore_folder:\$\{path\.resolve\(sourceDir\)\}`/)
})

await runTest('return create, edit, and supplier flows keep synchronous submit guards', () => {
  const returns = readFrontend('src/components/returns/Returns.jsx')
  const newReturn = readFrontend('src/components/returns/NewReturnModal.tsx')
  const editReturn = readFrontend('src/components/returns/EditReturnModal.tsx')
  const supplierReturn = readFrontend('src/components/returns/NewSupplierReturnModal.tsx')
  const methods = readFrontend('src/api/methods.js')
  const returnsRoute = readRepo('backend/src/routes/returns.js')

  for (const source of [newReturn, editReturn, supplierReturn]) {
    assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
    assert.match(source, /const submitInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(!beginSingleAction\(submitInFlightRef\)\) return/)
    assert.match(source, /beginSingleAction\(submitInFlightRef\)[\s\S]*setSubmitting\(true\)/)
    assert.match(source, /finally \{[\s\S]*finishSingleAction\(submitInFlightRef\)[\s\S]*setSubmitting\(false\)/)
  }

  assert.match(newReturn, /const RETURN_CREATE_TIMEOUT_MS = 15000/)
  assert.match(newReturn, /const api = getReturnApi\(\)[\s\S]*withLoaderTimeout\(\s*\(\) => api\.createReturn\(\{[\s\S]*\}\),\s*'Create return',\s*RETURN_CREATE_TIMEOUT_MS,\s*\)/)
  assert.match(editReturn, /const RETURN_UPDATE_TIMEOUT_MS = 15000/)
  assert.match(editReturn, /const api = getReturnApi\(\)[\s\S]*const payload: ReturnUpdatePayload = \{[\s\S]*withLoaderTimeout\(\s*\(\) => api\.updateReturn\(ret\.id, payload\),\s*'Update return',\s*RETURN_UPDATE_TIMEOUT_MS,\s*\)/)
  assert.match(supplierReturn, /const SUPPLIER_RETURN_CREATE_TIMEOUT_MS = 15000/)
  assert.match(supplierReturn, /const api = getSupplierReturnApi\(\)[\s\S]*api\.createSupplierReturn\(\{[\s\S]*\}\)[\s\S]*'Create supplier return',\s*SUPPLIER_RETURN_CREATE_TIMEOUT_MS,\s*\)/)

  assert.match(newReturn, /const searchInFlightRef = useRef\(false\)/)
  assert.match(newReturn, /if \(!beginSingleAction\(searchInFlightRef\)\) return/)
  assert.match(newReturn, /finally \{[\s\S]*finishSingleAction\(searchInFlightRef\)[\s\S]*setSearching\(false\)/)
  assert.match(returns, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(returns, /const RETURNS_HISTORY_RESTORE_TIMEOUT_MS = 15000/)
  assert.match(returns, /const historyRestoreInFlightRef = useRef\(false\)/)
  assert.match(returns, /if \(!beginSingleAction\(historyRestoreInFlightRef\)\) return/)
  assert.match(returns, /withLoaderTimeout\(\s*\(\) => window\.api\.updateReturn\(snapshot\.id, \{[\s\S]*\}\),\s*'Restore return snapshot',\s*RETURNS_HISTORY_RESTORE_TIMEOUT_MS,\s*\)/)
  assert.match(returns, /finally \{[\s\S]*finishSingleAction\(historyRestoreInFlightRef\)/)

  assert.match(methods, /export async function createReturn\(d\) \{[\s\S]*ensureClientRequestId\(\{ \.\.\.getDeviceInfo\(\), \.\.\.d \}, 'return'\)/)
  assert.match(methods, /export async function createSupplierReturn\(d\) \{[\s\S]*ensureClientRequestId\(\{ \.\.\.getDeviceInfo\(\), \.\.\.d \}, 'supplier_return'\)/)
  assert.match(returnsRoute, /function findReturnByClientRequestId\(clientRequestId\)/)
  assert.match(returnsRoute, /const existingReturn = findReturnByClientRequestId\(clientRequestId\)[\s\S]*duplicate: true/)
  assert.match(returnsRoute, /const duplicateReturn = findReturnByClientRequestId\(clientRequestId\)[\s\S]*duplicate: true/)
})

await runTest('file picker and library upload/delete flows keep synchronous action guards', () => {
  const picker = readFrontend('src/components/files/FilePickerModal.tsx')
  const filesPage = readFrontend('src/components/files/FilesPage.jsx')
  const methods = readFrontend('src/api/methods.js')

  for (const source of [picker, filesPage]) {
    assert.match(source, /const uploadInFlightRef = useRef\(false\)/)
    assert.match(source, /const deleteInFlightRef = useRef\(false\)/)
    assert.match(source, /if \(uploadInFlightRef\.current\) return/)
    assert.match(source, /uploadInFlightRef\.current = true[\s\S]*setUploading\(true\)/)
    assert.match(source, /finally \{[\s\S]*uploadInFlightRef\.current = false[\s\S]*setUploading\(false\)/)
    assert.match(source, /deleteInFlightRef\.current = true[\s\S]*window\.confirm/)
    assert.match(source, /finally \{[\s\S]*deleteInFlightRef\.current = false[\s\S]*setDeletingAssetId\(null\)/)
    assert.match(source, /disabled=\{uploading \|\| deletingAssetId != null\}/)
  }

  assert.match(filesPage, /const FILES_ASSET_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(filesPage, /const FILES_ASSET_DELETE_TIMEOUT_MS = 12000/)
  assert.match(filesPage, /withLoaderTimeout\(\s*\(\) => window\.api\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload file asset',\s*FILES_ASSET_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /withLoaderTimeout\(\s*\(\) => window\.api\.deleteFileAsset\(asset\.id, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /withLoaderTimeout\(\s*\(\) => window\.api\.deleteFileAsset\(asset\.id, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete selected file asset',\s*FILES_ASSET_DELETE_TIMEOUT_MS,\s*\)/)
  assert.match(filesPage, /Download className="mr-1\.5 inline h-3\.5 w-3\.5"/)
  assert.doesNotMatch(filesPage, /<Save className=/)

  assert.match(picker, /const FILE_PICKER_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(picker, /const FILE_PICKER_DELETE_TIMEOUT_MS = 12000/)
  assert.match(picker, /function getFilePickerApi\(\): FilePickerApi/)
  assert.match(picker, /withLoaderTimeout<FileAsset>\(\s*\(\) => getFilePickerApi\(\)\.uploadFileAsset\(\{ file, userId: user\?\.id, userName: user\?\.name \}\),\s*'Upload picker file asset',\s*FILE_PICKER_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(picker, /withLoaderTimeout\(\s*\(\) => getFilePickerApi\(\)\.deleteFileAsset\(assetId, \{ expectedUpdatedAt: asset\.updated_at \|\| undefined \}\),\s*'Delete picker file asset',\s*FILE_PICKER_DELETE_TIMEOUT_MS,\s*\)/)

  assert.match(methods, /export async function uploadFileAsset\(\{ file, userId, userName, signal, onProgress \} = \{\}\) \{[\s\S]*requireLiveServerWrite\('files:upload'/)
  assert.match(methods, /return route\('files:delete', \(\) => apiFetch\('DELETE', `\/api\/files\/\$\{id\}`/)
})

await runTest('product form image upload and save keep synchronous guards', () => {
  const source = readFrontend('src/components/products/forms/ProductForm.tsx')

  assert.match(source, /const imageUploadInFlightRef = useRef\(false\)/)
  assert.match(source, /const saveInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(imageUploading \|\| imageUploadInFlightRef\.current\) return/)
  assert.match(source, /imageUploadInFlightRef\.current = true/)
  assert.match(source, /finally \{[\s\S]*imageUploadInFlightRef\.current = false[\s\S]*setImageUploading\(false\)/)
  assert.match(source, /if \(saving \|\| saveInFlightRef\.current\) return/)
  assert.match(source, /saveInFlightRef\.current = true[\s\S]*const payload(?:: ProductSavePayload)? = \{/)
  assert.match(source, /finally \{[\s\S]*saveInFlightRef\.current = false[\s\S]*setSaving\(false\)/)
  assert.match(source, /const PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => api\.uploadProductImage\(\{[\s\S]*productId: currentProductId \|\| null,[\s\S]*file,[\s\S]*fileName: file\.name \|\| 'product\.jpg',[\s\S]*\}\),\s*'Upload product form image',\s*PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/)
})

await runTest('catalog portal media upload keeps a per-target synchronous guard', () => {
  const source = readFrontend('src/components/catalog/CatalogPage.jsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const mediaUploadInFlightTargetsRef = useRef\(new Set\(\)\)/)
  assert.match(source, /const CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /async function uploadPortalMedia\(target, accept = 'image\/\*'\) \{[\s\S]*if \(!beginKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)\) return ''/)
  assert.match(source, /beginKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)[\s\S]*document\.createElement\('input'\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateMediaUploadState\(targetKey, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload portal media',\s*CATALOG_PORTAL_MEDIA_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(mediaUploadInFlightTargetsRef, targetKey\)[\s\S]*mediaUploadControllersRef\.current\.delete\(targetKey\)/)
  assert.match(source, /function cancelPortalMediaUpload\(target\) \{[\s\S]*controller\?\.abort\?\.\(\)/)
})

await runTest('catalog portal submission writes use guarded bounded actions', () => {
  const source = readFrontend('src/components/catalog/CatalogPage.jsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS = 12000/)
  assert.match(source, /const CATALOG_PORTAL_REVIEW_TIMEOUT_MS = 12000/)
  assert.match(source, /const submissionSavingRef = useRef\(false\)/)
  assert.match(source, /const reviewSavingRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(submissionSavingRef, \{ blocked: submissionSaving \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.createPortalSubmission\(\{[\s\S]*membershipNumber: membershipNumberValue,[\s\S]*screenshots: submissionDraft\.screenshots,[\s\S]*\}\),\s*'Create portal submission',\s*CATALOG_PORTAL_SUBMISSION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(submissionSavingRef\)[\s\S]*setSubmissionSaving\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(reviewSavingRef, \{ blocked: reviewSavingId != null, value: item\.id \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.reviewPortalSubmission\(item\.id, \{[\s\S]*status,[\s\S]*userName: user\?\.name,[\s\S]*\}\),\s*'Review portal submission',\s*CATALOG_PORTAL_REVIEW_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(reviewSavingRef\)[\s\S]*setReviewSavingId\(null\)/)
})

await runTest('profile saves and avatar upload keep same-tick guards', () => {
  const source = readFrontend('src/components/users/UserProfileModal.jsx')

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
  const source = readFrontend('src/components/utils-settings/Settings.jsx')
  const methods = readFrontend('src/api/methods.js')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const \[savingSettings, setSavingSettings\] = useState\(false\)/)
  assert.match(source, /const settingsSaveInFlightRef = useRef\(false\)/)
  assert.match(source, /const uploadInFlightKeysRef = useRef\(new Set\(\)\)/)
  assert.match(source, /const SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(source, /if \(!beginKeyedAction\(uploadInFlightKeysRef, key\)\) return/)
  assert.match(source, /beginKeyedAction\(uploadInFlightKeysRef, key\)[\s\S]*document\.createElement\('input'\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.uploadFileAsset\(\{[\s\S]*signal: controller\.signal,[\s\S]*onProgress: \(\{ percent \}\) => updateUploadState\(key, \{ type: 'progress', progress: percent \}\),[\s\S]*\}\),\s*'Upload settings image',\s*SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(uploadInFlightKeysRef, key\)[\s\S]*uploadControllersRef\.current\.delete\(key\)/)
  assert.match(source, /if \(!beginSingleAction\(settingsSaveInFlightRef, \{ blocked: savingSettings \}\)\) return/)
  assert.match(source, /beginSingleAction\(settingsSaveInFlightRef, \{ blocked: savingSettings \}\)[\s\S]*setSavingSettings\(true\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(settingsSaveInFlightRef\)[\s\S]*setSavingSettings\(false\)/)
  assert.match(source, /disabled=\{savingSettings \|\| uploadingImage\}/)
  assert.match(methods, /let settingsSaveQueue = Promise\.resolve\(\)/)
  assert.match(methods, /const queuedSave = settingsSaveQueue\.catch\(\(\) => \{\}\)\.then\(runSave\)/)
})

await runTest('reset data and factory reset use guarded bounded actions', () => {
  const source = readFrontend('src/components/utils-settings/ResetData.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /import \{ withLoaderTimeout \} from '\.\.\/\.\.\/utils\/loaders\.ts'/)
  assert.match(source, /const RESET_DATA_TIMEOUT_MS = 60000/)
  assert.match(source, /const FACTORY_RESET_TIMEOUT_MS = 90000/)
  assert.match(source, /const resetInFlightRef = useRef\(false\)/)
  assert.match(source, /const factoryResetInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(resetInFlightRef, \{ blocked: working \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(factoryResetInFlightRef, \{ blocked: working \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => [\s\S]*resetData\?\.\(mode\)[\s\S]*'Reset business data',\s*RESET_DATA_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => [\s\S]*factoryReset\?\.\(\)[\s\S]*'Factory reset',\s*FACTORY_RESET_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(resetInFlightRef\)[\s\S]*setWorking\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(factoryResetInFlightRef\)[\s\S]*setWorking\(false\)/)
})

await runTest('server queue and connection actions use guarded bounded actions', () => {
  const source = readFrontend('src/components/server/ServerPage.jsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS = 12000/)
  assert.match(source, /const SERVER_SYNC_TEST_TIMEOUT_MS = 12000/)
  assert.match(source, /const queueActionInFlightRef = useRef\(false\)/)
  assert.match(source, /const testSyncInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(queueActionInFlightRef, \{ blocked: retryingQueue \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.retryPendingSyncNow\(\),\s*'Retry pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.discardPendingSyncQueue\(\),\s*'Discard pending sync queue',\s*SERVER_SYNC_QUEUE_ACTION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(queueActionInFlightRef\)[\s\S]*setRetryingQueue\(false\)/)
  assert.match(source, /if \(!beginSingleAction\(testSyncInFlightRef, \{ blocked: testing \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.testSyncServer\(url\),\s*'Test sync server',\s*SERVER_SYNC_TEST_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(testSyncInFlightRef\)[\s\S]*setTesting\(false\)/)
})

await runTest('audit log retention cleanup uses a guarded bounded action', () => {
  const source = readFrontend('src/components/utils-settings/AuditLog.jsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS = 12000/)
  assert.match(source, /const \[clearingOldLogs, setClearingOldLogs\] = useState\(false\)/)
  assert.match(source, /const clearOldLogsInFlightRef = useRef\(false\)/)
  assert.match(source, /if \(!window\.confirm\('Clear audit logs older than 30 days\?'\)\) return[\s\S]*if \(!beginSingleAction\(clearOldLogsInFlightRef, \{ blocked: clearingOldLogs \}\)\) return/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.deleteAuditLogsRetention\(30\),\s*'Clear old audit logs',\s*AUDIT_LOG_RETENTION_DELETE_TIMEOUT_MS,\s*\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(clearOldLogsInFlightRef\)[\s\S]*setClearingOldLogs\(false\)[\s\S]*setLoading\(false\)/)
  assert.match(source, /disabled=\{clearingOldLogs\}/)
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

await runTest('custom tables bound reads and same-tick row mutations', () => {
  const source = readFrontend('src/components/custom-tables/CustomTables.tsx')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const CUSTOM_TABLES_LOAD_TIMEOUT_MS = 8000/)
  assert.match(source, /const CUSTOM_TABLE_ROWS_LOAD_TIMEOUT_MS = 10000/)
  assert.match(source, /const CUSTOM_TABLE_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const createTableInFlightRef = useRef\(false\)/)
  assert.match(source, /const saveRowInFlightRef = useRef\(false\)/)
  assert.match(source, /const deleteRowInFlightRef = useRef\(false\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.getCustomTables\?\.\(\),\s*'Custom tables',\s*CUSTOM_TABLES_LOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.getCustomTableData\?\.\(\{ tableName \}\),\s*`Custom table \$\{tableName\}`,\s*CUSTOM_TABLE_ROWS_LOAD_TIMEOUT_MS,\s*\)/)
  assert.match(source, /if \(!beginSingleAction\(createTableInFlightRef, \{ blocked: savingTable \}\)\) return/)
  assert.match(source, /if \(!activeTable\?\.name \|\| !beginSingleAction\(saveRowInFlightRef, \{ blocked: savingRow \}\)\) return/)
  assert.match(source, /if \(!activeTable\?\.name \|\| !beginSingleAction\(deleteRowInFlightRef, \{ blocked: !!deletingRowId, value: id \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(createTableInFlightRef\)[\s\S]*setSavingTable\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(saveRowInFlightRef\)[\s\S]*setSavingRow\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(deleteRowInFlightRef\)[\s\S]*setDeletingRowId\(null\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.createCustomTable\?\.\(payload\),[\s\S]*CUSTOM_TABLE_MUTATION_TIMEOUT_MS/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.insertCustomRow\?\.\(\{ tableName: activeTable\.name, data: payload \}\),[\s\S]*CUSTOM_TABLE_MUTATION_TIMEOUT_MS/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.updateCustomRow\?\.\(\{[\s\S]*CUSTOM_TABLE_MUTATION_TIMEOUT_MS/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => getCustomTablesApi\(\)\.deleteCustomRow\?\.\(\{[\s\S]*CUSTOM_TABLE_MUTATION_TIMEOUT_MS/)
})

await runTest('contact tabs use same-tick guards and bounded mutations', () => {
  const targets = [
    {
      label: 'customers',
      source: readFrontend('src/components/contacts/CustomersTab.jsx'),
      constant: 'CUSTOMER_MUTATION_TIMEOUT_MS',
      create: 'createCustomer',
      update: 'updateCustomer',
      remove: 'deleteCustomer',
    },
    {
      label: 'suppliers',
      source: readFrontend('src/components/contacts/SuppliersTab.jsx'),
      constant: 'SUPPLIER_MUTATION_TIMEOUT_MS',
      create: 'createSupplier',
      update: 'updateSupplier',
      remove: 'deleteSupplier',
    },
    {
      label: 'delivery contacts',
      source: readFrontend('src/components/contacts/DeliveryTab.jsx'),
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
    assert.match(target.source, new RegExp(`window\\.api\\.${target.create}\\(`), `${target.label} should still create through window.api`)
    assert.match(target.source, new RegExp(`window\\.api\\.${target.update}\\(`), `${target.label} should still update through window.api`)
    assert.match(target.source, new RegExp(`window\\.api\\.${target.remove}\\(`), `${target.label} should still delete through window.api`)
    assert.match(target.source, /finally \{[\s\S]*finishSingleAction\(bulkDeleteInFlightRef\)[\s\S]*setBulkActionBusy\(false\)/, `${target.label} bulk guard should clear`)
  }
})

await runTest('sales status and membership actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/sales/Sales.jsx')

  assert.match(source, /import \{ beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const SALES_STATUS_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const statusActionRef = useRef\(new Set\(\)\)/)
  assert.match(source, /const membershipActionRef = useRef\(new Set\(\)\)/)
  assert.match(source, /const bulkStatusInFlightRef = useRef\(false\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.updateSaleStatus\(saleId, nextStatus, notes\),\s*'Update sale status',\s*SALES_STATUS_MUTATION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /withLoaderTimeout\(\s*\(\) => window\.api\.attachSaleCustomer\(saleId, payload\),\s*'Attach sale membership',\s*SALES_MEMBERSHIP_MUTATION_TIMEOUT_MS,\s*\)/)
  assert.match(source, /if \(!beginKeyedAction\(statusActionRef, actionKey\)\) return false/)
  assert.match(source, /finishKeyedAction\(statusActionRef, actionKey\)[\s\S]*return false/)
  assert.match(source, /await runSaleStatusMutation\(saleId, newStatus, notes\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(statusActionRef, actionKey\)/)
  assert.match(source, /if \(!beginKeyedAction\(membershipActionRef, actionKey\)\) return false/)
  assert.match(source, /await runSaleMembershipMutation\(saleId, \{/)
  assert.match(source, /await runSaleMembershipMutation\(saleId, payload\)/)
  assert.match(source, /finally \{[\s\S]*finishKeyedAction\(membershipActionRef, actionKey\)/)
  assert.match(source, /runConcurrentTasks\(entries, async \(entry\) => \{[\s\S]*await runSaleStatusMutation\(saleId, nextStatus, notes\)/)
  assert.match(source, /if \(!selectedSales\.length \|\| !beginSingleAction\(bulkStatusInFlightRef, \{ blocked: !!bulkStatusSaving \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkStatusInFlightRef\)[\s\S]*setBulkStatusSaving\(''\)/)
})

await runTest('branch CRUD and transfer actions use shared guards and bounded mutations', () => {
  const branches = readFrontend('src/components/branches/Branches.jsx')
  const transfer = readFrontend('src/components/branches/TransferModal.tsx')

  assert.match(branches, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(branches, /const BRANCH_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(branches, /const \[bulkDeleteBusy, setBulkDeleteBusy\] = useState\(false\)/)
  assert.match(branches, /const saveInFlightRef = useRef\(false\)/)
  assert.match(branches, /const deleteInFlightRef = useRef\(false\)/)
  assert.match(branches, /const bulkDeleteInFlightRef = useRef\(false\)/)
  assert.match(branches, /withLoaderTimeout\(loader, label, BRANCH_MUTATION_TIMEOUT_MS\)/)
  assert.match(branches, /if \(!beginSingleAction\(saveInFlightRef\)\) return/)
  assert.match(branches, /await runBranchMutation\(\(\) => window\.api\.updateBranch\(selected\.id, payload\), 'Update branch'\)/)
  assert.match(branches, /await runBranchMutation\(\(\) => window\.api\.createBranch\(payload\), 'Create branch'\)/)
  assert.match(branches, /finally \{[\s\S]*finishSingleAction\(saveInFlightRef\)/)
  assert.match(branches, /if \(!beginSingleAction\(deleteInFlightRef\)\) return/)
  assert.match(branches, /await runBranchMutation\(\s*\(\) => window\.api\.deleteBranch\(branch\.id, user\?\.id, user\?\.name\),\s*'Delete branch',\s*\)/)
  assert.match(branches, /finally \{[\s\S]*finishSingleAction\(deleteInFlightRef\)/)
  assert.match(branches, /if \(!beginSingleAction\(bulkDeleteInFlightRef, \{ blocked: bulkDeleteBusy \}\)\) return/)
  assert.match(branches, /await runBranchMutation\(\s*\(\) => window\.api\.deleteBranch\(branch\.id, user\?\.id, user\?\.name\),\s*'Bulk delete branches',\s*\)/)
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

await runTest('inventory adjust, move, transfer, and batch actions use shared guards and bounded mutations', () => {
  const source = readFrontend('src/components/inventory/Inventory.jsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /window\.api\.(adjustStock|moveStockRow|transferInventoryStock)\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const INVENTORY_STOCK_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const adjustStockInFlightRef = useRef\(false\)/)
  assert.match(source, /const moveStockInFlightRef = useRef\(false\)/)
  assert.match(source, /const transferStockInFlightRef = useRef\(false\)/)
  assert.match(source, /const batchInventoryInFlightRef = useRef\(false\)/)
  assert.match(source, /const runInventoryMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, INVENTORY_STOCK_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(adjustStockInFlightRef, \{ blocked: adjustSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(moveStockInFlightRef, \{ blocked: moveSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(transferStockInFlightRef, \{ blocked: transferSaving \}\)\) return/)
  assert.match(source, /if \(!beginSingleAction\(batchInventoryInFlightRef, \{ blocked: batchApplying \}\)\) return/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(adjustStockInFlightRef\)[\s\S]*setAdjustSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(moveStockInFlightRef\)[\s\S]*setMoveSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(transferStockInFlightRef\)[\s\S]*setTransferSaving\(false\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(batchInventoryInFlightRef\)[\s\S]*setBatchApplying\(false\)/)
  assert.ok(mutationLines.length >= 9, 'inventory should still call all stock mutation APIs in normal, undo/redo, and batch paths')
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
  const source = readFrontend('src/components/products/Products.jsx')
  const config = readFrontend('src/components/products/config/productPageConfig.ts')

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(config, /export const PRODUCT_WRITE_MUTATION_TIMEOUT_MS = 15000/)
  assert.match(config, /export const PRODUCT_DELETE_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(config, /export const PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS = 30000/)
  assert.match(config, /export const PRODUCT_STOCK_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const productSaveInFlightRef = useRef\(false\)/)
  assert.match(source, /const productDeleteInFlightRef = useRef\(false\)/)
  assert.match(source, /const bulkActionInFlightRef = useRef\(false\)/)
  assert.match(source, /const runProductWriteMutation = useCallback\(\(loader, label, timeoutMs = PRODUCT_WRITE_MUTATION_TIMEOUT_MS\) => \([\s\S]*withLoaderTimeout\(loader, label, timeoutMs\)/)
  assert.match(source, /const runProductDeleteMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_DELETE_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /const runProductStockMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, PRODUCT_STOCK_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /if \(!beginSingleAction\(productSaveInFlightRef\)\) return[\s\S]*runProductWriteMutation\(\(\) => window\.api\.createProduct\(payload\), 'Create product'\)/)
  assert.match(source, /runProductWriteMutation\(\(\) => window\.api\.updateProduct\(selected\.id, payload\), 'Update product'\)/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => window\.api\.uploadProductImage\(\{ productId, filePath: entry, fileName \}\),[\s\S]*PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS/)
  assert.match(source, /runProductWriteMutation\(\(\) => window\.api\.updateProduct\(productId, buildProductWritePayload\(snapshot\)\), 'Restore product'\)/)
  assert.match(source, /runProductWriteMutation\(\(\) => window\.api\.createProduct\(createPayload\), 'Restore deleted product'\)/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => window\.api\.updateProduct\([\s\S]*'Bulk update product'/)
  assert.match(source, /runProductWriteMutation\([\s\S]*\(\) => window\.api\.updateProduct\([\s\S]*'Redo product bulk update'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => window\.api\.adjustStock\([\s\S]*'Restore product branch stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => window\.api\.adjustStock\([\s\S]*'Clear product stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => window\.api\.adjustStock\([\s\S]*'Bulk add product stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => window\.api\.transferStock\([\s\S]*'Move product branch stock'/)
  assert.match(source, /runProductStockMutation\([\s\S]*\(\) => window\.api\.adjustStock\([\s\S]*'Initialize product branch stock'/)
  assert.doesNotMatch(source, /await\s+window\.api\.(adjustStock|transferStock|createProduct|updateProduct|deleteProduct)\(/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(productSaveInFlightRef\)/)
  assert.match(source, /if \(!beginSingleAction\(productDeleteInFlightRef\)\) return[\s\S]*runProductDeleteMutation\(\(\) => window\.api\.deleteProduct\(p\.id, user\.id, user\.name\), 'Delete product'\)/)
  assert.match(source, /finally \{ finishSingleAction\(productDeleteInFlightRef\) \}/)
  assert.match(source, /if \(!beginSingleAction\(bulkActionInFlightRef, \{ blocked: bulkActionBusy \}\)\) return[\s\S]*runProductDeleteMutation\(\(\) => window\.api\.deleteProduct\(id\), 'Delete product'\)/)
  assert.match(source, /finally \{[\s\S]*finishSingleAction\(bulkActionInFlightRef\)[\s\S]*setBulkActionBusy\(false\)/)
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
  const page = readFrontend('src/components/files/FilesPage.jsx')
  const tab = readFrontend('src/components/files/FilesProvidersTab.tsx')
  const mutationLines = page
    .split('\n')
    .filter((line) => /window\.api\.(createAiProvider|updateAiProvider|deleteAiProvider|testAiProvider)\(/.test(line))

  assert.match(page, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(page, /const AI_PROVIDER_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(page, /const AI_PROVIDER_TEST_TIMEOUT_MS = 30000/)
  assert.match(page, /const saveProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const testProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const deleteProviderInFlightRef = useRef\(false\)/)
  assert.match(page, /const \[deletingProviderId, setDeletingProviderId\] = useState\(null\)/)
  assert.match(page, /const runProviderMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, AI_PROVIDER_MUTATION_TIMEOUT_MS\)/)
  assert.match(page, /const runProviderTest = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, AI_PROVIDER_TEST_TIMEOUT_MS\)/)
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
  const source = readFrontend('src/components/users/Users.jsx')
  const mutationLines = source
    .split('\n')
    .filter((line) => /window\.api\.(createUser|updateUser|changeUserPassword|createRole|updateRole|deleteRole)\(/.test(line))

  assert.match(source, /import \{ beginSingleAction, finishSingleAction \} from '\.\.\/\.\.\/utils\/actionGuards\.ts'/)
  assert.match(source, /const USER_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const ROLE_MUTATION_TIMEOUT_MS = 12000/)
  assert.match(source, /const saveUserInFlightRef = useRef\(false\)/)
  assert.match(source, /const passwordInFlightRef = useRef\(false\)/)
  assert.match(source, /const saveRoleInFlightRef = useRef\(false\)/)
  assert.match(source, /const deleteRoleInFlightRef = useRef\(false\)/)
  assert.match(source, /const runUserMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, USER_MUTATION_TIMEOUT_MS\)/)
  assert.match(source, /const runRoleMutation = useCallback\(\(loader, label\) => \([\s\S]*withLoaderTimeout\(loader, label, ROLE_MUTATION_TIMEOUT_MS\)/)
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
