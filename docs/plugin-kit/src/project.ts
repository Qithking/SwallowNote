import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PluginProject {
  /** 插件工程根目录（通常为 CLI 运行 cwd） */
  dir: string
  pluginId: string
  manifest: Record<string, unknown>
  /** 工程是否含 Rust 后端（以 src-tauri 目录存在为准） */
  hasBackend: boolean
  /** 是否存在 settings.json（可选打包项） */
  hasSettings: boolean
  /** Rust 二进制名：优先 Cargo.toml [[bin]] name，回退由插件 id 推导 */
  binName: string
}

/** 由插件 id 推导 Rust 二进制名：非字母数字一律替换为下划线（com.swallownote.a-b → plugin_com_swallownote_a_b） */
export function deriveBinName(pluginId: string): string {
  return 'plugin_' + pluginId.replace(/[^a-zA-Z0-9]/g, '_')
}

/** 从 Cargo.toml 解析 [[bin]] name（模板与现有插件均显式声明） */
function parseCargoBinName(cargoTomlPath: string): string | null {
  const src = readFileSync(cargoTomlPath, 'utf-8')
  const section = /\[\[bin\]\]([\s\S]*?)(?=\n\[|$)/.exec(src)
  const name = section?.[1]?.match(/^\s*name\s*=\s*"([^"]+)"/m)
  return name?.[1] ?? null
}

/** 读取插件工程上下文；manifest.json 缺失或无 id 时视为非插件工程并报错 */
export function loadProject(dir: string): PluginProject {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} 不存在 — 请在插件工程根目录运行（需要 manifest.json）`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  if (!manifest.id) {
    throw new Error(`manifest.json 缺少 id 字段`)
  }
  const hasBackend = existsSync(join(dir, 'src-tauri'))
  const cargoToml = join(dir, 'src-tauri', 'Cargo.toml')
  const binName = hasBackend
    ? (existsSync(cargoToml) ? parseCargoBinName(cargoToml) : null) ?? deriveBinName(manifest.id)
    : ''
  return {
    dir,
    pluginId: manifest.id,
    manifest,
    hasBackend,
    hasSettings: existsSync(join(dir, 'settings.json')),
    binName,
  }
}
