/**
 * ModelSettings — 模型管理（§6.11）：列表 / 新增编辑表单 / 设默认 / 删除。
 * - key 不入 ai.db：保存时前端 setSecure(`model:<id>`)；删除由前端编排级联 deleteSecure
 * - baseUrl 留空时后端按 provider 回退官方默认地址（provider.rs resolve_base_url）
 * - 「对话行为」区（§6.8）：就地应用开关（ai_settings.applyInline，默认关）
 */
import { useEffect, useState } from 'react'
import { Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { APPLY_INLINE_KEY, type AiModelRow, type AiServices, type ModelForm } from './hooks'

const PROVIDERS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
]

interface ModelSettingsProps {
  services: AiServices
  models: AiModelRow[]
  onSave: (form: ModelForm) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onSetDefault: (id: string) => Promise<unknown>
  onClose: () => void
}

const emptyForm = (): ModelForm => ({
  name: '',
  provider: 'openai-compatible',
  modelId: '',
  baseUrl: '',
  contextWindow: 128000,
  apiKey: '',
})

export function ModelSettings({ services, models, onSave, onDelete, onSetDefault, onClose }: ModelSettingsProps) {
  const [editing, setEditing] = useState<ModelForm | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteArm, setDeleteArm] = useState<string | null>(null)

  // ── 就地应用开关（§6.8，默认关；失败回滚 UI） ──
  const [applyInline, setApplyInline] = useState(false)
  useEffect(() => {
    let cancelled = false
    void services
      .invokeBackend<{ value: string | null }>('getSetting', { key: APPLY_INLINE_KEY })
      .then(({ value }) => {
        if (!cancelled) setApplyInline(value === 'true')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [services])

  const toggleApplyInline = () => {
    const next = !applyInline
    setApplyInline(next)
    void services
      .invokeBackend('setSetting', { key: APPLY_INLINE_KEY, value: String(next) })
      .catch(() => setApplyInline(!next))
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.modelId.trim()) {
      setError('请填写模型 ID')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(editing)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    // 两击确认（Tauri WebView 无原生 confirm）
    if (deleteArm !== id) {
      setDeleteArm(id)
      return
    }
    setDeleteArm(null)
    try {
      await onDelete(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Esc 关闭：表单态先返回列表避免丢输入，列表态关闭弹框（对齐宿主 Dialog 键盘行为）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editing) {
        setEditing(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  return (
    <Overlay>
      <div style={cardStyle}>
        <div style={headRowStyle}>
          <strong style={{ fontSize: 14 }}>模型设置</strong>
          <button type="button" onClick={onClose} style={iconBtnStyle} title="关闭">
            <X size={14} />
          </button>
        </div>

        {editing === null ? (
          <>
            {models.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary, #6e6e73)', margin: '12px 0' }}>
                还没有模型，点击下方按钮添加。
              </p>
            )}
            {models.map((m) => (
              <div key={m.id} style={modelRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name || m.modelId}
                    </span>
                    {m.isDefault && <DefaultBadge>默认</DefaultBadge>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #6e6e73)' }}>
                    {providerLabel(m.provider)} · {m.modelId}
                  </div>
                </div>
                <button type="button" onClick={() => void onSetDefault(m.id)} style={iconBtnStyle} title="设为默认">
                  <Star size={13} fill={m.isDefault ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: m.id,
                      name: m.name ?? '',
                      provider: m.provider,
                      modelId: m.modelId,
                      baseUrl: m.baseUrl,
                      contextWindow: m.contextWindow,
                      apiKey: '',
                    })
                  }
                  style={iconBtnStyle}
                  title="编辑"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(m.id)}
                  style={{ ...iconBtnStyle, color: deleteArm === m.id ? '#e5484d' : undefined }}
                  title={deleteArm === m.id ? '再点一次确认删除' : '删除'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setEditing(emptyForm())} style={primaryBtnStyle}>
              <Plus size={13} /> 添加模型
            </button>

            {/* ── 对话行为（§6.8）：就地应用开关 ── */}
            <div style={behaviorStyle}>
              <div style={behaviorTitleStyle}>对话行为</div>
              <label style={behaviorRowStyle}>
                <input type="checkbox" checked={applyInline} onChange={toggleApplyInline} />
                <span>生成完成后应用到文档（替换选中内容）</span>
              </label>
              <p style={behaviorHintStyle}>开启后，编辑器右键 AI 动作的结果会自动替换文档中选中的内容</p>
            </div>
          </>
        ) : (
          <ModelFormView form={editing} setForm={setEditing} onSave={handleSave} busy={busy} />
        )}

        {error !== '' && <p style={errorStyle}>{error}</p>}
      </div>
    </Overlay>
  )
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

function ModelFormView({
  form,
  setForm,
  onSave,
  busy,
}: {
  form: ModelForm
  setForm: (f: ModelForm | null) => void
  onSave: () => void
  busy: boolean
}) {
  const field = (
    label: string,
    node: React.ReactNode,
    hint?: string,
  ) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      {node}
      {hint && <span style={hintStyle}>{hint}</span>}
    </label>
  )

  return (
    <div>
      {field(
        '名称',
        <input
          style={inputStyle}
          value={form.name}
          placeholder="选填，默认显示模型 ID"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />,
      )}
      {field(
        '提供商',
        <select style={inputStyle} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>,
      )}
      {field(
        '模型 ID',
        <input
          style={inputStyle}
          value={form.modelId}
          placeholder="如 gpt-4o / claude-sonnet-4-5"
          onChange={(e) => setForm({ ...form, modelId: e.target.value })}
        />,
      )}
      {field(
        'Base URL',
        <input
          style={inputStyle}
          value={form.baseUrl}
          placeholder="留空使用官方默认地址"
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
        />,
      )}
      {field(
        '上下文窗口',
        <input
          style={inputStyle}
          type="number"
          value={form.contextWindow}
          min={0}
          onChange={(e) => setForm({ ...form, contextWindow: Number(e.target.value) || 0 })}
        />,
        'token 数，0 表示使用默认 128k',
      )}
      {field(
        'API Key',
        <input
          style={inputStyle}
          type="password"
          value={form.apiKey ?? ''}
          placeholder={form.id ? '留空表示不修改' : '必填'}
          onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
        />,
        '加密存储在系统安全区，不写入数据库',
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => setForm(null)} style={secondaryBtnStyle} disabled={busy}>
          取消
        </button>
        <button type="button" onClick={onSave} style={primaryBtnStyle} disabled={busy}>
          保存
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 小件与样式
// ---------------------------------------------------------------------------

function providerLabel(p: string): string {
  return PROVIDERS.find((x) => x.value === p)?.label ?? p
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* 进场动画 keyframes：前缀命名防与宿主全局样式冲突 */}
      <style>{`
        @keyframes swallow-ai-ms-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes swallow-ai-ms-zoom-in { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }
      `}</style>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 30,
          // 对齐宿主 Dialog 遮罩（bg-black/80）
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          animation: 'swallow-ai-ms-fade-in 0.15s ease-out',
        }}
      >
        {children}
      </div>
    </>
  )
}

const cardStyle: CSSProperties = {
  // 对齐宿主 Dialog：白底卡片 + 边框 + zoom/fade 进场
  background: 'var(--bg-secondary, #fff)',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: 12,
  padding: 14,
  width: '100%',
  maxHeight: '100%',
  overflowY: 'auto',
  boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
  animation: 'swallow-ai-ms-zoom-in 0.2s ease-out',
}
const headRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }
const modelRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 0', borderBottom: '1px solid var(--border-color, #e5e5e5)' }
const labelStyle: CSSProperties = { display: 'block', fontSize: 11, color: 'var(--text-secondary, #6e6e73)', marginBottom: 3 }
const hintStyle: CSSProperties = { display: 'block', fontSize: 10, color: 'var(--text-secondary, #6e6e73)', marginTop: 2 }
const errorStyle: CSSProperties = { color: '#e5484d', fontSize: 12, margin: '8px 0 0' }

// 「对话行为」区（§6.8）
const behaviorStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: '1px solid var(--border-color, #e5e5e5)',
}
const behaviorTitleStyle: CSSProperties = { fontSize: 12, fontWeight: 500, marginBottom: 6 }
const behaviorRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  cursor: 'pointer',
}
const behaviorHintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary, #6e6e73)',
  margin: '6px 0 0',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--border-color, #e5e5e5)',
  // 对齐宿主 Input（bg-transparent）：白卡片上透明底描边
  background: 'transparent',
  color: 'var(--text-primary, #1d1d1f)',
  boxSizing: 'border-box',
}

const iconBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 6,
  color: 'var(--text-secondary, #6e6e73)',
  display: 'inline-flex',
}
const primaryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--theme-color, #0a84ff)',
  color: '#fff',
}
const secondaryBtnStyle: CSSProperties = {
  ...primaryBtnStyle,
  // 白卡片上的次按钮用宿主外壳灰，避免白底不可见
  background: 'var(--bg-primary, #f5f5f7)',
  color: 'var(--text-primary, #1d1d1f)',
}

function DefaultBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 4,
        // 主题色淡底（color-mix 从 --theme-color 派生，不再硬编码蓝色）
        background: 'color-mix(in srgb, var(--theme-color, #0a84ff) 12%, transparent)',
        color: 'var(--theme-color, #0a84ff)',
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  )
}
