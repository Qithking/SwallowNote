/**
 * ChatPanel — P2.4 对话面板 + P2.5 角色动作消费/就地应用/回写（§6.8/§6.10）。
 *
 * 组装：useAiModels / useAiSessions / useAiMessageStore + TauriChatTransport + useChat。
 * 落库约定：用户消息发送前 appendMessage；助手消息 onFinish 落库（isError 的半截
 * 回复不落库）；stopped/omitted 经 message.metadata 透传为提示条。
 * 交互：发送时无会话懒建；切换/新建/删除会话先 stop 进行中的流。
 * P2.5：pendingRequest 消费右键 9 角色动作（displayText 展示 + roleKey 透传后端）；
 * 就地应用（开关默认关，应用前校验选区未变动）+ 撤销校验 + 回写四操作 + notice 提示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { Bot, ChevronDown, MessageSquarePlus, Pencil, Settings, Square, Trash2, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { UIMessage } from 'ai'
import { editor, files } from '@swallow-note/plugin-sdk'
import { TauriChatTransport, extractText } from './transport'
import {
  APPLY_INLINE_KEY,
  useAiMessageStore,
  useAiModels,
  useAiSessions,
  type AiServices,
  type FinishMetadata,
} from './hooks'
import { MessageBubble, type BubbleActions } from './MessageBubble'
import { ModelSettings } from './ModelSettings'
import type { RoleActionPayload } from '../actions/roles'
import { buildAttachPrefill, type FileAttachPayload } from '../actions/registerActions'

export interface ChatPanelProps {
  services: AiServices
  /** openPluginPanel 写入的一次性请求（仅归属本插件时透出，面板读取后宿主清空） */
  pendingRequest?: unknown
}

export function ChatPanel({ services, pendingRequest }: ChatPanelProps) {
  const modelCtl = useAiModels(services)
  const sessions = useAiSessions(services)
  const store = useAiMessageStore(services)

  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [deleteArm, setDeleteArm] = useState<string | null>(null)
  const sentSessionIdRef = useRef<string | null>(null)

  // ── P2.5：角色动作消费 / 就地应用 / 回写反馈 ──
  /** 面板内提示条（3s 自动消失；tone=error 红色） */
  const [notice, setNotice] = useState<{ text: string; tone?: 'error' } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showNotice = useCallback((text: string, tone?: 'error') => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, tone })
    noticeTimer.current = setTimeout(() => setNotice(null), 3000)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // ── P3.4 升级路径联调（§6.5）：面板首开触发老数据导入 ──
  // 宿主导出的迁移文件由后端 importLegacyData 落库（幂等保护），成功后刷新
  // 会话/模型列表并删除迁移文件；无文件（全新安装）或已有数据则静默跳过。
  const legacyImportTriedRef = useRef(false)
  useEffect(() => {
    if (legacyImportTriedRef.current) return
    legacyImportTriedRef.current = true
    void (async () => {
      const r = await services.invokeBackend<{
        imported: boolean
        counts?: { messages: number; rolePrompts: number; models: number }
      }>('importLegacyData')
      if (!r?.imported) return
      const c = r.counts
      showNotice(
        `已导入历史数据：消息 ${c?.messages ?? 0} 条 · 角色 ${c?.rolePrompts ?? 0} 个 · 模型 ${c?.models ?? 0} 个`,
      )
      await Promise.all([sessions.refresh(), modelCtl.refresh()])
      await services.invokeBackend('finalizeLegacyImport')
    })().catch(() => {})
    // 仅挂载执行一次（ref 防重 + 后端 already-initialized 幂等双保险）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 右键动作发送上下文：就地应用仅在「本条来自角色动作且有选区」时生效 */
  const actionCtxRef = useRef<{ selectionOriginal: string } | null>(null)
  /** 已消费的请求 id（防面板重渲染 / StrictMode 重复消费） */
  const consumedRequestIdRef = useRef<string | null>(null)
  /** 会话内最近一次就地应用（撤销按钮仅对此气泡开放；刷新后丢失，编辑器 Ctrl+Z 兜底） */
  const [canUndo, setCanUndo] = useState<{ id: string; selectionOriginal: string } | null>(null)

  const transport = useMemo(
    () =>
      new TauriChatTransport({
        invokeBackend: services.invokeBackend,
        invokeBackendStream: services.invokeBackendStream,
        getModelId: () => modelCtl.activeModelIdRef.current,
        getApiKey: (id) => services.secureStorage.get(`model:${id}`),
      }),
    [services, modelCtl.activeModelIdRef],
  )

  const onFinish = useCallback(
    (event: { message: UIMessage; isError?: boolean }) => {
      const sid = sentSessionIdRef.current
      if (!sid || event.isError) return
      const streamMeta = (event.message.metadata ?? {}) as FinishMetadata
      // 右键动作上下文：正常完成后消费；isError 时保留（重试成功后仍可应用）
      const ctx = actionCtxRef.current
      actionCtxRef.current = null
      void (async () => {
        const output = extractText(event.message)
        const meta: FinishMetadata = { stopped: streamMeta.stopped, omitted: streamMeta.omitted }
        // 就地应用（§6.8）：仅开关开启 + 发送时有选区；应用前校验选区仍是发送时的
        // 原文（流式期间用户可能改动），失败提示且绝不整文替换
        if (ctx && ctx.selectionOriginal !== '' && (await isApplyInlineEnabled(services))) {
          const sel = await editor.getSelection().catch(() => null)
          if (sel && sel.text === ctx.selectionOriginal) {
            const ok = await editor.replaceSelection(output).catch(() => false)
            if (ok) {
              meta.applied = true
              meta.selectionOriginal = ctx.selectionOriginal
              setCanUndo({ id: event.message.id, selectionOriginal: ctx.selectionOriginal })
              showNotice('已应用到文档')
            } else {
              showNotice('请先选中要修改的内容', 'error')
            }
          } else {
            showNotice('请先选中要修改的内容', 'error')
          }
        }
        await store.appendAssistant(sid, output, meta)
        void sessions.refresh()
      })().catch(() => {})
    },
    [store, sessions, services, showNotice],
  )

  const { messages, sendMessage, status, stop, error, setMessages, regenerate, clearError } = useChat({
    transport,
    onFinish,
  })
  const isLoading = status === 'submitted' || status === 'streaming'

  // 切换会话（含删除当前会话后的自动切换）：加载历史
  useEffect(() => {
    let cancelled = false
    if (sessions.activeId === null) {
      setMessages([])
      return
    }
    void store
      .loadMessages(sessions.activeId)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessions.activeId, store, setMessages])

  // 消息变化（含流式增量）时滚动到底
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // ── 右键角色动作消费（§6.3 面板请求管道）：payload.id 幂等守卫 ──
  useEffect(() => {
    const req = pendingRequest as RoleActionPayload | null
    if (!req || typeof req !== 'object' || req.type !== 'role-action') return
    if (consumedRequestIdRef.current === req.id) return
    consumedRequestIdRef.current = req.id
    if (!modelCtl.activeModelIdRef.current) {
      showNotice('请先在设置中添加模型，再使用角色动作', 'error')
      return
    }
    void (async () => {
      stop() // 流式中先停（无进行中的流时为无操作）
      // 发到当前激活会话；无会话则懒建（对齐内置单流延续语义）
      let sid = sessions.activeId
      if (!sid) {
        try {
          sid = await sessions.create()
        } catch {
          showNotice('创建会话失败', 'error')
          return
        }
      }
      sentSessionIdRef.current = sid
      const displayText = buildRoleDisplayText(req)
      try {
        await store.appendUser(sid, req.content, { roleKey: req.roleKey, displayText })
      } catch {
        showNotice('消息落库失败', 'error')
        return
      }
      void sessions.refresh()
      actionCtxRef.current = { selectionOriginal: req.hasSelection ? req.content : '' }
      void sendMessage(
        { text: req.content, metadata: { displayText, roleKey: req.roleKey } },
        { body: { roleKey: req.roleKey } },
      )
    })()
  }, [pendingRequest, modelCtl, sessions, store, sendMessage, stop, showNotice])

  // ── 文件树右键「添加到 AI 对话」消费：预填输入区，用户确认后发送（幂等守卫同上）──
  useEffect(() => {
    const req = pendingRequest as FileAttachPayload | null
    if (!req || typeof req !== 'object' || req.type !== 'file-attach') return
    if (consumedRequestIdRef.current === req.id) return
    consumedRequestIdRef.current = req.id
    const prefill = buildAttachPrefill(req.path, req.content)
    setInput((prev) => (prev ? `${prev}\n\n${prefill}` : prefill))
  }, [pendingRequest])

  // ── 回写四操作（§6.8 / 对齐内置版）：编辑器 API + 反馈提示内聚在面板层 ──
  const writeback = useMemo<BubbleActions>(
    () => ({
      insertAtCursor: (text) => {
        void editor
          .insertAtCursor(text)
          .then((ok) => showNotice(ok ? '已插入到光标位置' : '插入失败：编辑器不可用', ok ? undefined : 'error'))
          .catch(() => showNotice('插入失败', 'error'))
      },
      replaceContent: (text) => {
        void editor
          .replaceContent(text)
          .then(() => showNotice('已替换全文'))
          .catch(() => showNotice('替换失败', 'error'))
      },
      saveAsNewFile: (text) => {
        // P2.5 简化：插件无 rootPath 上下文，固定存工作区 ai-notes/ 目录（内置为同目录，P2.7 评估）
        const relPath = `ai-notes/${formatFileStamp()}.md`
        void files
          .createNote(relPath, text)
          .then(() => showNotice(`已另存为 ${relPath}`))
          .catch(() => showNotice('另存失败', 'error'))
      },
      undoApply: (outputText) => {
        if (!canUndo) return
        void (async () => {
          // 撤销前校验：当前选区必须仍是应用时写入的 AI 输出（§6.8 防位置错位）
          const sel = await editor.getSelection().catch(() => null)
          if (!sel) {
            showNotice('请先选中要撤销的内容', 'error')
            return
          }
          if (sel.text !== outputText) {
            showNotice('文档已变动，无法自动撤销', 'error')
            return
          }
          const ok = await editor.replaceSelection(canUndo.selectionOriginal).catch(() => false)
          if (ok) {
            setCanUndo(null)
            showNotice('已撤销本次应用')
          } else {
            showNotice('文档已变动，无法自动撤销', 'error')
          }
        })()
      },
    }),
    [canUndo, showNotice],
  )

  /** 发送：无会话懒建 → 用户消息落库 → sendMessage（助手收尾在 onFinish） */
  const handleSend = async () => {
    const text = input.trim()
    if (!text || !modelCtl.activeModelId || isLoading) return
    clearError()
    actionCtxRef.current = null // 普通对话不触发就地应用
    let sid = sessions.activeId
    if (!sid) {
      sid = await sessions.create()
    }
    sentSessionIdRef.current = sid
    try {
      await store.appendUser(sid, text)
      void sessions.refresh()
    } catch {
      return // 落库失败说明后端异常，不发起对话
    }
    setInput('')
    void sendMessage({ text })
  }

  /** 流式中切走前先停 */
  const guardStop = () => {
    if (isLoading) stop()
  }

  const activeSession = sessions.sessions.find((s) => s.id === sessions.activeId) ?? null
  const noModel = sessions.loaded && modelCtl.models.length === 0

  const handleRenameCommit = async () => {
    if (renamingId && renameText.trim()) {
      await sessions.rename(renamingId, renameText.trim()).catch(() => {})
    }
    setRenamingId(null)
  }

  const handleDeleteSession = async (id: string) => {
    if (deleteArm !== id) {
      setDeleteArm(id)
      return
    }
    setDeleteArm(null)
    guardStop()
    await sessions.remove(id).catch(() => {})
  }

  return (
    <div style={rootStyle}>
      <style>{'@keyframes ai-blink{0%,100%{opacity:.2}50%{opacity:1}}'}</style>

      {/* ── 顶栏：会话 + 模型 + 设置 ── */}
      <div style={topBarStyle}>
        <button
          type="button"
          onClick={() => {
            setSessionsOpen((v) => !v)
            setDeleteArm(null)
          }}
          style={sessionBtnStyle}
          title="会话列表"
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
            {activeSession?.title ?? '新对话'}
          </span>
          <ChevronDown size={12} />
        </button>
        <span style={{ flex: 1 }} />
        <select
          value={modelCtl.activeModelId ?? ''}
          onChange={(e) => modelCtl.setActiveModel(e.target.value)}
          style={modelSelectStyle}
          title="选择模型"
        >
          {modelCtl.models.length === 0 && <option value="">未配置模型</option>}
          {modelCtl.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.modelId}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setSettingsOpen(true)} style={iconBtnStyle} title="模型设置">
          <Settings size={13} />
        </button>
      </div>

      {/* ── 操作反馈提示条（回写/就地应用结果，3s 自动消失） ── */}
      {notice && (
        <div
          style={{
            ...noticeStyle,
            ...(notice.tone === 'error' ? { background: 'rgba(229,72,77,0.1)', color: '#e5484d' } : {}),
          }}
        >
          {notice.text}
        </div>
      )}

      {/* ── 会话列表弹层 ── */}
      {sessionsOpen && (
        <Overlay onClose={() => setSessionsOpen(false)}>
          <div style={sessionCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={headRowStyle}>
              <strong style={{ fontSize: 13 }}>会话</strong>
              <button type="button" onClick={() => setSessionsOpen(false)} style={iconBtnStyle} title="关闭">
                <X size={13} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {sessions.sessions.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary, #6e6e73)', margin: '8px 0' }}>暂无会话</p>
              )}
              {sessions.sessions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    ...sessionRowStyle,
                    background: s.id === sessions.activeId ? 'rgba(10,132,255,0.08)' : 'transparent',
                  }}
                >
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      style={sessionInputStyle}
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => void handleRenameCommit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRenameCommit()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        style={sessionTitleBtnStyle}
                        onClick={() => {
                          guardStop()
                          sessions.activate(s.id)
                          setSessionsOpen(false)
                        }}
                      >
                        {s.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(s.id)
                          setRenameText(s.title)
                        }}
                        style={iconBtnStyle}
                        title="重命名"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSession(s.id)}
                        style={{ ...iconBtnStyle, color: deleteArm === s.id ? '#e5484d' : undefined }}
                        title={deleteArm === s.id ? '再点一次确认删除' : '删除'}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              style={primaryBtnStyle}
              onClick={() => {
                guardStop()
                void sessions
                  .create()
                  .then(() => setSessionsOpen(false))
                  .catch(() => {})
              }}
            >
              <MessageSquarePlus size={13} /> 新建对话
            </button>
          </div>
        </Overlay>
      )}

      {/* ── 模型设置弹层 ── */}
      {settingsOpen && (
        <ModelSettings
          services={services}
          models={modelCtl.models}
          onSave={modelCtl.saveModel}
          onDelete={modelCtl.deleteModel}
          onSetDefault={modelCtl.setDefaultModel}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ── 消息区 ── */}
      <div ref={scrollRef} style={scrollStyle}>
        {noModel ? (
          <EmptyState
            icon={<Bot size={26} />}
            text="先添加一个模型开始对话"
            action={
              <button type="button" style={primaryBtnStyle} onClick={() => setSettingsOpen(true)}>
                添加模型
              </button>
            }
          />
        ) : messages.length === 0 && !isLoading ? (
          <EmptyState icon={<Bot size={26} />} text="有什么可以帮你？" />
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              meta={((m.metadata ?? undefined) as FinishMetadata | undefined)}
              streaming={isLoading}
              actions={writeback}
              canUndo={canUndo?.id === m.id}
            />
          ))
        )}
      </div>

      {/* ── 错误横幅 ── */}
      {error && (
        <div style={errorBannerStyle}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{error.message}</span>
          <button type="button" style={retryBtnStyle} onClick={() => void regenerate()}>
            重试
          </button>
          <button type="button" style={iconBtnStyle} onClick={() => clearError()} title="关闭">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── 输入区 ── */}
      <div style={inputWrapStyle}>
        <textarea
          style={textareaStyle}
          placeholder={noModel ? '请先添加模型' : '输入消息，Enter 发送，Shift+Enter 换行'}
          value={input}
          disabled={noModel}
          onChange={(e) => {
            setInput(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = Math.min(Math.max(el.scrollHeight, 50), 160) + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        <div style={inputBtnRowStyle}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #6e6e73)' }}>
            {modelCtl.activeModelId ? '' : '未配置模型'}
          </span>
          <span style={{ flex: 1 }} />
          {isLoading && (
            <button type="button" onClick={() => stop()} style={stopBtnStyle} title="停止生成">
              <Square size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={noModel || !input.trim() || isLoading}
            style={sendBtnStyle}
            title="发送"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 小件与样式
// ---------------------------------------------------------------------------

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      {children}
    </div>
  )
}

function EmptyState({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        color: 'var(--text-secondary, #6e6e73)',
        fontSize: 13,
      }}
    >
      {icon}
      <span>{text}</span>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// P2.5 辅助
// ---------------------------------------------------------------------------

/** 角色动作的用户消息展示文案：[角色] 文件名（行号 / 全文） */
function buildRoleDisplayText(req: RoleActionPayload): string {
  const base = req.filePath.split(/[\\/]/).pop() ?? req.filePath
  const suffix = req.lineRange
    ? ` (L${req.lineRange[0]}-${req.lineRange[1]})`
    : req.hasSelection
      ? ''
      : '（全文）'
  return `[${req.roleName}] ${base}${suffix}`
}

/** 就地应用开关（ai_settings.applyInline，默认关；'true'/'false' 字符串存储） */
async function isApplyInlineEnabled(services: AiServices): Promise<boolean> {
  try {
    const { value } = await services.invokeBackend<{ value: string | null }>('getSetting', {
      key: APPLY_INLINE_KEY,
    })
    return value === 'true'
  } catch {
    return false
  }
}

/** 另存新文件名时间戳：2026-11-09-153045 */
function formatFileStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const rootStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  // 对齐宿主面板容器背景 token（App.tsx 右侧面板同款），亮暗色及自定义主题均跟随
  background: 'var(--bg-secondary-gradient, var(--bg-secondary, #fff))',
  color: 'var(--text-primary, #1d1d1f)',
  overflow: 'hidden',
}
const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderBottom: '1px solid var(--border-color, #e5e5ea)',
  flexShrink: 0,
}
const sessionBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text-primary, #1d1d1f)',
  maxWidth: 170,
}
const modelSelectStyle: CSSProperties = {
  fontSize: 12,
  padding: '3px 4px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary, #6e6e73)',
  maxWidth: 150,
  cursor: 'pointer',
  outline: 'none',
}
const iconBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 6,
  color: 'var(--text-secondary, #6e6e73)',
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
}
const scrollStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 12px 12px',
}
const inputWrapStyle: CSSProperties = {
  flexShrink: 0,
  margin: '0 10px 10px',
  border: '1px solid var(--border-color, #d2d2d7)',
  borderRadius: 10,
  // 面板底色改为白后，输入区用宿主外壳灰（--bg-primary）保持层次对比
  background: 'var(--bg-primary, #f5f5f7)',
}
const textareaStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: 'var(--text-primary, #1d1d1f)',
  fontSize: 13,
  lineHeight: 1.5,
  padding: '8px 10px 2px',
  minHeight: 50,
  maxHeight: 160,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
const inputBtnRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 8px' }
const sendBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '5px 12px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--theme-color, #0a84ff)',
  color: '#fff',
}
const stopBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: 5,
  cursor: 'pointer',
  background: '#e5484d',
  color: '#fff',
  display: 'inline-flex',
}
const errorBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '0 10px 8px',
  padding: '6px 10px',
  borderRadius: 8,
  background: 'rgba(229,72,77,0.1)',
  color: '#e5484d',
  fontSize: 12,
  flexShrink: 0,
}
const noticeStyle: CSSProperties = {
  margin: '6px 10px 0',
  padding: '5px 10px',
  borderRadius: 8,
  background: 'rgba(10,132,255,0.08)',
  color: 'var(--theme-color, #0a84ff)',
  fontSize: 12,
  flexShrink: 0,
}
const retryBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: 5,
  padding: '2px 8px',
  fontSize: 11,
  cursor: 'pointer',
  background: 'rgba(229,72,77,0.15)',
  color: '#e5484d',
  flexShrink: 0,
}

// 弹层样式
const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 30,
  background: 'rgba(0,0,0,0.2)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  padding: '40px 10px 10px',
}
const sessionCardStyle: CSSProperties = {
  background: 'var(--bg-primary, #fff)',
  borderRadius: 10,
  padding: 10,
  width: '100%',
  maxHeight: '70%',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
}
const headRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const sessionRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  borderRadius: 6,
  padding: '2px 2px 2px 6px',
}
const sessionTitleBtnStyle: CSSProperties = {
  flex: 1,
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '6px 4px',
  fontSize: 12,
  color: 'var(--text-primary, #1d1d1f)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const sessionInputStyle: CSSProperties = {
  flex: 1,
  fontSize: 12,
  padding: '5px 6px',
  borderRadius: 5,
  border: '1px solid var(--theme-color, #0a84ff)',
  outline: 'none',
  background: 'var(--bg-primary, #fff)',
  color: 'var(--text-primary, #1d1d1f)',
  minWidth: 0,
}
const primaryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--theme-color, #0a84ff)',
  color: '#fff',
  flexShrink: 0,
}
