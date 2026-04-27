'use strict'

const {
  isUploadPublicPath,
  sanitizeMediaList,
  sanitizeMediaPath,
  sanitizeSettingValue,
} = require('./settingsSnapshot')

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function repairMissingUploadReferences(db) {
  const summary = {
    settings: 0,
    productImages: 0,
    products: 0,
    users: 0,
    fileAssets: 0,
    portalSubmissions: 0,
  }

  const updateSetting = db.prepare(`
    UPDATE settings
    SET value = ?, updated_at = datetime('now')
    WHERE key = ?
  `)
  db.prepare('SELECT key, value FROM settings').all().forEach((row) => {
    const nextValue = sanitizeSettingValue(row.value)
    if (nextValue === row.value) return
    updateSetting.run(nextValue, row.key)
    summary.settings += 1
  })

  const deleteProductImage = db.prepare('DELETE FROM product_images WHERE id = ?')
  const updateProductImage = db.prepare('UPDATE product_images SET image_path = ? WHERE id = ?')
  db.prepare('SELECT id, image_path FROM product_images').all().forEach((row) => {
    const nextValue = sanitizeMediaPath(row.image_path, null)
    if (!nextValue) {
      deleteProductImage.run(row.id)
      summary.productImages += 1
      return
    }
    if (nextValue !== row.image_path) {
      updateProductImage.run(nextValue, row.id)
      summary.productImages += 1
    }
  })

  const firstGalleryImage = db.prepare(`
    SELECT image_path
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
    LIMIT 1
  `)
  const updateProduct = db.prepare(`
    UPDATE products
    SET image_path = ?, updated_at = datetime('now')
    WHERE id = ?
  `)
  db.prepare('SELECT id, image_path FROM products').all().forEach((row) => {
    const galleryPrimary = sanitizeMediaPath(firstGalleryImage.get(row.id)?.image_path, null)
    const currentPrimary = sanitizeMediaPath(row.image_path, null)
    const nextValue = galleryPrimary || currentPrimary || null
    if ((row.image_path || null) === nextValue) return
    updateProduct.run(nextValue, row.id)
    summary.products += 1
  })

  const updateUserAvatar = db.prepare(`
    UPDATE users
    SET avatar_path = ?
    WHERE id = ?
  `)
  db.prepare('SELECT id, avatar_path FROM users WHERE avatar_path IS NOT NULL AND trim(avatar_path) != \'\'').all().forEach((row) => {
    const nextValue = sanitizeMediaPath(row.avatar_path, null)
    if ((row.avatar_path || null) === nextValue) return
    updateUserAvatar.run(nextValue, row.id)
    summary.users += 1
  })

  const deleteFileAsset = db.prepare('DELETE FROM file_assets WHERE id = ?')
  const updateFileAsset = db.prepare(`
    UPDATE file_assets
    SET public_path = ?, updated_at = datetime('now')
    WHERE id = ?
  `)
  db.prepare('SELECT id, public_path FROM file_assets').all().forEach((row) => {
    if (!isUploadPublicPath(row.public_path)) return
    const nextValue = sanitizeMediaPath(row.public_path, null)
    if (!nextValue) {
      deleteFileAsset.run(row.id)
      summary.fileAssets += 1
      return
    }
    if (nextValue !== row.public_path) {
      updateFileAsset.run(nextValue, row.id)
      summary.fileAssets += 1
    }
  })

  const updateSubmissionScreenshots = db.prepare(`
    UPDATE customer_share_submissions
    SET screenshots_json = ?
    WHERE id = ?
  `)
  db.prepare('SELECT id, screenshots_json FROM customer_share_submissions WHERE screenshots_json IS NOT NULL AND trim(screenshots_json) != \'\'').all().forEach((row) => {
    const currentList = safeJsonArray(row.screenshots_json)
    const nextList = sanitizeMediaList(currentList)
    if (JSON.stringify(currentList) === JSON.stringify(nextList)) return
    updateSubmissionScreenshots.run(JSON.stringify(nextList), row.id)
    summary.portalSubmissions += 1
  })

  return summary
}

module.exports = {
  repairMissingUploadReferences,
}
