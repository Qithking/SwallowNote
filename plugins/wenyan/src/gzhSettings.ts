/**
 * Centralized settings resolver for the 公众号 push feature.
 *
 * The host hands us a `Record<string, unknown>` from `getAllSettings()`.
 * We merge it on top of the schema defaults defined in `settings.json`
 * to produce a fully-typed {@link GzhSettings}. This way downstream
 * code never has to deal with `undefined` fields.
 *
 * Mirrors the picgo plugin's `resolveSettings` pattern.
 */

/** Typed view of all 公众号 push settings. Keys match `settings.json`. */
export interface GzhSettings {
  /** 公众号 AppID */
  gzhAppId: string
  /** 公众号 AppSecret */
  gzhAppSecret: string
  /** 默认作者名 */
  gzhDefaultAuthor: string
  /** 封面图素材 media_id */
  gzhDefaultThumbMediaId: string
  /** 默认摘要（120字以内） */
  gzhDefaultDigest: string
  /** 「阅读原文」链接 */
  gzhContentSourceUrl: string
  /** 是否开启评论 */
  gzhNeedOpenComment: boolean
  /** 是否仅粉丝可评论 */
  gzhOnlyFansCanComment: boolean
}

const DEFAULTS: GzhSettings = {
  gzhAppId: '',
  gzhAppSecret: '',
  gzhDefaultAuthor: '',
  gzhDefaultThumbMediaId: '',
  gzhDefaultDigest: '',
  gzhContentSourceUrl: '',
  gzhNeedOpenComment: false,
  gzhOnlyFansCanComment: false,
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

/**
 * Merge a raw settings map (from the host) on top of the schema defaults.
 * Unrecognised keys are ignored.
 */
export function resolveGzhSettings(
  raw: Record<string, unknown> | null | undefined
): GzhSettings {
  const r: Record<string, unknown> = raw ?? {}
  return {
    gzhAppId: pickString(r.gzhAppId, DEFAULTS.gzhAppId),
    gzhAppSecret: pickString(r.gzhAppSecret, DEFAULTS.gzhAppSecret),
    gzhDefaultAuthor: pickString(r.gzhDefaultAuthor, DEFAULTS.gzhDefaultAuthor),
    gzhDefaultThumbMediaId: pickString(
      r.gzhDefaultThumbMediaId,
      DEFAULTS.gzhDefaultThumbMediaId
    ),
    gzhDefaultDigest: pickString(r.gzhDefaultDigest, DEFAULTS.gzhDefaultDigest),
    gzhContentSourceUrl: pickString(
      r.gzhContentSourceUrl,
      DEFAULTS.gzhContentSourceUrl
    ),
    gzhNeedOpenComment: pickBoolean(r.gzhNeedOpenComment, DEFAULTS.gzhNeedOpenComment),
    gzhOnlyFansCanComment: pickBoolean(
      r.gzhOnlyFansCanComment,
      DEFAULTS.gzhOnlyFansCanComment
    ),
  }
}

/**
 * Quick "is configured" check used by the push button to decide
 * whether to open the push dialog or prompt the user to fill in
 * settings first.
 */
export function isGzhConfigured(s: GzhSettings): boolean {
  return s.gzhAppId.trim().length > 0 && s.gzhAppSecret.trim().length > 0
}
