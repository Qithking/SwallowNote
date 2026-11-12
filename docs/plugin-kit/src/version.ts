import { readFileSync, writeFileSync } from 'node:fs'

export type BumpLevel = 'major' | 'minor' | 'patch'

/** 解析严格 X.Y.Z 版本号（与市场索引使用的纯 semver 一致） */
export function parseVersion(v: string): { major: number; minor: number; patch: number } {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  if (!m) {
    throw new Error(`非法版本号 '${v}'（期望 X.Y.Z）`)
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** semver bump：patch/minor/major（与 package.sh 的 python semver 行为一致） */
export function bumpVersion(v: string, level: BumpLevel): string {
  const { major, minor, patch } = parseVersion(v)
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major + 1}.0.0`
}

function writeJson(path: string, obj: object): void {
  // ensure_ascii=False + indent 2 + 尾换行，与 package.sh 的 python 写回一致
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n')
}

/** manifest.json：version 为权威来源，同时刷新 publishedAt */
export function syncManifest(manifestPath: string, version: string, publishedAt: string): void {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  manifest.version = version
  manifest.publishedAt = publishedAt
  writeJson(manifestPath, manifest)
}

/** package.json：同步 npm 版本 */
export function syncPackageJson(pkgPath: string, version: string): void {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  pkg.version = version
  writeJson(pkgPath, pkg)
}

/**
 * src-tauri/Cargo.toml：同步 crate 版本（行首 version = "X.Y.Z"，仅首个匹配，
 * 不触碰 [dependencies] 中的缩进行）。
 */
export function syncCargoVersion(cargoTomlPath: string, oldVersion: string, newVersion: string): boolean {
  const src = readFileSync(cargoTomlPath, 'utf-8')
  const pattern = new RegExp(`^(version\\s*=\\s*["'])${escapeRegExp(oldVersion)}(["'])`, 'm')
  if (!pattern.test(src)) {
    process.stderr.write(`  ⚠ Cargo.toml 中未找到 crate 版本 '${oldVersion}' — 保持原样\n`)
    return false
  }
  writeFileSync(cargoTomlPath, src.replace(pattern, `$1${newVersion}$2`))
  return true
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
