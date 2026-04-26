'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { db } = require('./database')
const { DATA_ROOT } = require('./config')

function trim(value) {
  return String(value || '').trim()
}

function slugify(value, fallback = 'organization') {
  const slug = trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function generateOrganizationPublicId() {
  return `org_${crypto.randomBytes(8).toString('hex')}`
}

function getDefaultOrganization() {
  return db.prepare(`
    SELECT id, name, slug, public_id, is_active, setup_enabled, created_at
    FROM organizations
    ORDER BY id ASC
    LIMIT 1
  `).get()
}

function getOrganizationById(id) {
  return db.prepare(`
    SELECT id, name, slug, public_id, is_active, setup_enabled, created_at
    FROM organizations
    WHERE id = ?
    LIMIT 1
  `).get(id)
}

function findOrganizationByLookup(value) {
  const input = trim(value)
  if (!input) return getDefaultOrganization()

  const normalized = input.toLowerCase()
  return db.prepare(`
    SELECT id, name, slug, public_id, is_active, setup_enabled, created_at
    FROM organizations
    WHERE lower(trim(name)) = ?
       OR lower(trim(slug)) = ?
       OR lower(trim(public_id)) = ?
    LIMIT 1
  `).get(normalized, normalized, normalized) || null
}

function searchOrganizations(query = '') {
  const text = trim(query).toLowerCase()
  if (!text) {
    return db.prepare(`
      SELECT id, name, slug, public_id, is_active, setup_enabled
      FROM organizations
      WHERE is_active = 1
      ORDER BY name COLLATE NOCASE ASC
      LIMIT 8
    `).all()
  }
  const like = `%${text}%`
  return db.prepare(`
    SELECT id, name, slug, public_id, is_active, setup_enabled
    FROM organizations
    WHERE is_active = 1
      AND (
        lower(trim(name)) LIKE ?
        OR lower(trim(slug)) LIKE ?
        OR lower(trim(public_id)) LIKE ?
      )
    ORDER BY
      CASE
        WHEN lower(trim(name)) = ? THEN 0
        WHEN lower(trim(slug)) = ? THEN 1
        WHEN lower(trim(public_id)) = ? THEN 2
        ELSE 3
      END,
      name COLLATE NOCASE ASC
    LIMIT 8
  `).all(like, like, like, text, text, text)
}

function getOrganizationGroup(groupId) {
  if (!Number(groupId || 0)) return null
  return db.prepare(`
    SELECT id, organization_id, name, slug, is_default, is_active, created_at
    FROM organization_groups
    WHERE id = ?
    LIMIT 1
  `).get(Number(groupId))
}

function getDefaultOrganizationGroup(organizationId) {
  const orgId = Number(organizationId || 0)
  if (!orgId) return null
  return db.prepare(`
    SELECT id, organization_id, name, slug, is_default, is_active, created_at
    FROM organization_groups
    WHERE organization_id = ?
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `).get(orgId)
}

function getOrganizationContextForUser(userId) {
  return db.prepare(`
    SELECT
      o.id AS organization_id,
      o.name AS organization_name,
      o.slug AS organization_slug,
      o.public_id AS organization_public_id,
      g.id AS organization_group_id,
      g.name AS organization_group_name,
      g.slug AS organization_group_slug
    FROM users u
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
    WHERE u.id = ?
    LIMIT 1
  `).get(Number(userId || 0))
}

function getPortalPublicPath(organization) {
  const slug = slugify(organization?.slug || organization?.name || 'organization', 'organization')
  return `/${slug}/public`
}

function ensureOrganizationFilesystemLayout(organization) {
  if (!organization?.public_id) return null
  const orgRoot = path.join(DATA_ROOT, 'organizations', organization.public_id)
  const metaRoot = path.join(orgRoot, 'meta')
  const userDataRoot = path.join(orgRoot, 'users')
  fs.mkdirSync(metaRoot, { recursive: true })
  fs.mkdirSync(userDataRoot, { recursive: true })
  const metaFile = path.join(metaRoot, 'organization.json')
  const payload = {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    public_id: organization.public_id,
    generated_at: new Date().toISOString(),
    notes: 'This folder describes the active organization for this server instance. The SQLite database in business-os-data/db/business.db remains the source of truth.',
  }
  try {
    fs.writeFileSync(metaFile, JSON.stringify(payload, null, 2), 'utf8')
  } catch (_) {}
  return {
    orgRoot,
    metaRoot,
    userDataRoot,
    metaFile,
  }
}

module.exports = {
  slugify,
  generateOrganizationPublicId,
  getDefaultOrganization,
  getOrganizationById,
  findOrganizationByLookup,
  searchOrganizations,
  getDefaultOrganizationGroup,
  getOrganizationGroup,
  getOrganizationContextForUser,
  getPortalPublicPath,
  ensureOrganizationFilesystemLayout,
}
