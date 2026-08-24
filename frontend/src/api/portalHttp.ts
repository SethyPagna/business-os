import { getSyncServerUrl } from './http.ts'

export function getPortalBaseUrl(): string {
  const browserOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : ''
  return (browserOrigin || getSyncServerUrl() || '').replace(/\/$/, '')
}

export async function fetchJsonWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
