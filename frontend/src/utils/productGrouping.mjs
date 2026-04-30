function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function normalizeProductGroupName(value) {
  return normalizeText(value).toLowerCase()
}

function compareProducts(left, right, { rootId = 0 } = {}) {
  const leftId = Number(left?.id || 0)
  const rightId = Number(right?.id || 0)
  const leftIsRoot = leftId === Number(rootId)
  const rightIsRoot = rightId === Number(rootId)
  if (leftIsRoot !== rightIsRoot) return leftIsRoot ? -1 : 1

  const leftParent = Number(left?.parent_id || 0)
  const rightParent = Number(right?.parent_id || 0)
  if (!leftParent !== !rightParent) return leftParent ? 1 : -1

  const leftName = String(left?.name || '')
  const rightName = String(right?.name || '')
  const nameDelta = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' })
  if (nameDelta !== 0) return nameDelta

  const leftPrice = Number(left?.selling_price_usd || 0)
  const rightPrice = Number(right?.selling_price_usd || 0)
  if (leftPrice !== rightPrice) return leftPrice - rightPrice

  return leftId - rightId
}

function buildChildrenByParentId(products = []) {
  const map = new Map()
  ;(Array.isArray(products) ? products : []).forEach((product) => {
    const parentId = Number(product?.parent_id || 0)
    if (!parentId) return
    if (!map.has(parentId)) map.set(parentId, [])
    map.get(parentId).push(product)
  })
  return map
}

function resolveRootProduct(product, productsById = new Map()) {
  const parentId = Number(product?.parent_id || 0)
  if (!parentId) return product
  return productsById.get(parentId) || product
}

function resolveFamilyRootId(product, productsById = new Map()) {
  return Number(resolveRootProduct(product, productsById)?.id || product?.id || 0)
}

function compareProductsWithinGroup(left, right, productsById = new Map()) {
  const leftRootId = resolveFamilyRootId(left, productsById)
  const rightRootId = resolveFamilyRootId(right, productsById)

  if (leftRootId !== rightRootId) {
    const leftRootName = String(resolveRootProduct(left, productsById)?.name || left?.name || '')
    const rightRootName = String(resolveRootProduct(right, productsById)?.name || right?.name || '')
    const familyNameDelta = leftRootName.localeCompare(rightRootName, undefined, { sensitivity: 'base' })
    if (familyNameDelta !== 0) return familyNameDelta
    return leftRootId - rightRootId
  }

  return compareProducts(left, right, { rootId: leftRootId })
}

function resolveGroupKey(product, {
  productsById,
} = {}) {
  const root = resolveRootProduct(product, productsById)
  const productId = Number(product?.id || 0)
  const rootId = Number(root?.id || productId)
  const normalizedName = normalizeProductGroupName(root?.name || product?.name || '')

  if (normalizedName) return {
    key: `name:${normalizedName}`,
    explicitRootId: rootId,
    normalizedName,
  }
  return {
    key: `id:${rootId || productId}`,
    explicitRootId: rootId || 0,
    normalizedName: '',
  }
}

export function buildProductGroups(products = [], productsById = new Map()) {
  const source = Array.isArray(products) ? products : []
  const childrenByParentId = buildChildrenByParentId(source)

  const groups = new Map()
  source.forEach((product) => {
    const { key, explicitRootId, normalizedName } = resolveGroupKey(product, {
      productsById,
    })
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ids: [],
        items: [],
        explicitRootId,
        normalizedName,
      })
    }
    const group = groups.get(key)
    group.ids.push(Number(product?.id || 0))
    group.items.push(product)
  })

  return [...groups.values()].map((group) => {
    const items = [...group.items].sort((left, right) => compareProductsWithinGroup(left, right, productsById))
    const familyRootIds = [...new Set(items.map((item) => resolveFamilyRootId(item, productsById)).filter((id) => Number.isFinite(id) && id > 0))]
    const leadProduct = items.find((item) => {
      const itemId = Number(item?.id || 0)
      return !Number(item?.parent_id || 0) && familyRootIds.includes(itemId)
    }) || items[0]
    const sellableItems = items.filter((item) => {
      if (Number(item?.parent_id || 0) > 0) return true
      if (!Number(item?.is_group || 0)) return true
      return items.length === 1
    })
    const priceValues = sellableItems.map((item) => Number(item?.selling_price_usd || 0)).filter((value) => Number.isFinite(value))
    const stockTotal = items.reduce((sum, item) => sum + Number(item?.stock_quantity || 0), 0)
    const latestCreatedAt = items.reduce((latest, item) => {
      const value = String(item?.created_at || '')
      return value > latest ? value : latest
    }, '')
    return {
      key: group.key,
      id: Number(leadProduct?.id || 0),
      anchorId: Number(leadProduct?.id || 0),
      name: normalizeText(leadProduct?.name || items[0]?.name || ''),
      normalizedName: group.normalizedName,
      explicitRootId: Number(leadProduct?.id || 0),
      ids: items.map((item) => Number(item?.id || 0)).filter((id) => Number.isFinite(id) && id > 0),
      items,
      leadProduct,
      sellableItems,
      hasMultipleItems: items.length > 1,
      hasExplicitGroup: familyRootIds.length === 1 && items.some((item) => {
        const itemId = Number(item?.id || 0)
        return Number(item?.parent_id || 0) > 0 || childrenByParentId.has(itemId) || Boolean(Number(item?.is_group || 0))
      }),
      groupKind: familyRootIds.length === 1 && items.some((item) => Number(item?.parent_id || 0) > 0)
        ? 'variant'
        : 'option',
      familyCount: familyRootIds.length,
      stockTotal,
      latestCreatedAt,
      minSellingPriceUsd: priceValues.length ? Math.min(...priceValues) : 0,
      maxSellingPriceUsd: priceValues.length ? Math.max(...priceValues) : 0,
    }
  }).sort((left, right) => {
    const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
    if (nameDelta !== 0) return nameDelta
    return Number(left?.anchorId || 0) - Number(right?.anchorId || 0)
  })
}

export function buildProductGroupSections(products = [], {
  productsById = new Map(),
  sortDirection = 'asc',
} = {}) {
  const groups = buildProductGroups(products, productsById)
  const direction = String(sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const orderedGroups = [...groups].sort((left, right) => {
    const leftDate = String(left?.latestCreatedAt || '')
    const rightDate = String(right?.latestCreatedAt || '')
    if (leftDate !== rightDate) {
      return direction === 'desc'
        ? rightDate.localeCompare(leftDate)
        : leftDate.localeCompare(rightDate)
    }
    return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
  })

  const sections = new Map()
  orderedGroups.forEach((group) => {
    const firstChar = String(group?.name || '').trim().charAt(0).toUpperCase()
    const letter = /[A-Z]/.test(firstChar) ? firstChar : '#'
    if (!sections.has(letter)) {
      sections.set(letter, {
        id: `product-letter:${letter}`,
        label: letter,
        ids: [],
        items: [],
        groups: [],
      })
    }
    const section = sections.get(letter)
    section.groups.push(group)
    section.ids.push(...group.ids)
    section.items.push(...group.items)
  })

  return [...sections.values()].sort((left, right) => {
    if (left.label === '#') return 1
    if (right.label === '#') return -1
    return left.label.localeCompare(right.label)
  })
}
