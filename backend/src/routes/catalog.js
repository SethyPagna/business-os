'use strict'

const express = require('express')
const { db } = require('../database')
const { tryParse } = require('../helpers')
const { sanitizeMediaList } = require('../settingsSnapshot')

const router = express.Router()

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
      COALESCE(json_group_array(json_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'quantity', COALESCE(bs.quantity, 0)
      )) FILTER (WHERE b.id IS NOT NULL), '[]') AS branch_stock_json
    FROM products p
    LEFT JOIN branches b ON b.is_active = 1
    LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = b.id
    WHERE p.is_active = 1
    GROUP BY p.id
    ORDER BY p.name COLLATE NOCASE ASC
  `).all()

  const ids = products.map((product) => product.id)
  const imageRows = ids.length
    ? db.prepare(`
      SELECT product_id, image_path
      FROM product_images
      WHERE product_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order ASC, id ASC
    `).all(...ids)
    : []

  const imageMap = new Map()
  imageRows.forEach((row) => {
    if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, [])
    imageMap.get(row.product_id).push(row.image_path)
  })

  res.json(products.map((product) => {
    const gallery = sanitizeMediaList(imageMap.get(product.id) || []).slice(0, 5)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    return {
      ...product,
      image_path: gallery[0] || null,
      image_gallery: gallery,
      branch_stock: tryParse(product.branch_stock_json, []),
      branch_stock_json: undefined,
    }
  }))
})

module.exports = router
