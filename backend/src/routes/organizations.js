'use strict'

const express = require('express')
const { authToken } = require('../middleware')
const {
  getDefaultOrganization,
  searchOrganizations,
  getOrganizationContextForUser,
  getDefaultOrganizationGroup,
  ensureOrganizationFilesystemLayout,
} = require('../organizationContext')

const router = express.Router()

router.get('/bootstrap', (_req, res) => {
  const organization = getDefaultOrganization()
  const storage = organization ? ensureOrganizationFilesystemLayout(organization) : null
  const group = organization ? getDefaultOrganizationGroup(organization.id) : null
  res.json({
    organizationCreationEnabled: false,
    organization,
    defaultGroup: group,
    storage,
  })
})

router.get('/search', (req, res) => {
  const query = String(req.query?.q || '').trim()
  const items = searchOrganizations(query)
  res.json({ items })
})

router.get('/current', authToken, (req, res) => {
  const actor = req.user
  if (!actor?.id) return res.status(401).json({ success: false, error: 'Please sign in again to continue.' })
  const current = getOrganizationContextForUser(actor.id)
  if (!current?.organization_id) {
    return res.status(404).json({ success: false, error: 'Organization context not found.' })
  }
  const storage = ensureOrganizationFilesystemLayout({
    id: current.organization_id,
    name: current.organization_name,
    slug: current.organization_slug,
    public_id: current.organization_public_id,
  })
  res.json({
    organization: {
      id: current.organization_id,
      name: current.organization_name,
      slug: current.organization_slug,
      public_id: current.organization_public_id,
    },
    storage,
    group: current.organization_group_id ? {
      id: current.organization_group_id,
      name: current.organization_group_name,
      slug: current.organization_group_slug,
    } : null,
  })
})

module.exports = router
