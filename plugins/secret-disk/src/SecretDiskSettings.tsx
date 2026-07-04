/**
 * 密盘设置面板（v2）。
 *
 * 功能：
 * - "每次打开需要密码"勾选框（setSetting 持久化）
 * - "备份数据库"按钮（save 对话框 + filter .swl）
 * - "导入数据库"按钮（open 对话框 + 内嵌密码输入 + 失败提示）
 * - "修改密码"按钮（内嵌修改密码界面 + 强度校验，非弹框）
 */
import { useEffect, useState, useCallback } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Database, Download, Upload, KeyRound, Eye, EyeOff, Lock } from 'lucide-react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import { validatePassword, strengthLabel, strengthColor, PASSWORD_MAX_LEN } from './passwordStrength'

export function SecretDiskSettings(props: PluginPanelProps) {
  const { invokeBackend, getSetting, setSetting } = props

  const [requirePassword, setRequirePassword] = useState(false)
  // 修改密码内嵌界面
  const [showChangePassword, setShowChangePassword] = useState(false)
  // 导入数据库内嵌界面
  const [importing, setImporting] = useState(false)
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null)
  const [importPassword, setImportPassword] = useState('')

  /** 加载 requirePasswordEveryTime 设置。 */
  useEffect(() => {
    void getSetting<boolean>('requirePasswordEveryTime').then((val) => {
      setRequirePassword(val === true)
    })
  }, [getSetting])

  /** 切换"每次打开需要密码"。 */
  const handleToggleRequirePassword = useCallback(
    async (checked: boolean) => {
      setRequirePassword(checked)
      await setSetting('requirePasswordEveryTime', checked)
    },
    [setSetting],
  )

  /** 备份数据库：弹出保存对话框。 */
  const handleBackup = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const targetPath = await save({
      defaultPath: `secret-backup-${today}.swl`,
      filters: [{ name: '密盘数据库', extensions: ['swl'] }],
    })
    if (!targetPath) return

    try {
      await invokeBackend('backup', { targetPath })
      alert('备份成功')
    } catch (err) {
      alert(`备份失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [invokeBackend])

  /** 导入数据库：先选择文件，再内嵌输入密码。 */
  const handleImportSelectFile = useCallback(async () => {
    const sourcePath = await open({
      multiple: false,
      filters: [{ name: '密盘数据库', extensions: ['swl'] }],
    })
    if (typeof sourcePath === 'string') {
      setImportSourcePath(sourcePath)
      setImportPassword('')
      setImporting(true)
    }
  }, [])

  /** 确认导入：用输入的密码验证并替换数据库。 */
  const handleConfirmImport = useCallback(async () => {
    if (!importSourcePath || !importPassword) return
    try {
      await invokeBackend('import_db', {
        sourcePath: importSourcePath,
        password: importPassword,
      })
      alert('导入成功')
    } catch (err) {
      alert(`导入失败，已恢复原数据库：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImporting(false)
      setImportSourcePath(null)
      setImportPassword('')
    }
  }, [invokeBackend, importSourcePath, importPassword])

  /** 修改密码成功回调。 */
  const handleChangePasswordSuccess = useCallback(() => {
    setShowChangePassword(false)
  }, [])

  return (
    <div style={containerStyle}>
      {/* 每次打开需要密码 */}
      <div style={sectionStyle}>
        <label style={labelRowStyle}>
          <input
            type="checkbox"
            checked={requirePassword}
            onChange={(e) => void handleToggleRequirePassword(e.target.checked)}
            style={checkboxStyle}
          />
          <span>每次打开需要密码</span>
        </label>
        <p style={hintStyle}>勾选后，每次打开密盘面板都需要输入密码。关闭面板时自动锁定数据库。</p>
      </div>

      <div style={dividerStyle} />

      {/* 数据库管理 */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          <Database size={14} />
          <span>数据库管理</span>
        </div>

        <button style={buttonStyle} onClick={handleBackup}>
          <Download size={14} />
          <span>备份数据库</span>
        </button>

        <button style={buttonStyle} onClick={handleImportSelectFile}>
          <Upload size={14} />
          <span>导入数据库</span>
        </button>
      </div>

      <div style={dividerStyle} />

      {/* 修改密码 */}
      <div style={sectionStyle}>
        {!showChangePassword ? (
          <button style={buttonStyle} onClick={() => setShowChangePassword(true)}>
            <KeyRound size={14} />
            <span>修改密码</span>
          </button>
        ) : (
          <ChangePasswordInline
            invokeBackend={invokeBackend}
            onSuccess={handleChangePasswordSuccess}
            onCancel={() => setShowChangePassword(false)}
          />
        )}
      </div>

      <div style={dividerStyle} />

      {/* 导入数据库：内嵌密码输入 */}
      {importing && importSourcePath && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            <Lock size={14} />
            <span>输入导入数据库的密码</span>
          </div>
          <input
            type="password"
            style={inputStyle}
            autoFocus
            value={importPassword}
            onChange={(e) => setImportPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConfirmImport()
              if (e.key === 'Escape') {
                setImporting(false)
                setImportSourcePath(null)
                setImportPassword('')
              }
            }}
            placeholder="密码"
            maxLength={PASSWORD_MAX_LEN}
          />
          <div style={{ fontSize: 11, color: 'var(--text-2, #6b7280)', wordBreak: 'break-all' }}>
            文件：{importSourcePath}
          </div>
          <div style={actionsStyle}>
            <button
              style={cancelBtnStyle}
              onClick={() => {
                setImporting(false)
                setImportSourcePath(null)
                setImportPassword('')
              }}
            >
              取消
            </button>
            <button
              style={submitBtnStyle}
              onClick={handleConfirmImport}
              disabled={!importPassword}
            >
              确认导入
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  内嵌修改密码组件（当前密码 + 新密码 + 确认新密码 + 强度校验）
// ════════════════════════════════════════════════════════════════

interface ChangePasswordInlineProps {
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  onSuccess: () => void
  onCancel: () => void
}

function ChangePasswordInline({ invokeBackend, onSuccess, onCancel }: ChangePasswordInlineProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validation = validatePassword(newPassword)

  const canSubmit = (() => {
    if (loading) return false
    return (
      currentPassword.length > 0 &&
      validation?.valid === true &&
      newPassword === confirmPassword
    )
  })()

  /** 提交修改密码。 */
  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError('')
    try {
      await invokeBackend('change_password', {
        currentPassword,
        newPassword,
      })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
      void handleSubmit()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  const inputType = showPassword ? 'text' : 'password'

  return (
    <div style={changePwdContainerStyle} onKeyDown={handleKeyDown}>
      <div style={sectionTitleStyle}>
        <KeyRound size={14} />
        <span>修改密码</span>
      </div>

      {/* 当前密码 */}
      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>当前密码</label>
        <input
          type={inputType}
          style={inputStyle}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="输入当前密码"
          maxLength={PASSWORD_MAX_LEN}
          autoFocus
        />
      </div>

      {/* 新密码 */}
      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>新密码</label>
        <div style={{ position: 'relative' }}>
          <input
            type={inputType}
            style={{ ...inputStyle, paddingRight: 36 }}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="输入新密码（至少 8 位，含字母和数字）"
            maxLength={PASSWORD_MAX_LEN}
          />
          <button
            type="button"
            style={eyeBtnStyle}
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {newPassword.length > 0 && validation && (
          <div style={strengthBarStyle}>
            <div
              style={{
                ...strengthFillStyle,
                width: validation.strength === 'weak' ? '33%' : validation.strength === 'medium' ? '66%' : '100%',
                backgroundColor: strengthColor(validation.strength!),
              }}
            />
            <span style={{ fontSize: 11, color: strengthColor(validation.strength!) }}>
              {strengthLabel(validation.strength!)}
            </span>
            {validation.error && (
              <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>
                {validation.error}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 确认新密码 */}
      <div style={pwdFieldStyle}>
        <label style={pwdLabelStyle}>确认新密码</label>
        <input
          type={inputType}
          style={inputStyle}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="再次输入新密码"
          maxLength={PASSWORD_MAX_LEN}
        />
        {confirmPassword.length > 0 && newPassword !== confirmPassword && (
          <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>
            两次输入的密码不一致
          </span>
        )}
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={actionsStyle}>
        <button style={cancelBtnStyle} onClick={onCancel} disabled={loading}>
          取消
        </button>
        <button
          style={{ ...submitBtnStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? '处理中…' : '确认修改'}
        </button>
      </div>
    </div>
  )
}

// ── 样式 ──────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const labelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  fontSize: 13,
}

const checkboxStyle: React.CSSProperties = {
  cursor: 'pointer',
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-2, #6b7280)',
  margin: 0,
  lineHeight: 1.5,
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-1, #e5e7eb)',
}

const sectionTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-2, #6b7280)',
  marginBottom: 4,
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  border: '1px solid var(--border-1, #d1d5db)',
  borderRadius: 6,
  background: 'var(--paper-2, #fff)',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-1, #111)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid var(--border-1, #d1d5db)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--paper-2, #fff)',
  color: 'var(--text-1, #111)',
  outline: 'none',
  boxSizing: 'border-box',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-1, #d1d5db)',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text-1, #111)',
}

const submitBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--accent, #3b82f6)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

// ── 修改密码内嵌样式 ──────────────────────────────────────────────

const changePwdContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  border: '1px solid var(--border-1, #e5e7eb)',
  borderRadius: 6,
  backgroundColor: 'var(--paper-1, #fff)',
}

const pwdFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const pwdLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-2, #6b7280)',
  fontWeight: 500,
}

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: 'var(--text-2, #6b7280)',
  display: 'flex',
  alignItems: 'center',
}

const strengthBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
}

const strengthFillStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  transition: 'width 0.2s, background-color 0.2s',
}

const errorStyle: React.CSSProperties = {
  padding: '8px 12px',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: '#ef4444',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid rgba(239, 68, 68, 0.2)',
}
