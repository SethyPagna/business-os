import type { PaywayTransport } from './payway'

// The one place the Worker talks to ABA PayWay. payway.ts builds the signed request and parses the answer; this only carries the bytes, as a
// multipart form (the encoding PayWay documents for its payment-gateway endpoints). Tests inject their own transport and never reach this.
// Nothing here logs or keeps the URL, the body or the response: a failure is a status the caller turns into a fixed reason word.
export const fetchPaywayTransport: PaywayTransport = async ({ url, body, timeoutMs }) => {
  const form = new FormData()
  for (const [name, value] of Object.entries(body)) form.append(name, String(value))
  // A call that never answers is cut off (the caller turns the abort into `transport_failed`): it would otherwise hold a callback, a customer's
  // request or a whole cron tick, and the sweep loop runs its payments one after another.
  const response = await fetch(url, { method: 'POST', body: form, ...(timeoutMs && timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}) })
  let json: unknown = null
  try { json = await response.json() } catch { json = null }
  return { status: response.status, json }
}
