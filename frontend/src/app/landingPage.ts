// Owner rule, 15 Nov 2026: managers and employees may open the Dashboard, but an employee (Dashboard view only, no export) keeps
// the landing they had before that ruling. Before it, the Dashboard was not theirs, so the sign-in landing fell through to the
// first page they could open in sidebar order; opening the Dashboard on every sign-in would spend a /dashboard/startup read each
// time. Administrators and managers (who export) land on the Dashboard as before.
//
// Returns the page to move to, or null to stay. It only applies while `active` (from sign-in until the user's first tap or key):
// an employee who later opens the Dashboard on purpose stays there.
export interface LandingBounceInput {
  page: string
  active: boolean
  viewOnlyDashboard: boolean
  navIds: readonly string[]
  canAccessPage: (pageId: string) => boolean
}

export function landingBounceTarget({ page, active, viewOnlyDashboard, navIds, canAccessPage }: LandingBounceInput): string | null {
  if (!active || !viewOnlyDashboard || page !== 'dashboard') return null
  return navIds.find((id) => id !== 'dashboard' && canAccessPage(id)) ?? null
}
