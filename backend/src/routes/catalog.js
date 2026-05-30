'use strict'

const express = require('express')
const { db } = require('../database')
const { tryParse } = require('../helpers')
const { sanitizeMediaList } = require('../settingsSnapshot.ts')

const router = express.Router()

function collectProductIds(products = []) {
  const ids = []
  for (const product of products) {
    ids.push(product.id)
  }
  return ids
}

function buildPlaceholders(count) {
  const placeholders = []
  for (let index = 0; index < count; index += 1) {
    placeholders.push('?')
  }
  return placeholders.join(',')
}

function buildImageMap(rows = []) {
  const imageMap = new Map()
  for (const row of rows) {
    if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, [])
    imageMap.get(row.product_id).push(row.image_path)
  }
  return imageMap
}

function buildCatalogProductPayloads(products = [], imageMap = new Map()) {
  const payloads = []
  for (const product of products) {
    const gallery = sanitizeMediaList(imageMap.get(product.id) || []).slice(0, 5)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    payloads.push({
      ...product,
      image_path: gallery[0] || null,
      image_gallery: gallery,
      branch_stock: tryParse(product.branch_stock_json, []),
      branch_stock_json: undefined,
    })
  }
  return payloads
}

router.get('/meta', (_req, res) => {
  const categories = db.prepare(`
    SELECT id, name
    FROM categories
    ORDER BY name COLLATE NOCASE ASC
  `).all()

  const branches = db.prepare(`
    SELECT id, name, is_default
    FROM branches
    WHERE is_active = 1
    ORDER BY is_default DESC, name COLLATE NOCASE ASC
  `).all()

  res.json({ categories, branches })
})

router.get('/products', (_req, res) => {
  const products = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.category,
      p.unit,
      p.description,
      p.selling_price_usd,
      p.selling_price_khr,
      p.stock_quantity,
      p.low_stock_threshold,
      p.out_of_stock_threshold,
      p.image_path,
      COALESCE(json_agg(json_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'quantity', COALESCE(bs.quantity, 0)
      )) FILTER (WHERE b.id IS NOT NULL), '[]'::json)::text AS branch_stock_json
    FROM products p
    LEFT JOIN branches b ON b.is_active = 1
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = b.id
    WHERE p.is_active = 1
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE ASC
  `).all()

  const ids = collectProductIds(products)
  const imageRows = ids.length
    ? db.prepare(`
      SELECT product_id, image_path
      FROM product_images
      WHERE product_id IN (${buildPlaceholders(ids.length)})
      ORDER BY sort_order ASC, id ASC
    `).all(...ids)
    : []

  res.json(buildCatalogProductPayloads(products, buildImageMap(imageRows)))
})

module.exports = router
