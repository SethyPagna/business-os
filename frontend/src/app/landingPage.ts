import { resolveAdminLandingPage } from './pathRouting.ts'

// Owner rule, 15 Nov 2026: managers and employees may open the Dashboard, but an employee (Dashboard view only, no export) keeps
// the landing they had before that ruling. Before it, the Dashboard was not theirs, so the sign-in landing fell through to the
// first page they could open in sidebar order; opening the Dashboard on every sign-in would spend a /dashboard/startup read each
// time. Administrators and managers (who export) land on the Dashboard as before.
//
// The decision is made where the landing is computed, for '/' with no hub page in the URL, so the Dashboard is never the active page
// for that account and no second rule has to move it off again. A deep link to /dashboard and a tap on Dashboard are not landings.
export interface RootLandingInput {
  // settings.default_landing_page, raw
  settingValue: unknown
  // can open the Dashboard but not export it
  viewOnlyDashboard: boolean
  // sidebar order
  navIds: readonly string[]
  canAccessPage: (pageId: string) => boolean
}

export function resolveRootLanding({ settingValue, viewOnlyDashboard, navIds, canAccessPage }: RootLandingInput): string {
  const base = resolveAdminLandingPage(settingValue)
  if (base !== 'dashboard' || !viewOnlyDashboard) return base
  return navIds.find((id) => id !== 'dashboard' && canAccessPage(id)) ?? 'dashboard'
}

export interface RootLandingStateInput extends RootLandingInput {
  // the landing was already applied for this sign-in
  settled: boolean
  // the page the shell holds now
  statePage: string
}

export interface RootLandingState {
  // still to be applied: the page to show and request is the landing, whatever the shell holds
  pending: boolean
  // the page the URL asks for at '/'
  requested: string
  // the page to render
  shown: string
}

// Only a Dashboard-view-only account has a landing that differs from the plain URL rule, and only until it is applied once: after
// that a Dashboard it opens on purpose (its path is also '/') must stay.
export function resolveRootLandingState(input: RootLandingStateInput): RootLandingState {
  const target = resolveRootLanding(input)
  if (!input.viewOnlyDashboard) return { pending: false, requested: target, shown: input.statePage }
  if (!input.settled) return { pending: true, requested: target, shown: target }
  return { pending: false, requested: input.statePage, shown: input.statePage }
}
