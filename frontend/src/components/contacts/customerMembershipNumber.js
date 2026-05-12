export function generateCustomerMembershipNumber(seed = '') {
  void seed
  const prefix = 'LCMN'
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
  return `${prefix}-${entropy.slice(-8).padStart(8, '0')}`
}
