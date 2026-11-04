import { cachedJsonResponse } from './cache'
import type { CacheIdentity } from './cacheKey'
import { canSeeFullPhones, projectPhones, type PhoneActor } from './phoneAccess'

// A shared server cache that holds a body with phone numbers in it (CACHE-LIFECYCLE R1.5, owner ruling 2 Nov 2026).
//
// The key carries the full-phone grant (the identity's scope, lib/cacheKey.ts) and the stored body is already right for that grant: an account without it
// reads and writes only the `phone-masked` variant, which never holds a full number; the full variant is read and
// written only by holders. So no layer needs to remember to mask on the way out (lib/phoneMaskMiddleware.ts still
// does, as a second wall), and a body one kind of account warmed can never be served to the other. Holders keep the
// exact keys-per-request and the exact bodies they had; the masked variant is created only when an account without the
// grant asks for that shape, so no entry exists that nobody reads.
export type PhoneCacheVariant = 'phone-full' | 'phone-masked'

export function phoneCacheVariant(user: PhoneActor): PhoneCacheVariant {
  return canSeeFullPhones(user) ? 'phone-full' : 'phone-masked'
}

// The caller's identity (cacheIdentity(c)) with the full-phone grant folded into its scope, so no caller can forget the grant: an identity
// that already names a scope keeps it and the variant follows it. No identity = no safe key (the producer runs, nothing is stored).
export function phoneCacheIdentity(identity: CacheIdentity | undefined, user: PhoneActor): CacheIdentity | undefined {
  if (!identity) return undefined
  const variant = phoneCacheVariant(user)
  return { ...identity, scope: identity.scope === 'neutral' ? variant : `${identity.scope}|${variant}` }
}

export function cachedPhoneJson<T>(
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  user: PhoneActor,
  version: string,
  ttlSeconds: number,
  producer: () => Promise<T> | T,
  identity?: CacheIdentity,
): Promise<T> {
  return cachedJsonResponse(request, ctx, version, ttlSeconds, async () => projectPhones(await producer(), user), phoneCacheIdentity(identity, user))
}
