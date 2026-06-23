/**
 * Frontmatter 查询工具 — 所有数据从后端 SQLite 查询，不维护内存缓存。
 */
import type { NoteFrontmatter } from '@/lib/types/frontmatter'
import { parseFrontmatter } from '@/lib/utils/frontmatter'
import { invoke } from '@tauri-apps/api/core'

/// 后端 FrontmatterRecord 类型（与 Rust 侧 FrontmatterRecord 对应）
export interface FrontmatterRecord {
  id: number
  file_path: string
  title: string | null
  created: string | null
  updated: string | null
  tags: string | null
  categories: string | null
  author: string | null
  status: string | null
  pinned: boolean
  extra_yaml: string | null
  raw_yaml: string | null
  modified_at: string
  indexed_at: string
}

/**
 * 从后端查询指定文件的 frontmatter，返回 NoteFrontmatter 格式。
 * 如果后端无记录，回退到读取文件并解析。
 */
export async function getFileFrontmatter(filePath: string): Promise<NoteFrontmatter> {
  try {
    const record = await invoke<FrontmatterRecord | null>('query_frontmatter', { filePath })
    if (record) {
      return recordToFrontmatter(record)
    }
  } catch {
    // 后端查询失败，回退到文件读取
  }

  // 回退：直接读取文件解析（索引可能尚未完成）
  try {
    const { readFile } = await import('@/lib/tauri')
    const content = await readFile(filePath)
    const { parseFrontmatter } = await import('@/lib/utils/frontmatter')
    const { data } = parseFrontmatter(content)
    return data
  } catch {
    return {}
  }
}

/**
 * 从 FrontmatterRecord 转换为 NoteFrontmatter
 */
function recordToFrontmatter(record: FrontmatterRecord): NoteFrontmatter {
  const result: NoteFrontmatter = {}

  if (record.title) result.title = record.title
  if (record.created) result.created = record.created
  if (record.updated) result.updated = record.updated
  if (record.author) result.author = record.author
  if (record.status) result.status = record.status as NoteFrontmatter['status']
  if (record.pinned) result.pinned = record.pinned

  if (record.tags) {
    try {
      result.tags = JSON.parse(record.tags)
    } catch { /* ignore */ }
  }

  if (record.categories) {
    try {
      result.categories = JSON.parse(record.categories)
    } catch { /* ignore */ }
  }

  // 合并 extra_yaml 中的非标准字段
  if (record.extra_yaml) {
    try {
      const extra = JSON.parse(record.extra_yaml)
      if (typeof extra === 'object' && extra !== null) {
        Object.assign(result, extra)
      }
    } catch { /* ignore */ }
  }

  return result
}

/**
 * 从原始内容解析 frontmatter（同步版本，用于内容已可用的场景）。
 * 此函数不涉及数据库，仅做本地解析。
 */
export function getFrontmatterFromContent(content: string): NoteFrontmatter {
  const { data } = parseFrontmatter(content)
  return data
}

/**
 * 通知后端重新索引指定文件。
 * 替代原有的 invalidateFrontmatterCache，因为不再有内存缓存需要失效。
 */
export async function invalidateFrontmatterCache(filePath: string): Promise<void> {
  try {
    await invoke('trigger_frontmatter_scan', { path: filePath })
  } catch {
    // 静默失败，索引线程会通过文件监听器自动处理
  }
}

/**
 * 触发指定目录的 frontmatter 扫描。
 */
export async function triggerFrontmatterScan(path: string): Promise<void> {
  try {
    await invoke('trigger_frontmatter_scan', { path })
  } catch {
    // 静默失败
  }
}

/**
 * 按路径前缀查询 frontmatter 记录。
 */
export async function queryFrontmatterByPrefix(pathPrefix: string): Promise<FrontmatterRecord[]> {
  try {
    return await invoke<FrontmatterRecord[]>('query_frontmatter_by_prefix', { pathPrefix })
  } catch {
    return []
  }
}

/**
 * 按标签查询 frontmatter 记录。
 */
export async function queryFrontmatterByTag(tag: string): Promise<FrontmatterRecord[]> {
  try {
    return await invoke<FrontmatterRecord[]>('query_frontmatter_by_tag', { tag })
  } catch {
    return []
  }
}

/**
 * 清除 frontmatter 缓存 — 不再需要，保留为空函数以兼容现有调用。
 * 切换工作区时不清除旧数据，后端保留所有历史记录。
 */
export function clearFrontmatterCache(): void {
  // 不再需要操作，数据持久化在 SQLite 中
}
