import type { PaywayTransport } from './payway'

// The one place the Worker talks to ABA PayWay. payway.ts builds the signed request and parses the answer; this only carries the bytes, as a
// multipart form (the encoding PayWay documents for its payment-gateway endpoints). Tests inject their own transport and never reach this.
// Nothing here logs or keeps the URL, the body or the response: a failure is a status the caller turns into a fixed reason word.
export const fetchPaywayTransport: PaywayTransport = async ({ url, body }) => {
  const form = new FormData()
  for (const [name, value] of Object.entries(body)) form.append(name, String(value))
  const response = await fetch(url, { method: 'POST', body: form })
  let json: unknown = null
  try { json = await response.json() } catch { json = null }
  return { status: response.status, json }
}
