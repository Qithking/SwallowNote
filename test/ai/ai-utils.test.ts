import { describe, it, expect } from 'vitest'
import { 
  AI_PROVIDERS, 
  LOCAL_AI_PROVIDERS, 
  API_AI_PROVIDERS, 
  getProviderById, 
  getProvidersByCategory, 
  getAiProxyUrl, 
  generateModelId,
  type AiProviderCategory 
} from '@/lib/ai'

describe('TC-020: AI对话测试', () => {
  it('TC-020-01: 验证AI提供者列表完整性', () => {
    expect(AI_PROVIDERS.length).toBeGreaterThan(0)
    
    const providerIds = AI_PROVIDERS.map(p => p.id)
    expect(providerIds).toContain('ollama')
    expect(providerIds).toContain('openai')
    expect(providerIds).toContain('anthropic')
    expect(providerIds).toContain('google')
    expect(providerIds).toContain('deepseek')
    expect(providerIds).toContain('siliconflow')
    expect(providerIds).toContain('custom')
  })

  it('TC-020-02: 本地提供者列表', () => {
    expect(LOCAL_AI_PROVIDERS.length).toBe(1)
    expect(LOCAL_AI_PROVIDERS[0].id).toBe('ollama')
    expect(LOCAL_AI_PROVIDERS[0].category).toBe('local')
    expect(LOCAL_AI_PROVIDERS[0].requiresApiKey).toBe(false)
  })

  it('TC-020-03: API提供者列表', () => {
    expect(API_AI_PROVIDERS.length).toBe(6)
    const apiProviderIds = API_AI_PROVIDERS.map(p => p.id)
    expect(apiProviderIds).toContain('openai')
    expect(apiProviderIds).toContain('anthropic')
    expect(apiProviderIds).toContain('google')
    expect(apiProviderIds).toContain('deepseek')
    expect(apiProviderIds).toContain('siliconflow')
    expect(apiProviderIds).toContain('custom')
  })

  it('TC-020-04: 获取代理URL', () => {
    expect(getAiProxyUrl(3000)).toBe('http://127.0.0.1:3000/api/chat')
    expect(getAiProxyUrl(8080)).toBe('http://127.0.0.1:8080/api/chat')
    expect(getAiProxyUrl(5173)).toBe('http://127.0.0.1:5173/api/chat')
  })
})

describe('TC-021: 模型切换测试', () => {
  it('TC-021-01: 通过ID获取提供者', () => {
    const ollama = getProviderById('ollama')
    expect(ollama).not.toBeUndefined()
    expect(ollama?.name).toBe('Ollama')
    expect(ollama?.defaultBaseUrl).toBe('http://localhost:11434/v1')

    const openai = getProviderById('openai')
    expect(openai).not.toBeUndefined()
    expect(openai?.name).toBe('OpenAI')
    expect(openai?.requiresApiKey).toBe(true)
  })

  it('TC-021-02: 获取不存在的提供者返回undefined', () => {
    const result = getProviderById('nonexistent-provider')
    expect(result).toBeUndefined()
  })

  it('TC-021-03: 按类别获取提供者', () => {
    const localProviders = getProvidersByCategory('local' as AiProviderCategory)
    expect(localProviders.length).toBe(1)
    expect(localProviders[0].id).toBe('ollama')

    const apiProviders = getProvidersByCategory('api' as AiProviderCategory)
    expect(apiProviders.length).toBe(6)
  })

  it('TC-021-04: 验证OpenAI模型列表', () => {
    const openai = getProviderById('openai')
    expect(openai?.models.length).toBe(7)
    
    const modelNames = openai?.models.map(m => m.id)
    expect(modelNames).toContain('gpt-4o')
    expect(modelNames).toContain('gpt-4o-mini')
    expect(modelNames).toContain('gpt-4-turbo')
    expect(modelNames).toContain('gpt-3.5-turbo')
    expect(modelNames).toContain('o1')
    expect(modelNames).toContain('o1-mini')
    expect(modelNames).toContain('o3-mini')
  })

  it('TC-021-05: 验证Ollama模型列表', () => {
    const ollama = getProviderById('ollama')
    expect(ollama?.models.length).toBe(5)
    
    const modelNames = ollama?.models.map(m => m.id)
    expect(modelNames).toContain('llama3.1')
    expect(modelNames).toContain('qwen2.5')
    expect(modelNames).toContain('gemma2')
    expect(modelNames).toContain('mistral')
    expect(modelNames).toContain('codellama')
  })

  it('TC-021-06: 验证Claude模型列表', () => {
    const anthropic = getProviderById('anthropic')
    expect(anthropic?.models.length).toBe(4)
    
    const modelNames = anthropic?.models.map(m => m.id)
    expect(modelNames).toContain('claude-sonnet-4-20250514')
    expect(modelNames).toContain('claude-3-5-sonnet-20241022')
    expect(modelNames).toContain('claude-3-5-haiku-20241022')
    expect(modelNames).toContain('claude-3-opus-20240229')
  })

  it('TC-021-07: 验证Gemini模型列表', () => {
    const google = getProviderById('google')
    expect(google?.models.length).toBe(4)
    
    const modelNames = google?.models.map(m => m.id)
    expect(modelNames).toContain('gemini-2.5-pro')
    expect(modelNames).toContain('gemini-2.5-flash')
    expect(modelNames).toContain('gemini-2.0-flash')
    expect(modelNames).toContain('gemini-1.5-pro')
  })
})

describe('TC-022: 角色提示管理测试', () => {
  it('TC-022-01: 生成唯一模型ID', () => {
    const id1 = generateModelId()
    const id2 = generateModelId()
    
    expect(id1).toMatch(/^model_\d+_[a-z0-9]{6}$/)
    expect(id2).toMatch(/^model_\d+_[a-z0-9]{6}$/)
    expect(id1).not.toBe(id2)
  })

  it('TC-022-02: 模型ID格式验证', () => {
    const modelId = generateModelId()
    const parts = modelId.split('_')
    
    expect(parts.length).toBe(3)
    expect(parts[0]).toBe('model')
    expect(!isNaN(parseInt(parts[1]))).toBe(true)
    expect(parts[2].length).toBe(6)
  })

  it('TC-022-03: 自定义提供者无预设模型', () => {
    const custom = getProviderById('custom')
    expect(custom?.models.length).toBe(0)
  })
})

describe('AI提供者配置验证', () => {
  it('验证所有提供者都有必要字段', () => {
    AI_PROVIDERS.forEach(provider => {
      expect(provider.id).toBeDefined()
      expect(provider.name).toBeDefined()
      expect(provider.defaultBaseUrl).toBeDefined()
      expect(provider.models).toBeDefined()
      expect(provider.requiresApiKey).toBeDefined()
      expect(provider.category).toBeDefined()
      
      expect(['local', 'api']).toContain(provider.category)
    })
  })

  it('验证模型配置格式', () => {
    AI_PROVIDERS.forEach(provider => {
      provider.models.forEach(model => {
        expect(model.id).toBeDefined()
        expect(model.name).toBeDefined()
      })
    })
  })
})
