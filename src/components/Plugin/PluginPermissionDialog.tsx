/**
 * PluginPermissionDialog - Permission grant/revoke dialog
 *
 * Displays permissions requested by a plugin and lets the user
 * grant/revoke them. The dialog is rendered with the project's
 * shadcn `Dialog` primitives so it picks up the same backdrop,
 * animation, and Esc-to-close behavior as every other dialog in
 * the app.
 *
 * The visible UI is a function component so we can use the
 * `useTranslation` hook (class components can't, and wrapping the
 * export in `withTranslation` would force the consumer to change).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield, Check, AlertTriangle } from 'lucide-react'
import type { PluginPermission, PluginPermissionStatus, PermissionInfo } from '@/types/plugin'
import { PLUGIN_PERMISSIONS } from '@/types/plugin'
import { grantPluginPermissions, revokePluginPermissions } from '@/lib/plugin-permissions'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface PluginPermissionDialogProps {
  pluginId: string
  pluginName: string
  permissions: PluginPermission[]
  currentStatus: PluginPermissionStatus[]
  onClose: () => void
  onGrant?: (permissions: PluginPermission[]) => void
}

export function PluginPermissionDialog({
  pluginId,
  pluginName,
  permissions,
  currentStatus,
  onClose,
  onGrant,
}: PluginPermissionDialogProps) {
  const { t } = useTranslation()
  const [selectedPermissions, setSelectedPermissions] = useState<PluginPermission[]>(
    permissions.filter((p) => {
      const status = currentStatus.find((s) => s.permission === p)
      return status?.granted ?? false
    })
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const togglePermission = (permission: PluginPermission) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission]
    )
  }

  const getPermissionInfo = (permission: PluginPermission): PermissionInfo | undefined => {
    return PLUGIN_PERMISSIONS.find((p) => p.permission === permission)
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Grant selected permissions
      const toGrant = selectedPermissions.filter((p) => {
        const status = currentStatus.find((s) => s.permission === p)
        return !status?.granted
      })
      if (toGrant.length > 0) {
        await grantPluginPermissions(pluginId, toGrant)
      }

      // Revoke unselected permissions
      const toRevoke = permissions.filter(
        (p) => !selectedPermissions.includes(p)
      )
      if (toRevoke.length > 0) {
        await revokePluginPermissions(pluginId, toRevoke)
      }

      onGrant?.(selectedPermissions)
      onClose()
    } catch {
      setError(t('plugin.permission.saveFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasChanges = permissions.some((p) => {
    const wasGranted = currentStatus.find((s) => s.permission === p)?.granted ?? false
    const isSelected = selectedPermissions.includes(p)
    return wasGranted !== isSelected
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent style={{ maxWidth: 480 }}>
        <DialogHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                background: 'var(--accent-color, #6366f1)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Shield size={20} style={{ color: 'white' }} />
            </div>
            <div>
              <DialogTitle>{t('plugin.permission.title')}</DialogTitle>
              <DialogDescription>{pluginName}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 8,
            display: 'flex',
            gap: 8,
          }}
        >
          <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
            {t('plugin.permission.warning')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          {permissions.map((permission) => {
            const info = getPermissionInfo(permission)
            const isSelected = selectedPermissions.includes(permission)
            const currentStatusItem = currentStatus.find((s) => s.permission === permission)

            return (
              <button
                key={permission}
                onClick={() => togglePermission(permission)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  background: isSelected ? 'var(--accent-color, #6366f1)' : 'var(--bg-secondary, #f5f5f7)',
                  border: '1px solid transparent',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  textAlign: 'left',
                  color: isSelected ? 'white' : 'var(--text-primary)',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    border: `2px solid ${isSelected ? 'white' : 'var(--border-color)'}`,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && <Check size={14} style={{ color: 'white' }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {info?.name ?? permission}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: isSelected ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)',
                    }}
                  >
                    {info?.description ?? t('plugin.permission.noDescription')}
                  </div>
                </div>
                {currentStatusItem?.granted && !isSelected && (
                  <div
                    style={{
                      padding: '4px 8px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: 4,
                      fontSize: 11,
                      color: '#ef4444',
                      flexShrink: 0,
                    }}
                  >
                    {t('plugin.permission.revoking')}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 4,
              color: '#ef4444',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <DialogFooter style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting} style={{ flex: 1 }}>
            {t('plugin.permission.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !hasChanges}
            style={{ flex: 1 }}
          >
            {isSubmitting ? t('plugin.permission.saving') : t('plugin.permission.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PluginPermissionDialog
