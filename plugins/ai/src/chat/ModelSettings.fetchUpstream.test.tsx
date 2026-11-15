/**
 * I19 回归测试：ModelSettings 提供「拉取模型清单」入口。
 *
 * 后端 fetchUpstreamModels 已就绪（P2.3/D11），前端此前无调用入口，
 * ModelSettings 只能手填 model_id。修复：
 * - useAiModels 新增 fetchUpstreamModels（透传 provider/baseUrl/apiKey）
 * - ModelFormView 新增「拉取模型清单」按钮：展示返回列表，点击模型填入 modelId
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, renderHook } from '@testing-library/react'
import { ModelSettings } from './ModelSettings'
import { useAiModels } from './hooks'
import type { AiServices } from './hooks'

function makeServices(overrides: Partial<AiServices> = {}): AiServices {
  return {
    invokeBackend: vi.fn(),
    invokeBackendStream: vi.fn(),
    secureStorage: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    },
    ...overrides,
  }
}

/** invokeBackend 泛型签名受控桩：命令分派（默认返回 {}，可覆写 getSetting 等） */
function makeInvokeBackend(handler: (cmd: string, args?: Record<string, unknown>) => unknown) {
  return vi.fn(
    async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => handler(cmd, args),
  ) as AiServices['invokeBackend']
}

const UPLOADED_MODELS = { models: [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4o-mini', name: 'GPT-4o mini' }] }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('useAiModels.fetchUpstreamModels（I19）', () => {
  it('透传 provider/baseUrl/apiKey 调用后端并返回模型列表', async () => {
    const invokeBackend = makeInvokeBackend((cmd) => {
      if (cmd === 'listModels') return { models: [] }
      if (cmd === 'getSetting') return { value: null }
      if (cmd === 'fetchUpstreamModels') return UPLOADED_MODELS
      return {}
    })
    const services = makeServices({ invokeBackend })
    const { result } = renderHook(() => useAiModels(services))

    await waitFor(() => expect(result.current.models).toEqual([]))

    const list = await result.current.fetchUpstreamModels({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    })

    expect(services.invokeBackend).toHaveBeenCalledWith('fetchUpstreamModels', {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    })
    expect(list).toEqual(UPLOADED_MODELS.models)
  })
})

describe('ModelSettings 拉取模型清单（I19）', () => {
  it('表单内点击「拉取模型清单」：展示返回模型，点击填入 modelId', async () => {
    const onFetchUpstream = vi.fn(async () => UPLOADED_MODELS.models)
    const services = makeServices({ invokeBackend: makeInvokeBackend((cmd) => (cmd === 'getSetting' ? { value: null } : {})) })
    const onSave = vi.fn(async () => {})

    render(
      <ModelSettings
        services={services}
        models={[]}
        onSave={onSave}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onFetchUpstream={onFetchUpstream}
        onClose={vi.fn()}
      />,
    )

    // 进入「添加模型」表单
    fireEvent.click(screen.getByText(/添加模型/))
    await waitFor(() => expect(screen.getByPlaceholderText(/留空使用官方默认地址/)).toBeTruthy())

    // 填写 provider/baseUrl/apiKey（provider 默认 openai-compatible 不填）
    fireEvent.change(screen.getByPlaceholderText(/留空使用官方默认地址/), {
      target: { value: 'https://api.example.com/v1' },
    })
    fireEvent.change(screen.getByPlaceholderText(/必填/), {
      target: { value: 'sk-test' },
    })

    // 拉取模型清单
    fireEvent.click(screen.getByText('拉取模型清单'))

    await waitFor(() => expect(onFetchUpstream).toHaveBeenCalledWith({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    }))

    // 返回列表展示
    await waitFor(() => expect(screen.getByText('GPT-4o')).toBeTruthy())
    expect(screen.getByText('GPT-4o mini')).toBeTruthy()

    // 点击模型 → 填入模型 ID 输入框
    fireEvent.click(screen.getByText('GPT-4o'))
    const idInput = screen.getByPlaceholderText(/gpt-4o/)
    expect((idInput as HTMLInputElement).value).toBe('gpt-4o')
  })

  it('拉取失败：展示错误信息且不影响表单', async () => {
    const onFetchUpstream = vi.fn(async () => {
      throw new Error('拉取模型清单失败: HTTP 401')
    })
    const services = makeServices({ invokeBackend: makeInvokeBackend((cmd) => (cmd === 'getSetting' ? { value: null } : {})) })

    render(
      <ModelSettings
        services={services}
        models={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onFetchUpstream={onFetchUpstream}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/添加模型/))
    await waitFor(() => expect(screen.getByPlaceholderText(/留空使用官方默认地址/)).toBeTruthy())
    // 填写 baseUrl 后才会走到 onFetchUpstream（否则被前置「请先填写 Base URL」校验拦截）
    fireEvent.change(screen.getByPlaceholderText(/留空使用官方默认地址/), {
      target: { value: 'https://api.example.com/v1' },
    })
    fireEvent.click(screen.getByText('拉取模型清单'))

    await waitFor(() => expect(screen.getByText(/拉取模型清单失败/)).toBeTruthy())
  })
})
