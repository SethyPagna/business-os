const CUSTOMER_MEMBERSHIP_PREFIX = 'LCMN'
const MEMBERSHIP_ENTROPY_LENGTH = 8

export function generateCustomerMembershipNumber(seed = ''): string {
  void seed
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
  return `${CUSTOMER_MEMBERSHIP_PREFIX}-${entropy.slice(-MEMBERSHIP_ENTROPY_LENGTH).padStart(MEMBERSHIP_ENTROPY_LENGTH, '0')}`
}
