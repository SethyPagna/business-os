import { apiFetch, route } from './http.ts'
import type { AddressPresets } from '../utils/addressPresets.ts'

export type PosAddressPresetsResponse = {
  can_manage: boolean
  configured: boolean
  revision: string | null
  presets: AddressPresets
}

export function getPosAddressPresets(): Promise<PosAddressPresetsResponse> {
  return route(
    'pos:address-presets:get',
    () => apiFetch('GET', '/api/pos/address-presets'),
    null,
    true,
  ) as Promise<PosAddressPresetsResponse>
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
