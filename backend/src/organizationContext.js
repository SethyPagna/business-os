'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { db } = require('./database')
const { STORAGE_ROOT, DATA_ROOT, DB_PATH, UPLOADS_PATH } = require('./config')
const { isSamePath, isSubPath, summarizeDataRoot } = require('./dataPath')

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

function getOrganizationFilesystemLayout(organization) {
  if (!organization?.public_id) return null
  const orgRoot = path.join(STORAGE_ROOT, 'organizations', organization.public_id)
  return {
    orgRoot,
    metaRoot: path.join(orgRoot, 'meta'),
    userDataRoot: path.join(orgRoot, 'users'),
    databaseRoot: path.join(orgRoot, 'db'),
    uploadsRoot: path.join(orgRoot, 'uploads'),
    importsRoot: path.join(orgRoot, 'imports'),
    exportsRoot: path.join(orgRoot, 'exports'),
    backupsRoot: path.join(orgRoot, 'backups'),
    logsRoot: path.join(orgRoot, 'logs'),
    tempRoot: path.join(orgRoot, 'tmp'),
  }
}

function ensureOrganizationFilesystemLayout(organization) {
  const layout = getOrganizationFilesystemLayout(organization)
  if (!layout) return null
  Object.values(layout).forEach((folderPath) => {
    if (folderPath === layout.orgRoot || String(folderPath).startsWith(layout.orgRoot + path.sep)) {
      fs.mkdirSync(folderPath, { recursive: true })
    }
  })
  const metaFile = path.join(layout.metaRoot, 'organization.json')
  const readmeFile = path.join(layout.metaRoot, 'README.txt')
  const payload = {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    public_id: organization.public_id,
    generated_at: new Date().toISOString(),
    portal_public_path: getPortalPublicPath(organization),
    runtime_source_of_truth: {
      storage_root: STORAGE_ROOT,
      runtime_data_root: DATA_ROOT,
      db_path: DB_PATH,
      uploads_path: UPLOADS_PATH,
    },
    organization_layout: {
      org_root: layout.orgRoot,
      meta_root: layout.metaRoot,
      users_root: layout.userDataRoot,
      database_root: layout.databaseRoot,
      uploads_root: layout.uploadsRoot,
      imports_root: layout.importsRoot,
      exports_root: layout.exportsRoot,
      backups_root: layout.backupsRoot,
      logs_root: layout.logsRoot,
      temp_root: layout.tempRoot,
    },
    notes: [
      'This organization folder is the canonical layout target for multi-business storage.',
      'The current server may still be running from the legacy shared runtime root listed above.',
      'Backups, imports, exports, uploads, and future per-organization runtime files belong under this folder.',
    ],
  }
  try {
    fs.writeFileSync(metaFile, JSON.stringify(payload, null, 2), 'utf8')
  } catch (_) {}
  try {
    fs.writeFileSync(
      readmeFile,
      [
        `Organization: ${organization.name}`,
        `Public ID: ${organization.public_id}`,
        '',
        'Purpose:',
        '- Keep organization-scoped files grouped together for future multi-business hosting.',
        '- Provide a stable migration target away from the legacy shared runtime root.',
        '',
        `Current live database: ${DB_PATH}`,
        `Current live uploads: ${UPLOADS_PATH}`,
      ].join('\r\n'),
      'utf8',
    )
  } catch (_) {}
  return {
    ...layout,
    metaFile,
    readmeFile,
  }
}

function getOrganizationStorageStatus(organization) {
  const layout = getOrganizationFilesystemLayout(organization)
  if (!layout) return null

  const organizationDataRoot = path.dirname(layout.databaseRoot)
  const runtimeInsideOrganization = isSamePath(layout.orgRoot, DATA_ROOT)
  const databaseAligned = isSamePath(DB_PATH, path.join(layout.databaseRoot, path.basename(DB_PATH)))
  const uploadsAligned = isSamePath(UPLOADS_PATH, layout.uploadsRoot)

  return {
    organizationPublicId: organization.public_id,
    organizationRoot: layout.orgRoot,
    storageRoot: STORAGE_ROOT,
    recommendedDataRoot: organizationDataRoot,
    runtimeDataRoot: DATA_ROOT,
    runtimeDbPath: DB_PATH,
    runtimeUploadsPath: UPLOADS_PATH,
    runtimeInsideOrganization,
    databaseAligned,
    uploadsAligned,
    fullyAligned: runtimeInsideOrganization && databaseAligned && uploadsAligned,
    runtimeSummary: summarizeDataRoot(DATA_ROOT),
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
  getOrganizationFilesystemLayout,
  ensureOrganizationFilesystemLayout,
  getOrganizationStorageStatus,
}
