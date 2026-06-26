/**
 * Provider registry — the uploader looks up providers here by id.
 *
 * Adding a new provider is a matter of dropping a file in
 * `./<id>.ts` exporting a `PicgoProvider` and adding it to the
 * `PROVIDERS` map.
 */
import type { PicgoProvider } from './types'
import { smmsProvider } from './smms'
import { imgurProvider } from './imgur'
import { githubProvider } from './github'
import { customProvider } from './custom'

export const PROVIDERS: Record<string, PicgoProvider> = {
  smms: smmsProvider,
  imgur: imgurProvider,
  github: githubProvider,
  custom: customProvider,
}

/** Display name for a provider id, with a safe fallback. */
export function getProviderDisplayName(id: string): string {
  return PROVIDERS[id]?.displayName ?? id
}

/** Resolve a provider instance, throwing if the id is unknown. */
export function getProvider(id: string): PicgoProvider {
  const p = PROVIDERS[id]
  if (!p) {
    throw new Error(`PicGo: 未知的图床类型 "${id}"`)
  }
  return p
}
