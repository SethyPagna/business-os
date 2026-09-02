import { apiFetch, route } from './http.ts'

export type TelegramStatus = { configured: boolean; connected: boolean; enabled: boolean }

export function getTelegramStatus(): Promise<TelegramStatus> {
  return apiFetch('GET', '/api/telegram/status') as Promise<TelegramStatus>
}

export function sendTelegramTest(): Promise<{ success: boolean }> {
  return route('telegram:test', () => apiFetch('POST', '/api/telegram/test', {}), null, true) as Promise<{ success: boolean }>
}

export function sendTelegramTodaySummary(): Promise<{ success: boolean }> {
  return route('telegram:today-summary', () => apiFetch('POST', '/api/telegram/today-summary', {}), null, true) as Promise<{ success: boolean }>
}
