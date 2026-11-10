/** 角色动作清单（P2.5）：编辑器右键 9 角色动作的菜单定义。
 *
 * 与内置版对齐（EditorContextMenu AI 动作区 + zh-CN ai.role.* 文案）；
 * 角色提示词种子（ai_role_prompts 表）在 P2.6 落地，本文件仅含菜单元数据。
 */

/** 右键动作 payload（插件自定义，宿主不解析；经 openPluginPanel → 面板 pendingRequest 一次性消费） */
export interface RoleActionPayload {
  type: 'role-action'
  /** 一次性请求 ID（时间戳+随机），防止重复消费 */
  id: string
  roleKey: string
  roleName: string
  /** 用户在编辑器中是否有选区 */
  hasSelection: boolean
  /** 动作内容：有选区=选中文本，无选区=全文 */
  content: string
  /** 选区行号范围（1-based，仅 hasSelection 时有值） */
  lineRange?: [number, number]
  /** 来源文件路径（ctx.path，可能为绝对路径；展示时取 basename） */
  filePath: string
}

export interface RoleActionDef {
  key: string
  label: string
  iconName?: string
}

/** 9 角色动作（chat 角色只在面板，不入右键菜单） */
export const ROLE_ACTIONS: RoleActionDef[] = [
  { key: 'continue_writing', label: '续写', iconName: 'Edit3' },
  { key: 'polish', label: '润色', iconName: 'Star' },
  { key: 'correct', label: '纠错', iconName: 'Check' },
  { key: 'outline', label: '提纲', iconName: 'FileText' },
  { key: 'summary', label: '摘要', iconName: 'Copy' },
  { key: 'format', label: '格式整理', iconName: 'Code' },
  { key: 'complete', label: '补全', iconName: 'FilePlus' },
  { key: 'rewrite', label: '改写', iconName: 'RefreshCw' },
  { key: 'explain', label: '解释', iconName: 'Eye' },
]
