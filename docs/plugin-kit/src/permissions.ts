/**
 * 插件权限目录：镜像宿主 / docs/plugin-sdk 的 PluginPermission 固定集合。
 * （独立模块避免 create 在类型层面依赖 SDK 源码。）
 */
export type PluginPermission =
  | 'storage'
  | 'events'
  | 'context-menu'
  | 'backend'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'network'
  | 'clipboard'
  | 'notifications'
  | 'editor'
  | 'editor-write'
  | 'files'
  | 'secure-storage'

export interface PermissionChoice {
  key: PluginPermission
  description: string
}

/** create 交互多选的可选权限（顺序即展示顺序，与 SDK 类型定义一致） */
export const PERMISSION_CHOICES: PermissionChoice[] = [
  { key: 'storage', description: '插件键值存储（getSetting / store 等）' },
  { key: 'events', description: '宿主事件总线（订阅应用事件）' },
  { key: 'context-menu', description: '编辑器右键菜单项' },
  { key: 'backend', description: '调用插件 Rust 后端命令' },
  { key: 'filesystem-read', description: '文件系统只读访问' },
  { key: 'filesystem-write', description: '文件系统写入' },
  { key: 'network', description: '网络请求' },
  { key: 'clipboard', description: '系统剪贴板' },
  { key: 'notifications', description: '系统通知' },
  { key: 'editor', description: '注册自定义文件类型编辑器' },
  { key: 'editor-write', description: '编辑器写入（插入 / 替换内容）' },
  { key: 'files', description: '工作区文件受限访问' },
  { key: 'secure-storage', description: '加密安全存储（API 密钥等敏感数据）' },
]
