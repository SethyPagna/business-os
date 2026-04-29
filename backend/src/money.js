'use strict'

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function roundUpToDecimals(value, decimals = 2) {
  const num = toFiniteNumber(value, 0)
  const factor = 10 ** decimals
  const scaled = num * factor
  const epsilon = 1e-9
  if (num >= 0) return Math.ceil(scaled - epsilon) / factor
  return Math.floor(scaled + epsilon) / factor
}

function normalizePriceValue(value, fallback = 0) {
  return roundUpToDecimals(toFiniteNumber(value, fallback), 2)
}

module.exports = {
  toFiniteNumber,
  roundUpToDecimals,
  normalizePriceValue,
}
