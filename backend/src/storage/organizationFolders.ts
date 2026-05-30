'use strict'

const fs = require('fs')
const path = require('path')

/** @param {unknown} value @returns {string} */
function trim(value) {
  return String(value || '').trim()
}

/** @param {unknown} value @param {string} [fallback] @returns {string} */
function sanitizeOrganizationFolderLabel(value, fallback = 'Organization') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

/** @param {unknown} publicId @param {unknown} nameOrSlug @param {string} [fallback] @returns {string} */
function buildOrganizationFolderName(publicId, nameOrSlug, fallback = 'Organization') {
  const stableId = trim(publicId)
  if (!stableId) return sanitizeOrganizationFolderLabel(nameOrSlug, fallback)
  return `${stableId} (${sanitizeOrganizationFolderLabel(nameOrSlug, fallback)})`
}

/** @param {unknown} folderName @returns {string} */
function extractOrganizationPublicId(folderName) {
  const value = trim(folderName)
  if (!value) return ''
  const marker = value.indexOf(' (')
  return marker > 0 ? value.slice(0, marker) : value
}

/** @param {string} organizationsRoot @param {unknown} publicId @returns {string | null} */
function findOrganizationFolderByPublicId(organizationsRoot, publicId) {
  const stableId = trim(publicId)
  if (!stableId || !fs.existsSync(organizationsRoot)) return null
  let canonical = ''
  for (const entry of fs.readdirSync(organizationsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === stableId) return path.join(organizationsRoot, entry.name)
    if (!canonical && entry.name.startsWith(`${stableId} (`)) canonical = entry.name
  }
  if (canonical) return path.join(organizationsRoot, canonical)

  return null
}

module.exports = {
  trim,
  sanitizeOrganizationFolderLabel,
  buildOrganizationFolderName,
  extractOrganizationPublicId,
  findOrganizationFolderByPublicId,
}
