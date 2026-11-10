/** 编辑器右键 9 角色动作注册（P2.5）：
 *
 * onLoad 时经 SDK registerContextMenu 注册（context-menu 权限）；
 * onClick 中组装 RoleActionPayload（选区优先、无选区回退全文——与内置
 * handleAiAction 行为一致），经 SDK openPluginPanel 打开本插件面板，
 * 面板挂载后经 props.pendingRequest 一次性消费。
 */
import { registerContextMenu, editor, openPluginPanel, type ContextMenuContext } from '@swallow-note/plugin-sdk'
import { ROLE_ACTIONS, type RoleActionPayload } from './roles'

export const AI_PLUGIN_ID = 'com.swallownote.ai'

/** 组装角色动作 payload：getSelection 为实时值（含行号），ctx.selection 为菜单打开时快照（兜底）。 */
export async function buildRoleActionPayload(
  roleKey: string,
  roleName: string,
  ctx: ContextMenuContext,
): Promise<RoleActionPayload> {
  const sel = await editor.getSelection()
  const selection = sel?.text ?? ctx.selection ?? ''
  const hasSelection = selection.length > 0
  const content = hasSelection ? selection : ((await editor.getActiveContent()) ?? '')
  return {
    type: 'role-action',
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    roleKey,
    roleName,
    hasSelection,
    content,
    lineRange: sel?.lineRange ?? undefined,
    filePath: ctx.path ?? '',
  }
}

/** 注册 9 角色动作到编辑器右键菜单（幂等：宿主在插件禁用/卸载时自动清理）。 */
export function registerRoleActions(): void {
  for (const role of ROLE_ACTIONS) {
    registerContextMenu(AI_PLUGIN_ID, {
      id: `ai-role-${role.key}`,
      label: role.label,
      iconName: role.iconName,
      locations: ['editor'],
      onClick: (ctx) => {
        void buildRoleActionPayload(role.key, role.label, ctx).then((payload) => {
          openPluginPanel(payload)
        })
      },
    })
  }
}
