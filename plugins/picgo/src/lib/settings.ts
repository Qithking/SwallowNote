/**
 * Centralized settings resolver.
 *
 * The host hands us a `Record<string, unknown>` from
 * `getAllSettings()`. We merge it on top of the schema defaults
 * defined in `settings.json` to produce a fully-typed
 * {@link AllSettings}. This way downstream code never has to
 * deal with `undefined` fields.
 */
import type { AllSettings, RawSettings } from '../types'

const DEFAULTS: AllSettings = {
  defaultProvider: 'smms',
  uploadFormat: 'original',
  maxFileSizeMB: 10,
  filenameStrategy: 'original',
  linkFormat: 'markdown',
  enableHistory: true,
  historyRetention: 200,

  smmsToken: '',

  imgurClientId: '',

  githubToken: '',
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  githubPathPrefix: 'images/',

  // Tencent COS
  tencentSecretId: '',
  tencentSecretKey: '',
  tencentRegion: 'ap-guangzhou',
  tencentBucket: '',
  tencentProtocol: 'https',
  tencentKeyPrefix: 'images/',

  // Aliyun OSS
  aliyunAccessKeyId: '',
  aliyunAccessKeySecret: '',
  aliyunRegion: 'oss-cn-hangzhou',
  aliyunBucket: '',
  aliyunEndpoint: '',
  aliyunKeyPrefix: 'images/',

  // Qiniu
  qiniuAccessKey: '',
  qiniuSecretKey: '',
  qiniuBucket: '',
  qiniuZone: 'z0',
  qiniuDomain: '',
  qiniuKeyPrefix: 'images/',

  // UPYUN
  upyunOperator: '',
  upyunPassword: '',
  upyunBucket: '',
  upyunDomain: '',
  upyunKeyPrefix: '',

  // MinIO
  minioEndpoint: '',
  minioAccessKey: '',
  minioSecretKey: '',
  minioBucket: '',
  minioRegion: 'us-east-1',
  minioUseSsl: false,
  minioPathStyle: true,
  minioKeyPrefix: 'images/',

  customEndpoint: '',
  customMethod: 'POST',
  customHeaders: '',
  customBodyTemplate: '',
  customResponseUrlPath: 'data.url',
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function pickNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function pickProviderId(
  value: unknown,
  fallback: AllSettings['defaultProvider']
): AllSettings['defaultProvider'] {
  const v = pickString(value, fallback)
  // Schema v2 added the cloud-storage providers. They are kept
  // here so the type stays in sync; the upload pipeline is not
  // wired up for them yet (see types.ts note).
  if (
    v === 'smms' ||
    v === 'imgur' ||
    v === 'github' ||
    v === 'tencent' ||
    v === 'aliyun' ||
    v === 'qiniu' ||
    v === 'upyun' ||
    v === 'minio' ||
    v === 'custom'
  ) {
    return v
  }
  return fallback
}

function pickUploadFormat(
  value: unknown,
  fallback: AllSettings['uploadFormat']
): AllSettings['uploadFormat'] {
  const v = pickString(value, fallback)
  if (v === 'original' || v === 'webp' || v === 'jpg' || v === 'png') return v
  return fallback
}

function pickFilenameStrategy(
  value: unknown,
  fallback: AllSettings['filenameStrategy']
): AllSettings['filenameStrategy'] {
  const v = pickString(value, fallback)
  if (v === 'original' || v === 'uuid' || v === 'timestamp') return v
  return fallback
}

function pickLinkFormat(
  value: unknown,
  fallback: AllSettings['linkFormat']
): AllSettings['linkFormat'] {
  const v = pickString(value, fallback)
  if (v === 'markdown' || v === 'html' || v === 'url') return v
  return fallback
}

function pickCustomMethod(
  value: unknown,
  fallback: AllSettings['customMethod']
): AllSettings['customMethod'] {
  const v = String(value ?? fallback).toUpperCase()
  if (v === 'POST' || v === 'PUT') return v
  return fallback
}

/**
 * Merge a raw settings map (from the host) on top of the
 * schema defaults. Unrecognised keys are ignored.
 */
export function resolveSettings(raw: RawSettings | null | undefined): AllSettings {
  const r: RawSettings = raw ?? {}
  return {
    defaultProvider: pickProviderId(r.defaultProvider, DEFAULTS.defaultProvider),
    uploadFormat: pickUploadFormat(r.uploadFormat, DEFAULTS.uploadFormat),
    maxFileSizeMB: pickNumber(r.maxFileSizeMB, DEFAULTS.maxFileSizeMB),
    filenameStrategy: pickFilenameStrategy(
      r.filenameStrategy,
      DEFAULTS.filenameStrategy
    ),
    linkFormat: pickLinkFormat(r.linkFormat, DEFAULTS.linkFormat),
    enableHistory: pickBoolean(r.enableHistory, DEFAULTS.enableHistory),
    historyRetention: pickNumber(r.historyRetention, DEFAULTS.historyRetention),

    smmsToken: pickString(r.smmsToken, DEFAULTS.smmsToken ?? ''),

    imgurClientId: pickString(r.imgurClientId, DEFAULTS.imgurClientId ?? ''),

    githubToken: pickString(r.githubToken, DEFAULTS.githubToken ?? ''),
    githubOwner: pickString(r.githubOwner, DEFAULTS.githubOwner ?? ''),
    githubRepo: pickString(r.githubRepo, DEFAULTS.githubRepo ?? ''),
    githubBranch: pickString(r.githubBranch, DEFAULTS.githubBranch ?? 'main'),
    githubPathPrefix: pickString(
      r.githubPathPrefix,
      DEFAULTS.githubPathPrefix ?? 'images/'
    ),

    customEndpoint: pickString(r.customEndpoint, DEFAULTS.customEndpoint ?? ''),
    customMethod: pickCustomMethod(r.customMethod, DEFAULTS.customMethod),
    customHeaders: pickString(r.customHeaders, DEFAULTS.customHeaders ?? ''),
    customBodyTemplate: pickString(
      r.customBodyTemplate,
      DEFAULTS.customBodyTemplate ?? ''
    ),
    customResponseUrlPath: pickString(
      r.customResponseUrlPath,
      DEFAULTS.customResponseUrlPath ?? 'data.url'
    ),

    // Tencent COS
    tencentSecretId: pickString(r.tencentSecretId, DEFAULTS.tencentSecretId),
    tencentSecretKey: pickString(r.tencentSecretKey, DEFAULTS.tencentSecretKey),
    tencentRegion: pickString(r.tencentRegion, DEFAULTS.tencentRegion),
    tencentBucket: pickString(r.tencentBucket, DEFAULTS.tencentBucket),
    tencentProtocol: (() => {
      const v = pickString(r.tencentProtocol, DEFAULTS.tencentProtocol)
      return v === 'http' ? 'http' : 'https'
    })(),
    tencentKeyPrefix: pickString(r.tencentKeyPrefix, DEFAULTS.tencentKeyPrefix),

    // Aliyun OSS
    aliyunAccessKeyId: pickString(r.aliyunAccessKeyId, DEFAULTS.aliyunAccessKeyId),
    aliyunAccessKeySecret: pickString(
      r.aliyunAccessKeySecret,
      DEFAULTS.aliyunAccessKeySecret
    ),
    aliyunRegion: pickString(r.aliyunRegion, DEFAULTS.aliyunRegion),
    aliyunBucket: pickString(r.aliyunBucket, DEFAULTS.aliyunBucket),
    aliyunEndpoint: pickString(r.aliyunEndpoint, DEFAULTS.aliyunEndpoint),
    aliyunKeyPrefix: pickString(r.aliyunKeyPrefix, DEFAULTS.aliyunKeyPrefix),

    // Qiniu
    qiniuAccessKey: pickString(r.qiniuAccessKey, DEFAULTS.qiniuAccessKey),
    qiniuSecretKey: pickString(r.qiniuSecretKey, DEFAULTS.qiniuSecretKey),
    qiniuBucket: pickString(r.qiniuBucket, DEFAULTS.qiniuBucket),
    qiniuZone: (() => {
      const v = pickString(r.qiniuZone, DEFAULTS.qiniuZone)
      if (v === 'z0' || v === 'z1' || v === 'z2' || v === 'na0' || v === 'as0') {
        return v
      }
      return DEFAULTS.qiniuZone
    })(),
    qiniuDomain: pickString(r.qiniuDomain, DEFAULTS.qiniuDomain),
    qiniuKeyPrefix: pickString(r.qiniuKeyPrefix, DEFAULTS.qiniuKeyPrefix),

    // UPYUN
    upyunOperator: pickString(r.upyunOperator, DEFAULTS.upyunOperator),
    upyunPassword: pickString(r.upyunPassword, DEFAULTS.upyunPassword),
    upyunBucket: pickString(r.upyunBucket, DEFAULTS.upyunBucket),
    upyunDomain: pickString(r.upyunDomain, DEFAULTS.upyunDomain),
    upyunKeyPrefix: pickString(r.upyunKeyPrefix, DEFAULTS.upyunKeyPrefix),

    // MinIO
    minioEndpoint: pickString(r.minioEndpoint, DEFAULTS.minioEndpoint),
    minioAccessKey: pickString(r.minioAccessKey, DEFAULTS.minioAccessKey),
    minioSecretKey: pickString(r.minioSecretKey, DEFAULTS.minioSecretKey),
    minioBucket: pickString(r.minioBucket, DEFAULTS.minioBucket),
    minioRegion: pickString(r.minioRegion, DEFAULTS.minioRegion),
    minioUseSsl: pickBoolean(r.minioUseSsl, DEFAULTS.minioUseSsl),
    minioPathStyle: pickBoolean(r.minioPathStyle, DEFAULTS.minioPathStyle),
    minioKeyPrefix: pickString(r.minioKeyPrefix, DEFAULTS.minioKeyPrefix),
  }
}

/**
 * Lightweight per-provider "is configured" check used by the
 * Settings tab to show a quick readiness summary.
 */
export function isProviderConfigured(
  id: AllSettings['defaultProvider'],
  s: AllSettings
): boolean {
  switch (id) {
    case 'smms':
      // SM.MS supports anonymous uploads, so always considered
      // "configured". The user can still paste a token in.
      return true
    case 'imgur':
      return s.imgurClientId.trim().length > 0
    case 'github':
      return (
        s.githubToken.trim().length > 0 &&
        s.githubOwner.trim().length > 0 &&
        s.githubRepo.trim().length > 0
      )
    case 'tencent':
      return (
        s.tencentSecretId.trim().length > 0 &&
        s.tencentSecretKey.trim().length > 0 &&
        s.tencentRegion.trim().length > 0 &&
        s.tencentBucket.trim().length > 0
      )
    case 'aliyun':
      return (
        s.aliyunAccessKeyId.trim().length > 0 &&
        s.aliyunAccessKeySecret.trim().length > 0 &&
        s.aliyunRegion.trim().length > 0 &&
        s.aliyunBucket.trim().length > 0
      )
    case 'qiniu':
      return (
        s.qiniuAccessKey.trim().length > 0 &&
        s.qiniuSecretKey.trim().length > 0 &&
        s.qiniuBucket.trim().length > 0 &&
        s.qiniuDomain.trim().length > 0
      )
    case 'upyun':
      return (
        s.upyunOperator.trim().length > 0 &&
        s.upyunPassword.trim().length > 0 &&
        s.upyunBucket.trim().length > 0 &&
        s.upyunDomain.trim().length > 0
      )
    case 'minio':
      return (
        s.minioEndpoint.trim().length > 0 &&
        s.minioAccessKey.trim().length > 0 &&
        s.minioSecretKey.trim().length > 0 &&
        s.minioBucket.trim().length > 0
      )
    case 'custom':
      return (
        s.customEndpoint.trim().length > 0 &&
        s.customBodyTemplate.trim().length > 0
      )
    default:
      return false
  }
}
