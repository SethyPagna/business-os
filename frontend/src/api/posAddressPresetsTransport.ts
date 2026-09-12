import { apiFetch, route } from './http.ts'
import type { AddressPresets } from '../utils/addressPresets.ts'

export type PosAddressPresetsResponse = {
  can_manage: boolean
  configured: boolean
  revision: string | null
  presets: AddressPresets
}

export function getPosAddressPresets(): Promise<PosAddressPresetsResponse> {
  // This is a private server-authoritative read: no stale/shared route cache
  // and no local fallback. apiFetch still applies its opaque actor/session
  // guard, but a successful GET must not be misclassified as a write that
  // invalidates the `pos` channel before its caller can publish the result.
  return apiFetch('GET', '/api/pos/address-presets') as Promise<PosAddressPresetsResponse>
}

export function savePosAddressPresets(
  presets: AddressPresets,
  expectedRevision: string | null,
): Promise<PosAddressPresetsResponse> {
  return route(
    'pos:address-presets:save',
    () => apiFetch('PUT', '/api/pos/address-presets', { presets, expected_revision: expectedRevision }),
    null,
    true,
  ) as Promise<PosAddressPresetsResponse>
}
