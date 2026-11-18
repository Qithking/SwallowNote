import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { writeDeterministicZip, type ZipEntry } from './zip.js'
import { loadProject, type PluginProject } from './project.js'
import { bumpVersion, syncCargoVersion, syncManifest, syncPackageJson, type BumpLevel } from './version.js'
import { previewRepoSync, syncRepoJson } from './repo.js'
import { signZip } from './sign.js'
import { buildBackend, runViteBuild } from './build.js'

export interface PackageOptions {
  /** bump 级别，默认 patch；'none' 等价 --no-bump */
  bump: BumpLevel | 'none'
  /** --version X.Y.Z 显式钉住新版本（隐含 --no-bump） */
  pinVersion?: string
  /** 跳过 plugins/repo.json 同步 */
  skipRepo: boolean
  /** 只打印计划与 repo.json 回填预览，不写任何文件、不构建 */
  dryRun: boolean
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function nowIsoZ(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * swallow-plugin package —— 等价平移各插件 package.sh 全流程：
 *   版本 bump（manifest.json / package.json / Cargo.toml）
 *   → vite build →（有 src-tauri）cargo build --release
 *   → 确定性 zip → sha256 → ed25519 签名 → repo.json 同步。
 *
 * 与 package.sh 的两处差异（均必要）：
 *  1. publishedAt 仅在版本变化时刷新 —— --no-bump 下 package.sh 会刷新
 *     publishedAt 并烘焙进产物，导致两次构建字节不同，破坏确定性要求；
 *  2. repo.json 无该插件条目时报错退出（原脚本仅警告后照常结束）。
 */
export function cmdPackage(pluginDir: string, opts: PackageOptions): void {
  const project: PluginProject = loadProject(pluginDir)
  const oldVersion = String(project.manifest.version ?? '0.0.0')
  // --version X.Y.Z 隐含 --bump none（与 package.sh 一致）
  const newVersion = opts.pinVersion ?? (opts.bump === 'none' ? oldVersion : bumpVersion(oldVersion, opts.bump as BumpLevel))
  const versionChanged = newVersion !== oldVersion
  const publishedAt = nowIsoZ()

  console.log(`==> 插件 ${project.pluginId}`)
  if (versionChanged) {
    console.log(`==> 版本 bump：${oldVersion} → ${newVersion} (${opts.bump})`)
  } else {
    console.log(`==> 版本不变：${oldVersion}（--no-bump / 已钉住；publishedAt 保持不变以保证产物确定性）`)
  }

  // ─── dry-run：只打印计划，不落盘 ──────────────────────────────────────────
  if (opts.dryRun) {
    const repoJsonPath = resolve(pluginDir, '..', 'repo.json')
    if (existsSync(repoJsonPath)) {
      const preview = previewRepoSync(repoJsonPath, {
        pluginId: project.pluginId,
        version: newVersion,
        sha256: '<zip 的 sha256，构建后计算>',
        publishedAt,
        signatureB64: '<有签名密钥时为签名 base64，否则清除>',
        pubkeyB64: '<有签名密钥时为公钥 base64>',
      })
      if (preview.found) {
        console.log('\n[dry-run] repo.json 条目将变更为：')
        console.log(preview.after)
      } else {
        console.log(`\n[dry-run] ✗ repo.json 中没有 ${project.pluginId} 条目（正式运行将报错退出）`)
      }
    } else {
      console.log(`\n[dry-run] ⚠ 未找到 ${repoJsonPath}（正式运行将跳过索引同步）`)
    }
    console.log('\n[dry-run] 未写入任何文件、未执行构建。')
    return
  }

  // ─── 版本 bump（vite build 之前，确保新版本烘焙进 index.js） ─────────────
  if (versionChanged) {
    syncManifest(join(pluginDir, 'manifest.json'), newVersion, publishedAt)
    syncPackageJson(join(pluginDir, 'package.json'), newVersion)
    if (project.hasBackend) {
      syncCargoVersion(join(pluginDir, 'src-tauri', 'Cargo.toml'), oldVersion, newVersion)
    }
  }

  // ─── 前端 / 后端构建 ──────────────────────────────────────────────────────
  runViteBuild(pluginDir)
  const distDir = join(pluginDir, 'dist')
  if (project.hasBackend) {
    // 打包约定：二进制进 dist/backend/，随 zip 携带
    buildBackend(project, join(distDir, 'backend', `plugin_${project.pluginId}`))
  } else {
    console.log('==> 无 src-tauri，跳过后端构建')
  }

  // ─── dist 组装：manifest 复制，settings.json 存在才带 ────────────────────
  copyFileSync(join(pluginDir, 'manifest.json'), join(distDir, 'manifest.json'))
  const zipEntries: ZipEntry[] = [
    { name: 'index.js', data: readFileSync(join(distDir, 'index.js')), mode: 0o644 },
    { name: 'manifest.json', data: readFileSync(join(distDir, 'manifest.json')), mode: 0o644 },
  ]
  if (project.hasSettings) {
    copyFileSync(join(pluginDir, 'settings.json'), join(distDir, 'settings.json'))
    zipEntries.push({ name: 'settings.json', data: readFileSync(join(distDir, 'settings.json')), mode: 0o644 })
  }
  if (project.hasBackend) {
    // backend/ 目录条目 + 二进制条目，与现有 zip 内容清单一致；目录条目置于二进制之前
    zipEntries.push({ name: 'backend/', data: null, mode: 0o755 })
    zipEntries.push({ name: `backend/plugin_${project.pluginId}`, data: readFileSync(join(distDir, 'backend', `plugin_${project.pluginId}`)), mode: 0o755 })
  }

  // ─── 确定性 zip（固定顺序 / mtime / 压缩选项，两次构建字节一致） ──────────
  const zipPath = join(pluginDir, `${project.pluginId}.zip`)
  writeDeterministicZip(zipPath, zipEntries)
  const sha256 = sha256File(zipPath)
  console.log(`\n✓ 插件包：${zipPath}`)
  console.log('  内容：')
  for (const e of zipEntries) {
    console.log(`    ${e.name}${e.data ? ` (${e.data.length} 字节)` : ''}`)
  }
  console.log(`  version:      ${newVersion}`)
  console.log(`  sha256:       ${sha256}`)

  // ─── ed25519 签名（密钥缺失时警告并跳过，与 sign-common.sh 行为一致） ────
  const { signatureB64, pubkeyB64 } = signZip(zipPath)

  // ─── repo.json 同步（市场索引） ───────────────────────────────────────────
  const repoJsonPath = resolve(pluginDir, '..', 'repo.json')
  if (opts.skipRepo) {
    console.log('\n→ 跳过 repo.json 同步（--skip-repo）')
  } else if (!existsSync(repoJsonPath)) {
    console.warn(`\n⚠ 未找到 ${repoJsonPath} — 跳过索引同步，zip 已就绪，请手动更新市场索引`)
  } else {
    console.log('\n==> 同步 plugins/repo.json...')
    const result = syncRepoJson({
      repoJsonPath,
      pluginId: project.pluginId,
      version: newVersion,
      sha256,
      publishedAt,
      signatureB64,
      pubkeyB64,
    })
    if (result === 'not-found') {
      throw new Error(
        `repo.json 中没有插件 ${project.pluginId} 的条目 — 请先在 repo.json 的 plugins 数组中添加该条目（含 download_url 等静态字段）后重试`
      )
    }
    console.log(`  ✓ version       = ${newVersion}`)
    console.log(`  ✓ sha256        = ${sha256}`)
    console.log(`  ✓ published_at  = ${publishedAt}`)
    console.log(`  ✓ updated_at    = 刷新为当前时间`)
  }

  console.log('\n安装方式：插件管理器 → 拖拽或选择 zip 文件')
}
