import { invoke } from '@tauri-apps/api/core'
import { logger } from '../logger'

// 返回插件 storage.json 的绝对路径
export async function getPluginStoragePath(pluginId: string): Promise<string> {
  return await invoke('get_plugin_storage_path', { pluginId })
}

// ── Plugin settings（SQLite 后端）──

/** 对应 Rust PluginSettingsView */
export interface PluginSettingsView {
  exists: boolean
  values: Record<string, unknown>
  schema: PluginSettingsSchema | null
}

/** 对应 Rust SettingsSchema */
export interface PluginSettingsSchema {
  version: number
  title?: string
  description?: string
  fields: PluginSettingsField[]
}

export type PluginSettingsFieldType =
  | 'string'
  | 'string-multiline'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'directory'
  | 'password'

export interface PluginSettingsFieldOption {
  value: unknown
  label: string
}

/** 条件可见性谓词：当 values[key] === equals 时显示字段。 */
export interface PluginSettingsVisibleWhen {
  key: string
  equals: unknown
}

export interface PluginSettingsField {
  key: string
  type: PluginSettingsFieldType
  label: string
  default?: unknown
  required?: boolean
  secret?: boolean
  placeholder?: string
  options?: PluginSettingsFieldOption[]
  visibleWhen?: PluginSettingsVisibleWhen
}

export async function readPluginSettings(
  pluginId: string
): Promise<PluginSettingsView> {
  return await invoke<PluginSettingsView>('read_plugin_settings', {
    pluginId,
  })
}

export async function writePluginSettings(
  pluginId: string,
  values: Record<string, unknown>
): Promise<void> {
  // Tauri v2 不转 camelCase，需传 snake_case
  await invoke('write_plugin_settings', { args: { plugin_id: pluginId, values } })
}

export async function deletePluginSettings(pluginId: string): Promise<void> {
  await invoke('delete_plugin_settings', { pluginId })
}

// 启动时 seed 存储大小计数器
export async function getAllPluginStorageSizes(): Promise<Record<string, number>> {
  const raw = await invoke<Record<string, number>>('get_all_plugin_storage_sizes')
  return raw ?? {}
}

// 查询宿主卷真实可用字节。失败返回 null
export async function getStorageCap(): Promise<number | null> {
  try {
    const raw = await invoke<number>('get_storage_cap')
    if (typeof raw !== 'number' || raw <= 0) return null
    return raw
  } catch (err) {
    // 记录错误便于调试
    logger.warn(
      'tauri',
      'getStorageCap() failed — storage meter will show "cap unknown". ' +
        'If this is unexpected, try rebuilding the host binary (cargo tauri dev).',
      err,
    )
    return null
  }
}

// stat 单个插件 storage.json 大小
export async function getPluginStorageSize(pluginId: string): Promise<number> {
  try {
    const path = await getPluginStoragePath(pluginId)
    const meta = await invoke<{ file_size: number }>('get_file_metadata', { path })
    return meta?.file_size ?? 0
  } catch {
    // 插件可能已卸载或尚未写入
    return 0
  }
}
