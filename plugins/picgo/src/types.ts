/**
 * PicGo plugin shared types.
 *
 * The SDK types are re-exported for convenience so consumers of
 * this plugin (UI components, lib helpers) can import everything
 * from a single module.
 */
export type {
  PluginManifest,
  PluginPanelProps,
  ToolbarButtonProps,
  PluginStorage,
  PluginEventBus,
  PluginEvent,
  PluginEventPayloadMap,
  PluginPermission,
  PluginContext,
  HostOverrides,
} from '@swallow-note/plugin-sdk'

// ── Settings ────────────────────────────────────────────────────────────

export type LinkFormat = 'markdown' | 'html' | 'url'
export type UploadFormat = 'original' | 'webp' | 'jpg' | 'png'
export type FilenameStrategy = 'original' | 'uuid' | 'timestamp'
export type ProviderId =
  | 'smms'
  | 'imgur'
  | 'github'
  | 'tencent'
  | 'aliyun'
  | 'qiniu'
  | 'upyun'
  | 'minio'
  | 'custom'
export type CustomMethod = 'POST' | 'PUT'

/**
 * Strongly-typed snapshot of every persisted setting key the
 * plugin reads. The host bridges the values to a flat
 * `Record<string, unknown>`; this interface documents the shape
 * the rest of the plugin assumes.
 *
 * Defaults mirror `settings.json`; `getAllSettings` should be
 * merged with these defaults before being used to drive upload
 * logic so a half-configured user doesn't crash on `undefined`.
 *
 * Note: schema version 2 added five cloud-storage providers
 * (Tencent COS / Aliyun OSS / Qiniu / UPYUN / MinIO). They are
 * exposed in the settings dialog only; the upload logic for
 * these providers is not implemented yet — selecting one and
 * uploading will fail until the corresponding provider file is
 * dropped into `src/providers/<id>.ts` and registered in
 * `src/providers/index.ts`.
 */
export interface AllSettings {
  defaultProvider: ProviderId
  uploadFormat: UploadFormat
  maxFileSizeMB: number
  filenameStrategy: FilenameStrategy
  linkFormat: LinkFormat
  enableHistory: boolean
  historyRetention: number

  // SM.MS
  smmsToken?: string

  // Imgur
  imgurClientId: string

  // GitHub
  githubToken: string
  githubOwner: string
  githubRepo: string
  githubBranch: string
  githubPathPrefix: string

  // Tencent COS
  tencentSecretId: string
  tencentSecretKey: string
  tencentRegion: string
  tencentBucket: string
  tencentProtocol: 'https' | 'http'
  tencentKeyPrefix: string

  // Aliyun OSS
  aliyunAccessKeyId: string
  aliyunAccessKeySecret: string
  aliyunRegion: string
  aliyunBucket: string
  aliyunEndpoint: string
  aliyunKeyPrefix: string

  // Qiniu
  qiniuAccessKey: string
  qiniuSecretKey: string
  qiniuBucket: string
  qiniuZone: 'z0' | 'z1' | 'z2' | 'na0' | 'as0'
  qiniuDomain: string
  qiniuKeyPrefix: string

  // UPYUN
  upyunOperator: string
  upyunPassword: string
  upyunBucket: string
  upyunDomain: string
  upyunKeyPrefix: string

  // MinIO (S3-compatible)
  minioEndpoint: string
  minioAccessKey: string
  minioSecretKey: string
  minioBucket: string
  minioRegion: string
  minioUseSsl: boolean
  minioPathStyle: boolean
  minioKeyPrefix: string

  // Custom
  customEndpoint: string
  customMethod: CustomMethod
  customHeaders: string
  customBodyTemplate: string
  customResponseUrlPath: string
}

/**
 * Partial settings read from the host — every field is optional
 * until the user fills them in. {@link resolveSettings} applies
 * the schema defaults to produce a full {@link AllSettings}.
 */
export type RawSettings = Partial<AllSettings>

// ── Upload result ───────────────────────────────────────────────────────

/**
 * Canonical record of a successful upload. This is the shape
 * stored in plugin storage under the `picgo-history` key.
 */
export interface UploadResult {
  url: string
  provider: ProviderId | string
  filename: string
  size: number
  uploadedAt: string
  /** Optional content-type, useful for the history tab thumbnail. */
  mime?: string
  /** Thumbnail data-URL or remote preview URL (best-effort). */
  thumbnail?: string
}

// ── Provider contract ───────────────────────────────────────────────────

import type { PicgoProvider } from './providers/types'
export type { PicgoProvider }

/** Per-upload progress callback, fired by the uploader pipeline. */
export type UploadProgressHandler = (state: {
  loaded: number
  total: number
  percent: number
}) => void
