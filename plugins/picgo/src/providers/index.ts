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

/**
 * Fallback display names for the cloud-storage providers that
 * schema v2 exposed in the settings dialog but whose upload
 * logic is not implemented yet (see `types.ts` note). The
 * Settings tab and toolbar selector call
 * `getProviderDisplayName` on every provider id; without this
 * map the new ids would render as bare English codes like
 * "tencent" / "qiniu" / "minio".
 */
const FALLBACK_DISPLAY_NAMES: Record<string, string> = {
  tencent: '腾讯云 COS',
  aliyun: '阿里云 OSS',
  qiniu: '七牛云',
  upyun: '又拍云',
  minio: 'MinIO',
}

/** Display name for a provider id, with a safe fallback. */
export function getProviderDisplayName(id: string): string {
  return (
    PROVIDERS[id]?.displayName ?? FALLBACK_DISPLAY_NAMES[id] ?? id
  )
}

/** Resolve a provider instance, throwing if the id is unknown. */
export function getProvider(id: string): PicgoProvider {
  const p = PROVIDERS[id]
  if (!p) {
    throw new Error(`PicGo: 未知的图床类型 "${id}"`)
  }
  return p
}
