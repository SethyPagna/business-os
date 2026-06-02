import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

export function getDashboard(): Promise<unknown> {
  return route(
    'dashboard:get',
    () => apiFetch('GET', '/api/dashboard'),
  )
}

export function getAnalytics(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `analytics:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/analytics', query)),
  )
}

export function getDashboardStartup(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `dashboard:startup:${query}`,
    () => apiFetch('GET', appendQuery('/api/dashboard/startup', query)),
  )
}
