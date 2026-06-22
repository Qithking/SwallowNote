/**
 * P001 - AI 对话 API 调用测试
 *
 * 验证 AIView 通过 useChat + DefaultChatTransport 调通本地代理时，
 * 请求体格式、SSE 响应解析、错误处理等行为正确。
 *
 * 由于 useChat 内部依赖 React 运行时，本测试聚焦可独立验证的传输层：
 *  1. tauri.ts 中 testAiModel 正确序列化参数
 *  2. getAiProxyUrl 拼接的 URL 正确
 *  3. invoke 错误向上传播
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { testAiModel } from '@/lib/tauri'
import { getAiProxyUrl as getAiProxyUrlFromLib } from '@/lib/ai'

describe('P001: AI 对话 API 调用测试', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('P001-01: testAiModel 调用 test_ai_model_cmd 命令', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('ok')

    const result = await testAiModel('openai', 'sk-test', '', 'gpt-4o', 4017)

    expect(invoke).toHaveBeenCalledWith('test_ai_model_cmd', {
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: '',
      model: 'gpt-4o',
      port: 4017,
    })
    expect(result).toBe('ok')
  })

  it('P001-02: testAiModel 在 Provider 不可达时返回错误', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Connection failed: ECONNREFUSED'))

    await expect(
      testAiModel('openai', 'sk-test', '', 'gpt-4o', 4017),
    ).rejects.toThrow('Connection failed: ECONNREFUSED')
  })

  it('P001-03: getAiProxyUrl 拼接的 URL 格式正确', () => {
    expect(getAiProxyUrlFromLib(4017)).toBe('http://127.0.0.1:4017/api/chat')
    expect(getAiProxyUrlFromLib(8080)).toBe('http://127.0.0.1:8080/api/chat')
  })

  it('P001-04: testAiModel 透传自定义 baseUrl 与 anthropic provider', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('ok')

    await testAiModel(
      'anthropic',
      'sk-ant-test',
      'https://custom.anthropic.example/v1',
      'claude-3-5-sonnet-20241022',
      4017,
    )

    expect(invoke).toHaveBeenCalledWith('test_ai_model_cmd', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://custom.anthropic.example/v1',
      model: 'claude-3-5-sonnet-20241022',
      port: 4017,
    })
  })

  it('P001-05: testAiModel 在 ollama（无 API Key）场景下不抛错', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('ok')

    await testAiModel('ollama', '', 'http://localhost:11434/v1', 'llama3.1', 4017)

    expect(invoke).toHaveBeenCalledWith('test_ai_model_cmd', {
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      port: 4017,
    })
  })
})
