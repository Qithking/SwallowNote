/** 编辑器右键 9 角色动作注册（P2.5）：
 *
 * onLoad 时经 SDK registerContextMenu 注册（context-menu 权限）；
 * onClick 中组装 RoleActionPayload（选区优先、无选区回退全文——与内置
 * handleAiAction 行为一致），经 SDK openPluginPanel 打开本插件面板，
 * 面板挂载后经 props.pendingRequest 一次性消费。
 */
import { registerContextMenu, editor, files, openPluginPanel, type ContextMenuContext } from '@swallow-note/plugin-sdk'
import { ROLE_ACTIONS, type RoleActionPayload } from './roles'

export const AI_PLUGIN_ID = 'com.swallownote.ai'

/** 「添加到 AI 对话」payload：文件路径 + 全文，面板挂载后预填输入区（用户确认后发送）。 */
export interface FileAttachPayload {
  type: 'file-attach'
  id: string
  path: string
  name: string
  content: string
}

/** 组装文件附加 payload：目录/空路径返回 null；files.read 要求 files 权限（manifest 已声明）。 */
export async function buildFileAttachPayload(ctx: ContextMenuContext): Promise<FileAttachPayload | null> {
  const path = ctx.path ?? ''
  if (!path || ctx.isDirectory) return null
  const content = await files.read(path)
  return {
    type: 'file-attach',
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    name: path.split('/').pop() ?? path,
    content,
  }
}

/** 文件附加的输入区预填文本：全文 + 引导语，用户补充问题后发送。 */
export function buildAttachPrefill(path: string, content: string): string {
  return `请基于以下文件内容回答我的问题（${path}）：\n\n${content}\n\n`
}

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

/** 注册「添加到 AI 对话」到文件树右键（仅文件节点显示；面板挂载后经 pendingRequest 一次性预填输入区）。 */
export function registerFileTreeAction(): void {
  registerContextMenu(AI_PLUGIN_ID, {
    id: 'ai-add-file-to-chat',
    label: '添加到 AI 对话',
    iconName: 'FileText',
    locations: ['fileTree'],
    when: (ctx) => ctx.isDirectory !== true,
    onClick: async (ctx) => {
      // async 赋给 void 返回签名：宿主 fire-and-forget，测试可 await 等到完成
      try {
        const payload = await buildFileAttachPayload(ctx)
        if (payload) openPluginPanel(payload)
      } catch (e) {
        console.warn('[ai] 添加到 AI 对话失败：', e)
      }
    },
  })
}
