/** 扫描注册表中的命令面板 id 冲突 */

import type { PluginDefinition } from '@/types/plugin'

/** 冲突标识符类型 */
export type PluginConflictKind = 'commandPalette'

/** 描述同组冲突的单条记录 */
export interface PluginConflict {
  /** 标识符类别 */
  kind: PluginConflictKind
  /** 共享的标识符值 */
  value: string
  /** 首个注册者作为 primary */
  peerIds: string[]
  /** 日志格式：kind value: [a, b, c] */
  message: string
}

/** 纯函数，便于测试断言 */
export function formatConflictMessage(conflict: PluginConflict): string {
  return `${conflict.kind} "${conflict.value}": [${conflict.peerIds.join(', ')}]`
}

/** 单遍扫描检测冲突（纯函数） */
export function detectPluginConflicts(
  plugins: readonly PluginDefinition[],
): PluginConflict[] {
  // 仅启用的插件占用槽位
  const enabled = plugins.filter((p) => p.enabled)

  const conflicts: PluginConflict[] = []

  // 命令面板冲突检测：展平为 id → pluginIds[] 映射
  const byCommand = new Map<string, string[]>()
  for (const p of enabled) {
    const entries = p.commandPalette
    if (!entries || entries.length === 0) continue
    for (const cmd of entries) {
      // 跳过空条目
      if (!cmd) continue
      pushGroup(byCommand, cmd, p.id)
    }
  }
  emitConflicts(conflicts, 'commandPalette', byCommand)

  return conflicts
}

/** 保留插入顺序，便于快照测试 */
function pushGroup(
  groups: Map<string, string[]>,
  key: string,
  pluginId: string,
): void {
  let bucket = groups.get(key)
  if (!bucket) {
    bucket = []
    groups.set(key, bucket)
  }
  // 同插件重复声明同一 key 时去重，避免自冲突
  if (!bucket.includes(pluginId)) {
    bucket.push(pluginId)
  }
}

/** 返回所有三类冲突的并集 */
function emitConflicts(
  out: PluginConflict[],
  kind: PluginConflictKind,
  groups: Map<string, string[]>,
): void {
  // 排序键以保证输出确定
  const keys = Array.from(groups.keys()).sort()
  for (const key of keys) {
    const peerIds = groups.get(key)!
    if (peerIds.length < 2) continue
    // 排序 peer id，输出与输入顺序无关
    peerIds.sort()
    const message = formatConflictMessage({ kind, value: key, peerIds, message: '' })
    out.push({ kind, value: key, peerIds, message })
  }
}
