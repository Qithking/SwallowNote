/**
 * P002 - 多轮对话上下文测试
 *
 * 验证：
 *  1. saveAiMessage / loadAiMessages 正确序列化与反序列化
 *  2. 分页参数 (beforeId, limit) 透传正确
 *  3. clearAiMessages 清空逻辑
 *  4. 多轮历史加载时消息顺序与时间戳
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  saveAiMessage,
  loadAiMessages,
  clearAiMessages,
  type AiChatMessage,
} from '@/lib/tauri'

const makeMessage = (overrides: Partial<AiChatMessage> = {}): AiChatMessage => ({
  id: 1,
  role: 'user',
  content: 'hi',
  model_id: 'builtin-siliconflow-qwen3-8b',
  created_at: '2026-06-17 10:00:00',
  ...overrides,
})

describe('P002: 多轮对话上下文测试', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('P002-01: saveAiMessage 透传 role/content/modelId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(42)

    const id = await saveAiMessage('user', '你好', 'builtin-siliconflow-qwen3-8b')

    expect(invoke).toHaveBeenCalledWith('save_ai_message', {
      role: 'user',
      content: '你好',
      modelId: 'builtin-siliconflow-qwen3-8b',
    })
    expect(id).toBe(42)
  })

  it('P002-02: loadAiMessages 首次加载不传 beforeId/limit', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    await loadAiMessages()

    expect(invoke).toHaveBeenCalledWith('load_ai_messages', {
      beforeId: undefined,
      limit: undefined,
    })
  })

  it('P002-03: loadAiMessages 分页加载时透传 beforeId 与 limit', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    await loadAiMessages(100, 30)

    expect(invoke).toHaveBeenCalledWith('load_ai_messages', {
      beforeId: 100,
      limit: 30,
    })
  })

  it('P002-04: 多轮历史消息顺序与字段保留', async () => {
    const history: AiChatMessage[] = [
      makeMessage({ id: 1, role: 'user', content: '问题1' }),
      makeMessage({ id: 2, role: 'assistant', content: '回答1' }),
      makeMessage({ id: 3, role: 'user', content: '问题2' }),
      makeMessage({ id: 4, role: 'assistant', content: '回答2' }),
    ]
    vi.mocked(invoke).mockResolvedValueOnce(history)

    const result = await loadAiMessages(4, 30)

    expect(result).toHaveLength(4)
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(result[0].content).toBe('问题1')
    expect(result[3].content).toBe('回答2')
  })

  it('P002-05: clearAiMessages 调用 clear_ai_messages 命令', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await clearAiMessages()

    expect(invoke).toHaveBeenCalledWith('clear_ai_messages')
  })

  it('P002-06: loadAiMessages 错误向上传播', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('DB error'))

    await expect(loadAiMessages()).rejects.toThrow('DB error')
  })
})
