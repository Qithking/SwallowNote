/** 密盘插件前端类型定义：对应后端 models.rs，字段 camelCase */

/** 笔记/文件夹类型 */
export type NoteType = 'file' | 'folder'

/** 列表项：不含 content 字段 */
export interface NoteListItem {
  id: string
  parentId: string | null
  title: string
  type: NoteType
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 完整笔记：含 content 字段 */
export interface NoteFull extends NoteListItem {
  content: string
}

/** 密盘状态机：未初始化/已锁定/已解锁 */
export type DiskState = 'uninitialized' | 'locked' | 'unlocked'

/** 密码强度等级 */
export type PasswordStrength = 'weak' | 'medium' | 'strong'
