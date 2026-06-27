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
  // 仅接受已实现上传逻辑的 4 个提供商；其余 id 一律回退到默认值。
  if (v === 'smms' || v === 'imgur' || v === 'github' || v === 'custom') {
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
    case 'custom':
      return (
        s.customEndpoint.trim().length > 0 &&
        s.customBodyTemplate.trim().length > 0
      )
    default:
      return false
  }
}
