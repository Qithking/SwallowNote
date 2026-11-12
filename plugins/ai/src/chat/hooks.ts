/**
 * P2.4 会话编排 hooks：多会话 CRUD/激活持久化 + 模型管理（含级联删 secureStorage）。
 *
 * 落库约定（对齐内置版行为）：
 * - 用户消息在发送前 appendMessage(role=user)
 * - 助手消息在 onFinish 时 appendMessage(role=assistant, metaJson={stopped?,omitted?})；
 *   error 终止的半截回复不落库（错误重试可再来，验收为「错误展示对齐」）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from 'ai'
import type { PluginSecureStorage, InvokeBackendStreamOptions } from '@swallow-note/plugin-sdk'

/** 面板注入的插件服务子集 */
export interface AiServices {
  invokeBackend: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>
  invokeBackendStream: <T = unknown, R = unknown>(
    command: string,
    args: Record<string, unknown> | undefined,
    onChunk: (chunk: T) => void,
    options?: InvokeBackendStreamOptions
  ) => Promise<R>
  secureStorage: PluginSecureStorage
}

export interface AiSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface AiModelRow {
  id: string
  name: string | null
  provider: string
  modelId: string
  baseUrl: string
  contextWindow: number
  isDefault: boolean
}

export interface AiMessageRow {
  id: string
  role: string
  content: string
  displayText?: string | null
  roleKey?: string | null
  metaJson?: string | null
  createdAt: number
}

/** 后端返回值形状 */
interface SessionsResult {
  sessions: AiSession[]
}
interface MessagesResult {
  messages: AiMessageRow[]
}
interface ModelsResult {
  models: AiModelRow[]
}
interface SettingResult {
  value: string | null
}

const ACTIVE_SESSION_KEY = 'activeSessionId'
const ACTIVE_MODEL_KEY = 'activeModelId'

/** ai_settings key：就地应用开关（§6.8，默认关；以 'true'/'false' 字符串存储） */
export const APPLY_INLINE_KEY = 'applyInline'

/** UIMessage → 后端消息行文本；displayText 非空时优先（老数据对齐） */
function rowText(row: AiMessageRow): string {
  return row.displayText && row.displayText !== '' ? row.displayText : row.content
}

/** 数据库消息行 → UIMessage（供 useChat setMessages）。
 *  user 行 metadata 携带 displayText/roleKey，与「当前发送」路径的渲染逻辑统一
 *  （MessageBubble 显示 metadata.displayText ?? text）。 */
export function rowsToUIMessages(rows: AiMessageRow[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : row.role === 'system' ? 'system' : 'user',
    metadata: {
      displayText: row.displayText ?? undefined,
      roleKey: row.roleKey ?? undefined,
    },
    parts: [{ type: 'text' as const, text: rowText(row) }],
  }))
}

/** onFinish 的 message.metadata（transport 经 message-metadata chunk 透传） */
export interface FinishMetadata {
  stopped?: boolean
  omitted?: number
  /** 就地应用标记（P2.5，§6.8）：applied=true 时 selectionOriginal 为撤销校验值 */
  applied?: boolean
  selectionOriginal?: string
}

// ---------------------------------------------------------------------------
// 模型管理
// ---------------------------------------------------------------------------

export interface ModelForm {
  id?: string
  name: string
  provider: string
  modelId: string
  baseUrl: string
  contextWindow: number
  /** 仅保存时使用；编辑留空表示不修改 */
  apiKey?: string
}

export function useAiModels(services: AiServices) {
  const [models, setModels] = useState<AiModelRow[]>([])
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const activeModelIdRef = useRef<string | null>(null)

  const applyActive = useCallback((id: string | null) => {
    activeModelIdRef.current = id
    setActiveModelId(id)
  }, [])

  const refresh = useCallback(async () => {
    const { models: list } = await services.invokeBackend<ModelsResult>('listModels')
    setModels(list)
    const { value } = await services.invokeBackend<SettingResult>('getSetting', {
      key: ACTIVE_MODEL_KEY,
    })
    const persisted =
      value && list.some((m) => m.id === value)
        ? value
        : (list.find((m) => m.isDefault)?.id ?? list[0]?.id ?? null)
    applyActive(persisted)
  }, [services, applyActive])

  const setActiveModel = useCallback(
    (id: string) => {
      applyActive(id)
      void services.invokeBackend('setSetting', { key: ACTIVE_MODEL_KEY, value: id }).catch(() => {})
    },
    [services, applyActive],
  )

  /** 保存模型；key 即刻写入 secureStorage（§6.11：key 不入 ai.db） */
  const saveModel = useCallback(
    async (form: ModelForm): Promise<string> => {
      const { id } = await services.invokeBackend<{ id: string }>('saveModel', {
        id: form.id,
        name: form.name,
        provider: form.provider,
        modelId: form.modelId,
        baseUrl: form.baseUrl,
        contextWindow: form.contextWindow,
      })
      if (form.apiKey && form.apiKey !== '') {
        await services.secureStorage.set(`model:${id}`, form.apiKey)
      }
      await refresh()
      return id
    },
    [services, refresh],
  )

  /** 删除模型 + 级联删 secureStorage 键（P2.3 定案：secureStorage 仅前端可达，
   *  后端删行成功后由前端编排 deleteSecure("model:<id>")） */
  const deleteModel = useCallback(
    async (id: string) => {
      await services.invokeBackend('deleteModel', { id })
      await services.secureStorage.delete(`model:${id}`).catch(() => {})
      await refresh()
    },
    [services, refresh],
  )

  const setDefaultModel = useCallback(
    async (id: string) => {
      await services.invokeBackend('setDefaultModel', { id })
      await refresh()
    },
    [services, refresh],
  )

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  // memo：调用方（ChatPanel）将返回对象用于 effect 依赖，引用必须稳定
  return useMemo(
    () => ({
      models,
      activeModelId,
      activeModelIdRef,
      setActiveModel,
      saveModel,
      deleteModel,
      setDefaultModel,
      refresh,
    }),
    [models, activeModelId, activeModelIdRef, setActiveModel, saveModel, deleteModel, setDefaultModel, refresh],
  )
}

// ---------------------------------------------------------------------------
// 多会话
// ---------------------------------------------------------------------------

export function useAiSessions(services: AiServices) {
  const [sessions, setSessions] = useState<AiSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const { sessions: list } = await services.invokeBackend<SessionsResult>('listSessions')
    setSessions(list)
  }, [services])

  const activate = useCallback(
    (id: string | null) => {
      setActiveId(id)
      if (id !== null) {
        void services
          .invokeBackend('setSetting', { key: ACTIVE_SESSION_KEY, value: id })
          .catch(() => {})
      }
    },
    [services],
  )

  /** 初始化：恢复持久化的激活会话，否则取列表第一个 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { sessions: list } = await services.invokeBackend<SessionsResult>('listSessions')
        if (cancelled) return
        setSessions(list)
        const { value } = await services.invokeBackend<SettingResult>('getSetting', {
          key: ACTIVE_SESSION_KEY,
        })
        if (cancelled) return
        const restored =
          value && list.some((s) => s.id === value) ? value : (list[0]?.id ?? null)
        if (restored !== null) {
          // 静默恢复，不重复写 setSetting
          setActiveId(restored)
        }
      } catch {
        // 后端不可达时保留空态
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [services])

  const create = useCallback(
    async (title?: string): Promise<string> => {
      const { id } = await services.invokeBackend<{ id: string }>('createSession', {
        title: title ?? '',
      })
      await refresh()
      activate(id)
      return id
    },
    [services, refresh, activate],
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      await services.invokeBackend('renameSession', { id, title })
      await refresh()
    },
    [services, refresh],
  )

  /** 删除会话；删除的是激活会话时切换到列表第一个（可能为 null） */
  const remove = useCallback(
    async (id: string) => {
      await services.invokeBackend('deleteSession', { id })
      const rest = sessions.filter((s) => s.id !== id)
      setSessions(rest)
      if (activeId === id) {
        activate(rest[0]?.id ?? null)
      }
    },
    [services, sessions, activeId, activate],
  )

  return useMemo(
    () => ({ sessions, activeId, loaded, activate, create, rename, remove, refresh }),
    [sessions, activeId, loaded, activate, create, rename, remove, refresh],
  )
}

// ---------------------------------------------------------------------------
// 消息落库
// ---------------------------------------------------------------------------

/** 用户消息发送前的落库参数（P2.5）：roleKey/displayText 用于角色动作展示与
 *  撤销链路；metaJson 为扩展元数据（现无调用方传值，保留通道）。 */
export interface AppendUserExtra {
  roleKey?: string
  displayText?: string
  metaJson?: string
}

export function useAiMessageStore(services: AiServices) {
  /** 发送前落库用户消息 */
  const appendUser = useCallback(
    async (sessionId: string, content: string, extra?: AppendUserExtra) => {
      await services.invokeBackend('appendMessage', {
        sessionId,
        role: 'user',
        content,
        ...(extra?.roleKey ? { roleKey: extra.roleKey } : {}),
        ...(extra?.displayText ? { displayText: extra.displayText } : {}),
        ...(extra?.metaJson ? { metaJson: extra.metaJson } : {}),
      })
    },
    [services],
  )

  /** onFinish 落库助手消息（含 stopped/omitted/就地应用元数据） */
  const appendAssistant = useCallback(
    async (sessionId: string, content: string, meta: FinishMetadata) => {
      const payload: Record<string, unknown> = {}
      if (meta.stopped) payload.stopped = true
      if (typeof meta.omitted === 'number' && meta.omitted > 0) payload.omitted = meta.omitted
      if (meta.applied) {
        payload.applied = true
        if (meta.selectionOriginal) payload.selectionOriginal = meta.selectionOriginal
      }
      const metaJson = Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined
      await services.invokeBackend('appendMessage', {
        sessionId,
        role: 'assistant',
        content,
        metaJson,
      })
    },
    [services],
  )

  /** 加载历史（切换会话/首启） */
  const loadMessages = useCallback(
    async (sessionId: string): Promise<UIMessage[]> => {
      const { messages } = await services.invokeBackend<MessagesResult>('listMessages', {
        sessionId,
      })
      return rowsToUIMessages(messages)
    },
    [services],
  )

  return useMemo(
    () => ({ appendUser, appendAssistant, loadMessages }),
    [appendUser, appendAssistant, loadMessages],
  )
}
