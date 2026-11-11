import { copyFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { runCmd, resolveLocalBin } from './exec.js'
import { loadProject, type PluginProject } from './project.js'

/** vite build（插件工程根目录下执行；优先用工程本地 vite） */
export function runViteBuild(pluginDir: string): void {
  console.log('==> 构建前端（Vite ESM 单文件产物 dist/index.js）...')
  const localVite = resolveLocalBin(pluginDir, 'vite')
  const res = runCmd(localVite ?? 'npx', localVite ? ['build'] : ['vite', 'build'], { cwd: pluginDir })
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
}

/**
 * cargo build --release 并把二进制复制到指定输出位置。
 * - dev 迭代（build.sh 约定）：<pluginDir>/backend/plugin_<id>，宿主 invoke_plugin 直接查找该路径；
 * - 打包（package.sh 约定）：<pluginDir>/dist/backend/plugin_<id>，进入 zip 的 backend/ 条目。
 */
export function buildBackend(project: PluginProject, outputBinPath: string): void {
  const srcTauri = join(project.dir, 'src-tauri')
  console.log('==> 构建后端（cargo build --release）...')
  const res = runCmd('cargo', ['build', '--release', '--manifest-path', join(srcTauri, 'Cargo.toml')], {
    cwd: project.dir,
  })
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
  const binPath = join(srcTauri, 'target', 'release', project.binName)
  if (!existsSync(binPath)) {
    console.error(`✗ 未找到构建产物 ${binPath}（Cargo.toml [[bin]] name = ${project.binName}）`)
    process.exit(1)
  }
  mkdirSync(join(outputBinPath, '..'), { recursive: true })
  copyFileSync(binPath, outputBinPath)
  chmodSync(outputBinPath, 0o755)
  console.log(`  ✓ 后端二进制 → ${outputBinPath}`)
}

/**
 * swallow-plugin build：
 *   vite build + （工程含 src-tauri 时）cargo build --release
 *   后端二进制放 <pluginDir>/backend/plugin_<id>（build.sh 约定，宿主运行期查找位置）。
 */
export function cmdBuild(pluginDir: string): void {
  const project = loadProject(pluginDir)
  runViteBuild(project.dir)
  if (project.hasBackend) {
    buildBackend(project, join(project.dir, 'backend', `plugin_${project.pluginId}`))
  } else {
    console.log('==> 无 src-tauri，跳过后端构建')
  }
  console.log(`\n✓ 构建完成：${project.pluginId}`)
}
