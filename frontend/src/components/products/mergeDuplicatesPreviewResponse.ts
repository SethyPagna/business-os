export type ValidatedMergeDuplicatesPreviewGroup = {
  caseKeys: string[]
  canonicalId: number
  canonicalName: string | null
  canonicalBarcode: string | null
  duplicates: Array<{
    id: number
    name: string | null
    barcode: string | null
    quantity: number
    batchCount: number
  }>
  totalQuantityToMove: number
  branchBreakdown: Array<{ branchId: number; branchName: string | null; quantity: number }>
  costBefore?: Record<string, number>
  costAfter?: Record<string, number>
  costRefusals: Array<{ mergedId: number | null; field: string; code: string; error: string }>
  mergeable: boolean
  mergeBlockers: Array<{ code: string; error: string }>
}

export type ValidatedMergeDuplicatesPreview = {
  groupCount: number
  duplicateProductCount: number
  mergeableDuplicateProductCount: number
  blockedGroupCount: number
  groups: ValidatedMergeDuplicatesPreviewGroup[]
  costRefusalCount: number
}

const ROOT_KEYS = new Set([
  'success',
  'groupCount',
  'duplicateProductCount',
  'mergeableDuplicateProductCount',
  'blockedGroupCount',
  'groups',
  'costRefusalCount',
  'batchLimit',
])
const GROUP_KEYS = new Set([
  'caseKeys',
  'canonicalId',
  'canonicalName',
  'canonicalBarcode',
  'duplicates',
  'totalQuantityToMove',
  'branchBreakdown',
  'costBefore',
  'costAfter',
  'costRefusals',
  'mergeable',
  'mergeBlockers',
])
const DUPLICATE_KEYS = new Set(['id', 'name', 'barcode', 'quantity', 'batchCount'])
const BRANCH_KEYS = new Set(['branchId', 'branchName', 'quantity'])
const BLOCKER_KEYS = new Set(['code', 'error'])
const REFUSAL_KEYS = new Set(['mergedId', 'field', 'code', 'error'])

function invalid(detail: string): never {
  throw new Error(`Invalid merge preview response: ${detail}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${label} must be an object`)
  return value
}

function expectOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label}.${key} is unexpected`)
  }
}

function expectCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(`${label} must be a nonnegative safe integer`)
  return Number(value)
}

function expectPositiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${label} must be a positive safe integer`)
  return Number(value)
}

function expectFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be a finite number`)
  return value
}

function expectNullableString(value: unknown, label: string): string | null {
  if (value !== null && typeof value !== 'string') invalid(`${label} must be a string or null`)
  return value
}

function expectNonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(`${label} must be a nonempty string`)
  return value
}

function expectFiniteNumberMap(value: unknown, label: string): Record<string, number> {
  const record = expectRecord(value, label)
  for (const [key, item] of Object.entries(record)) expectFiniteNumber(item, `${label}.${key}`)
  return record as Record<string, number>
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
}

export function validateMergeDuplicatesPreviewResponse(value: unknown): ValidatedMergeDuplicatesPreview {
  const root = expectRecord(value, 'root')
  expectOnlyKeys(root, ROOT_KEYS, 'root')
  if (root.success !== true) invalid('success must be true')

  const groupCount = expectCount(root.groupCount, 'groupCount')
  const duplicateProductCount = expectCount(root.duplicateProductCount, 'duplicateProductCount')
  if (!Array.isArray(root.groups)) invalid('groups must be an array')
  if (root.groups.length !== groupCount) invalid('groupCount does not match groups.length')

  const productIds = new Set<number>()
  const caseKeys = new Set<string>()
  let derivedDuplicateProductCount = 0
  let derivedMergeableDuplicateProductCount = 0
  let derivedBlockedGroupCount = 0
  let derivedCostRefusalCount = 0

  const groups = root.groups.map((rawGroup, groupIndex): ValidatedMergeDuplicatesPreviewGroup => {
    const label = `groups[${groupIndex}]`
    const group = expectRecord(rawGroup, label)
    expectOnlyKeys(group, GROUP_KEYS, label)

    const canonicalId = expectPositiveId(group.canonicalId, `${label}.canonicalId`)
    if (productIds.has(canonicalId)) invalid(`${label}.canonicalId is repeated across groups`)
    productIds.add(canonicalId)
    const canonicalName = expectNullableString(group.canonicalName, `${label}.canonicalName`)
    const canonicalBarcode = expectNullableString(group.canonicalBarcode, `${label}.canonicalBarcode`)

    if (!Array.isArray(group.duplicates) || group.duplicates.length === 0) {
      invalid(`${label}.duplicates must be a nonempty array`)
    }
    const duplicates = group.duplicates.map((rawDuplicate, duplicateIndex) => {
      const duplicateLabel = `${label}.duplicates[${duplicateIndex}]`
      const duplicate = expectRecord(rawDuplicate, duplicateLabel)
      expectOnlyKeys(duplicate, DUPLICATE_KEYS, duplicateLabel)
      const id = expectPositiveId(duplicate.id, `${duplicateLabel}.id`)
      if (id === canonicalId || productIds.has(id)) invalid(`${duplicateLabel}.id is repeated in the preview`)
      productIds.add(id)
      return {
        id,
        name: expectNullableString(duplicate.name, `${duplicateLabel}.name`),
        barcode: expectNullableString(duplicate.barcode, `${duplicateLabel}.barcode`),
        quantity: expectFiniteNumber(duplicate.quantity, `${duplicateLabel}.quantity`),
        batchCount: expectCount(duplicate.batchCount, `${duplicateLabel}.batchCount`),
      }
    })

    if (!Array.isArray(group.caseKeys) || group.caseKeys.length !== duplicates.length) {
      invalid(`${label}.caseKeys must match duplicates.length`)
    }
    const normalizedCaseKeys = group.caseKeys.map((item, caseIndex) => {
      const key = expectNonemptyString(item, `${label}.caseKeys[${caseIndex}]`)
      if (caseKeys.has(key)) invalid(`${label}.caseKeys[${caseIndex}] is repeated in the preview`)
      caseKeys.add(key)
      return key
    })

    if (!Array.isArray(group.branchBreakdown)) invalid(`${label}.branchBreakdown must be an array`)
    const branchIds = new Set<number>()
    const branchBreakdown = group.branchBreakdown.map((rawBranch, branchIndex) => {
      const branchLabel = `${label}.branchBreakdown[${branchIndex}]`
      const branch = expectRecord(rawBranch, branchLabel)
      expectOnlyKeys(branch, BRANCH_KEYS, branchLabel)
      const branchId = expectPositiveId(branch.branchId, `${branchLabel}.branchId`)
      if (branchIds.has(branchId)) invalid(`${branchLabel}.branchId is repeated in the group`)
      branchIds.add(branchId)
      return {
        branchId,
        branchName: expectNullableString(branch.branchName, `${branchLabel}.branchName`),
        quantity: expectFiniteNumber(branch.quantity, `${branchLabel}.quantity`),
      }
    })

    const totalQuantityToMove = expectFiniteNumber(group.totalQuantityToMove, `${label}.totalQuantityToMove`)
    const duplicateQuantity = duplicates.reduce((sum, duplicate) => sum + duplicate.quantity, 0)
    const branchQuantity = branchBreakdown.reduce((sum, branch) => sum + branch.quantity, 0)
    if (!Number.isFinite(duplicateQuantity) || !nearlyEqual(totalQuantityToMove, duplicateQuantity)) {
      invalid(`${label}.totalQuantityToMove does not match duplicate quantities`)
    }
    if (!Number.isFinite(branchQuantity) || !nearlyEqual(totalQuantityToMove, branchQuantity)) {
      invalid(`${label}.totalQuantityToMove does not match branch quantities`)
    }

    if (typeof group.mergeable !== 'boolean') invalid(`${label}.mergeable must be a boolean`)
    if (!Array.isArray(group.mergeBlockers)) invalid(`${label}.mergeBlockers must be an array`)
    const mergeBlockers = group.mergeBlockers.map((rawBlocker, blockerIndex) => {
      const blockerLabel = `${label}.mergeBlockers[${blockerIndex}]`
      const blocker = expectRecord(rawBlocker, blockerLabel)
      expectOnlyKeys(blocker, BLOCKER_KEYS, blockerLabel)
      return {
        code: expectNonemptyString(blocker.code, `${blockerLabel}.code`),
        error: expectNonemptyString(blocker.error, `${blockerLabel}.error`),
      }
    })

    if (!Array.isArray(group.costRefusals)) invalid(`${label}.costRefusals must be an array`)
    const costRefusals = group.costRefusals.map((rawRefusal, refusalIndex) => {
      const refusalLabel = `${label}.costRefusals[${refusalIndex}]`
      const refusal = expectRecord(rawRefusal, refusalLabel)
      expectOnlyKeys(refusal, REFUSAL_KEYS, refusalLabel)
      return {
        mergedId: refusal.mergedId === null ? null : expectPositiveId(refusal.mergedId, `${refusalLabel}.mergedId`),
        field: expectNonemptyString(refusal.field, `${refusalLabel}.field`),
        code: expectNonemptyString(refusal.code, `${refusalLabel}.code`),
        error: expectNonemptyString(refusal.error, `${refusalLabel}.error`),
      }
    })
    if (group.mergeable !== (mergeBlockers.length === 0 && costRefusals.length === 0)) {
      invalid(`${label}.mergeable does not match its blockers and refusals`)
    }

    const costBefore = group.costBefore === undefined
      ? undefined
      : expectFiniteNumberMap(group.costBefore, `${label}.costBefore`)
    const costAfter = group.costAfter === undefined
      ? undefined
      : expectFiniteNumberMap(group.costAfter, `${label}.costAfter`)

    derivedDuplicateProductCount += duplicates.length
    if (group.mergeable) derivedMergeableDuplicateProductCount += duplicates.length
    else derivedBlockedGroupCount += 1
    derivedCostRefusalCount += costRefusals.length

    return {
      caseKeys: normalizedCaseKeys,
      canonicalId,
      canonicalName,
      canonicalBarcode,
      duplicates,
      totalQuantityToMove,
      branchBreakdown,
      ...(costBefore === undefined ? {} : { costBefore }),
      ...(costAfter === undefined ? {} : { costAfter }),
      costRefusals,
      mergeable: group.mergeable,
      mergeBlockers,
    }
  })

  if (duplicateProductCount !== derivedDuplicateProductCount) {
    invalid('duplicateProductCount does not match group members')
  }

  const zeroPreview = groupCount === 0 && duplicateProductCount === 0
  const normalizedMetric = (key: 'mergeableDuplicateProductCount' | 'blockedGroupCount' | 'costRefusalCount'): number => {
    if (root[key] === undefined) {
      if (zeroPreview) return 0
      invalid(`${key} is required for a nonempty preview`)
    }
    return expectCount(root[key], key)
  }
  const mergeableDuplicateProductCount = normalizedMetric('mergeableDuplicateProductCount')
  const blockedGroupCount = normalizedMetric('blockedGroupCount')
  const costRefusalCount = normalizedMetric('costRefusalCount')
  if (mergeableDuplicateProductCount !== derivedMergeableDuplicateProductCount) {
    invalid('mergeableDuplicateProductCount does not match mergeable groups')
  }
  if (blockedGroupCount !== derivedBlockedGroupCount) invalid('blockedGroupCount does not match blocked groups')
  if (costRefusalCount !== derivedCostRefusalCount) invalid('costRefusalCount does not match group refusals')

  if (root.batchLimit === undefined) {
    if (!zeroPreview) invalid('batchLimit is required for a nonempty preview')
  } else if (expectCount(root.batchLimit, 'batchLimit') <= 0) {
    invalid('batchLimit must be positive')
  }

  return {
    groupCount,
    duplicateProductCount,
    mergeableDuplicateProductCount,
    blockedGroupCount,
    groups,
    costRefusalCount,
  }
}
