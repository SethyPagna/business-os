let syncServerUrl = ''
let syncToken = ''

export function getSyncServerUrl(): string {
  return syncServerUrl
}

export function getSyncToken(): string {
  return syncToken
}

export function setSyncServerUrl(url: unknown): void {
  syncServerUrl = String(url || '').trim().replace(/\/$/, '')
}

export function setSyncToken(token: unknown): void {
  syncToken = String(token || '').trim()
}
