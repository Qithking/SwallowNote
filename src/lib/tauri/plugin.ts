import { invoke } from '@tauri-apps/api/core'

// 插件 API

export interface PluginMetadataRust {
  id: string
  name: string
  description: string
  version: string
  author: string
  published_at: string
  /** 图标位置，null 表示无 UI */
  icon_position: string | null
  /** 面板位置，同 icon_position 可选 */
  content_position: string | null
  order: number
  enabled: boolean
  plugin_path: string
  has_backend: boolean
  // 是否随附 settings.json schema
  has_settings_schema: boolean
  /** 安装来源 repo URL，本地 zip 为空 */
  source: string
}

/** 扫描插件目录返回元数据 */
export async function scanPlugins(): Promise<PluginMetadataRust[]> {
  return await invoke('scan_plugins')
}

// 安装 zip 插件，可选 sha256 校验与来源
export async function installPlugin(
  zipPath: string,
  expectedSha256?: string,
  source?: string
): Promise<PluginMetadataRust> {
  return await invoke('install_plugin', { zipPath, expectedSha256, source })
}

/** 按 id 卸载插件 */
export async function uninstallPlugin(pluginId: string, deleteData?: boolean): Promise<void> {
  return await invoke('uninstall_plugin', { pluginId, deleteData })
}

/** 启用或禁用插件 */
export async function togglePluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return await invoke('toggle_plugin_enabled', { pluginId, enabled })
}

// 杀掉插件后端子进程。uninstall 前调用以释放文件句柄
export async function killPlugin(pluginId: string): Promise<boolean> {
  return await invoke<boolean>('kill_plugin', { pluginId })
}

// 单插件导入结果：status 为 ok/missing/error
export interface PluginConfigImportEntry {
  plugin_id: string
  status: 'ok' | 'missing' | 'error'
  message: string
}

/** importPluginConfigs 结果 */
export interface PluginConfigImportResult {
  swallow_version: string
  schema_version: number
  plugin_count: number
  /** 成功写入的 storage 数 */
  imported: number
  /** 跳过的条目数 */
  skipped: number
  entries: PluginConfigImportEntry[]
}

/** 导出包根 manifest */
export interface ExportManifest {
  schema_version: number
  swallow_version: string
  exported_at: string
  plugin_count: number
  plugin_ids: string[]
}

// 将所有插件 storage.json 打包为 zip
export async function exportPluginConfigs(destPath: string): Promise<ExportManifest> {
  return await invoke<ExportManifest>('export_plugin_configs', { destPath })
}

// 导入插件配置 zip 并合并
export async function importPluginConfigs(srcPath: string): Promise<PluginConfigImportResult> {
  return await invoke<PluginConfigImportResult>('import_plugin_configs', { srcPath })
}
