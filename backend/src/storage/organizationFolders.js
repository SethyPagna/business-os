'use strict'

const fs = require('fs')
const path = require('path')

function trim(value) {
  return String(value || '').trim()
}

function sanitizeOrganizationFolderLabel(value, fallback = 'Organization') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function buildOrganizationFolderName(publicId, nameOrSlug, fallback = 'Organization') {
  const stableId = trim(publicId)
  if (!stableId) return sanitizeOrganizationFolderLabel(nameOrSlug, fallback)
  return `${stableId} (${sanitizeOrganizationFolderLabel(nameOrSlug, fallback)})`
}

function extractOrganizationPublicId(folderName) {
  const value = trim(folderName)
  if (!value) return ''
  const marker = value.indexOf(' (')
  return marker > 0 ? value.slice(0, marker) : value
}

function findOrganizationFolderByPublicId(organizationsRoot, publicId) {
  const stableId = trim(publicId)
  if (!stableId || !fs.existsSync(organizationsRoot)) return null
  const entries = fs.readdirSync(organizationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const exact = entries.find((name) => name === stableId)
  if (exact) return path.join(organizationsRoot, exact)

  const canonical = entries.find((name) => name.startsWith(`${stableId} (`))
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
