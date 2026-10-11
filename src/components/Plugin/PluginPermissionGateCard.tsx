/**
 * PluginPermissionGateCard — 插件面板权限门控卡片。
 *
 * 当插件声明了权限但用户尚未授予时，PluginPanelHost 不挂载插件面板
 * （避免面板内部调用 events/storage 等 API 时因权限校验直接崩溃），
 * 而是渲染这张引导卡片。用户点击"去授权"后，全局授权对话框弹出；
 * 授权完成时权限守卫会通知订阅者，宿主重新检查并正常挂载面板。
 */
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import type { PluginPermission } from '@/types/plugin'
import { usePluginPermissionPromptStore } from '@/stores/pluginPermissionPrompt'

/** 按 locale 格式化权限名称列表，避免硬编码分隔符 */
function formatPermissionList(permissions: PluginPermission[], t: (key: string, opts?: Record<string, unknown>) => string, locale: string): string {
  const names = permissions.map((p) => t(`plugin.permission.items.${p}.name`, { defaultValue: p }))
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names)
  } catch {
    // locale 不被支持时回退到英文逗号
    return names.join(', ')
  }
}

interface PluginPermissionGateCardProps {
  pluginId: string
  pluginName: string
  /** 声明了但尚未授予的权限列表（仅用于卡片文案展示） */
  missing: PluginPermission[]
  /** 插件声明的全部权限（弹窗按此渲染完整勾选列表） */
  requested: PluginPermission[]
}

export function PluginPermissionGateCard({
  pluginId,
  pluginName,
  missing,
  requested,
}: PluginPermissionGateCardProps): React.ReactNode {
  const { t, i18n } = useTranslation()
  const enqueuePrompt = usePluginPermissionPromptStore((s) => s.enqueuePrompt)

  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-3 p-6"
      style={{ color: 'var(--text-secondary)' }}
      data-testid="plugin-permission-gate"
    >
      <div
        style={{
          width: 40,
          height: 40,
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ShieldAlert size={20} style={{ color: '#f59e0b' }} />
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
        {t('plugin.permission.gate.title', { name: pluginName })}
      </p>
      <p style={{ fontSize: 12, margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
        {t('plugin.permission.gate.description')}
        <br />
        {formatPermissionList(missing, t, i18n.language)}
      </p>
      <button
        type="button"
        onClick={() => enqueuePrompt({ pluginId, pluginName, requested })}
        style={{
          marginTop: 4,
          padding: '6px 16px',
          borderRadius: 6,
          border: '1px solid var(--accent-color, #6366f1)',
          background: 'transparent',
          color: 'var(--accent-color, #6366f1)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {t('plugin.permission.gate.grant')}
      </button>
    </div>
  )
}
