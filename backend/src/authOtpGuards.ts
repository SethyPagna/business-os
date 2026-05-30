'use strict'

const { isAdminControlUser } = require('./middleware')

/** @param {unknown} value @returns {number} */
function normalizeUserId(value) {
  const id = Number(value || 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

/** @param {{ id?: unknown } | null | undefined} actor @param {{ id?: unknown } | null | undefined} target @returns {boolean} */
function canManageOtpTarget(actor, target) {
  const actorId = normalizeUserId(actor?.id)
  const targetId = normalizeUserId(target?.id)
  if (!actorId || !targetId) return false
  if (actorId === targetId) return true
  if (!isAdminControlUser(actor)) return false
  if (isAdminControlUser(target)) return false
  return true
}

/** @param {{ id?: unknown } | null | undefined} actor @param {{ id?: unknown } | null | undefined} target @param {unknown} password @returns {boolean} */
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
