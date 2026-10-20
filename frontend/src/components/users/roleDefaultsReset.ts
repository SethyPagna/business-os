// "Reset to ... defaults" is offered on the two seeded, non-admin roles only. Admin is rewritten by the Worker at
// startup, and a custom role has no seeded definition to return to. The caller adds the admin-only gate.
export type ResettableRoleCode = 'employee' | 'manager'

export function resettableRoleCode(role: { code?: unknown } | null | undefined): ResettableRoleCode | null {
  const code = String(role?.code ?? '').trim().toLowerCase()
  return code === 'employee' || code === 'manager' ? code : null
}
