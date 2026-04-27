'use strict'

const { isAdminControlUser } = require('./middleware')

function normalizeUserId(value) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function canManageOtpTarget(actor, target) {
  const actorId = normalizeUserId(actor?.id)
  const targetId = normalizeUserId(target?.id)
  if (!actorId || !targetId) return false
  if (actorId === targetId) return true
  if (!isAdminControlUser(actor)) return false
  if (isAdminControlUser(target)) return false
  return true
}

function requiresSelfOtpDisablePassword(actor, target, password) {
  const actorId = normalizeUserId(actor?.id)
  const targetId = normalizeUserId(target?.id)
  if (!actorId || !targetId || actorId !== targetId) return false
  return !String(password || '').trim()
}

module.exports = {
  canManageOtpTarget,
  requiresSelfOtpDisablePassword,
}
