/**
 * PluginPermissionDialog - Permission grant/revoke dialog
 * 
 * Displays permissions requested by a plugin and allows user to grant/revoke them.
 */

import { useState } from 'react'
import { Shield, Check, AlertTriangle } from 'lucide-react'
import type { PluginPermission, PluginPermissionStatus, PermissionInfo } from '@/types/plugin'
import { PLUGIN_PERMISSIONS } from '@/types/plugin'
import { grantPluginPermissions, revokePluginPermissions } from '@/lib/plugin-permissions'

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
      setError('Failed to save permissions')
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-primary, #fff)',
          borderRadius: 12,
          width: '90%',
          maxWidth: 480,
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 20,
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              background: 'var(--accent-color, #6366f1)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield size={20} style={{ color: 'white' }} />
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Plugin Permissions
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
              {pluginName}
            </p>
          </div>
        </div>

        {/* Warning */}
        <div
          style={{
            margin: 16,
            padding: 12,
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 8,
            display: 'flex',
            gap: 8,
          }}
        >
          <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
            These permissions allow the plugin to access certain features. You can
            change these settings later in the plugin manager.
          </p>
        </div>

        {/* Permissions list */}
        <div style={{ padding: '0 16px' }}>
          {permissions.map((permission) => {
            const info = getPermissionInfo(permission)
            const isSelected = selectedPermissions.includes(permission)
            const currentStatusItem = currentStatus.find((s) => s.permission === permission)

            return (
              <div
                key={permission}
                onClick={() => togglePermission(permission)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  marginBottom: 8,
                  background: isSelected ? 'var(--accent-color, #6366f1)' : 'var(--bg-secondary, #f5f5f7)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
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
                  }}
                >
                  {isSelected && <Check size={14} style={{ color: 'white' }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {info?.name ?? permission}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {info?.description ?? 'No description'}
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
                    }}
                  >
                    Will be revoked
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              margin: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              color: '#ef4444',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: 16,
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !hasChanges}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              borderRadius: 8,
              background: hasChanges ? 'var(--accent-color, #6366f1)' : '#ccc',
              color: 'white',
              fontSize: 14,
              cursor: hasChanges ? 'pointer' : 'not-allowed',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PluginPermissionDialog
