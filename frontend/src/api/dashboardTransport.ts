import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'

export function getDashboard(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params, { skipEmpty: false })
  return route(
    `dashboard:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/dashboard', query)),
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
