import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCmd } from './exec.js'

export interface SignResult {
  /** zip 的 ed25519 签名 base64；空串 = 密钥缺失跳过签名 */
  signatureB64: string
  /** 公钥 base64（随 repo.json 顶层分发）；空串同上 */
  pubkeyB64: string
}

/** kit 包根目录（dist/sign.js → 上一级） */
const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 定位 SwallowNote 宿主仓库根：优先 SWALLOWNOTE_REPO_ROOT 环境变量，
 * 否则按 kit 自身位置（<repo>/docs/plugin-kit）向上推两级。
 * 签名工具是宿主仓库的 cargo example，必须用宿主的 src-tauri/Cargo.toml。
 */
export function resolveHostRepoRoot(): string {
  if (process.env.SWALLOWNOTE_REPO_ROOT) {
    return resolve(process.env.SWALLOWNOTE_REPO_ROOT)
  }
  return resolve(KIT_ROOT, '..', '..')
}

/**
 * 对插件 zip 做 ed25519 签名 —— 调用方式平移自 plugins/sign-common.sh：
 *   cargo run --quiet --manifest-path <repo>/src-tauri/Cargo.toml --example sign_plugin -- sign <zip>
 * 签名密钥查找由该工具自行处理（SWALLOWNOTE_PLUGIN_SIGNING_KEY 环境变量，
 * 或自 cwd 向上寻找 plugins/.signing-key）。
 *
 * 与 sign-common.sh 一致：密钥缺失/工具失败不视为打包失败，返回空签名
 * （未签名 zip 仍可本地拖拽安装，只是过不了市场校验）。
 */
export function signZip(zipPath: string, hostRepoRoot = resolveHostRepoRoot()): SignResult {
  const cargoToml = join(hostRepoRoot, 'src-tauri', 'Cargo.toml')
  const tool = ['run', '--quiet', '--manifest-path', cargoToml, '--example', 'sign_plugin', '--']

  const sign = runCmd('cargo', [...tool, 'sign', zipPath], { stdio: 'pipe' })
  if (sign.status !== 0 || !sign.stdout.trim()) {
    process.stderr.write(
      '  ⚠ 未找到签名密钥或签名工具不可用（SWALLOWNOTE_PLUGIN_SIGNING_KEY / plugins/.signing-key），已跳过签名\n'
    )
    process.stderr.write('  ⚠ 未签名 zip 无法通过市场安装校验，仍可本地拖拽安装\n')
    return { signatureB64: '', pubkeyB64: '' }
  }

  const pub = runCmd('cargo', [...tool, 'pubkey'], { stdio: 'pipe' })
  const pubkeyB64 = pub.status === 0 ? pub.stdout.trim() : ''
  const signatureB64 = sign.stdout.trim()
  process.stdout.write(`  ✓ 已签名（ed25519, pubkey ${pubkeyB64.slice(0, 12)}...）\n`)
  return { signatureB64, pubkeyB64 }
}
