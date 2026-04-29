export function toFiniteNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function roundUpToDecimals(value, decimals = 2) {
  const num = toFiniteNumber(value, 0)
  const factor = 10 ** decimals
  const scaled = num * factor
  const epsilon = 1e-9
  if (num >= 0) return Math.ceil(scaled - epsilon) / factor
  return Math.floor(scaled + epsilon) / factor
}

export function normalizePriceValue(value, fallback = 0) {
  return roundUpToDecimals(toFiniteNumber(value, fallback), 2)
}

export function formatPriceNumber(value) {
  return normalizePriceValue(value, 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
