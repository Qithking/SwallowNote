export type AiProviderCategory = 'local' | 'api'

export interface ProviderConfig {
  id: string
  name: string
  defaultBaseUrl: string
  models: { id: string; name: string }[]
  requiresApiKey: boolean
  category: AiProviderCategory
}

export interface AiModelConfig {
  id: string
  name: string
  category: AiProviderCategory
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  _decryptedApiKey?: string
}

export const AI_PROVIDERS: ProviderConfig[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresApiKey: false,
    category: 'local',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1' },
      { id: 'qwen2.5', name: 'Qwen 2.5' },
      { id: 'gemma2', name: 'Gemma 2' },
      { id: 'mistral', name: 'Mistral' },
      { id: 'codellama', name: 'Code Llama' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    category: 'api',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'o1', name: 'o1' },
      { id: 'o1-mini', name: 'o1 Mini' },
      { id: 'o3-mini', name: 'o3 Mini' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresApiKey: true,
    category: 'api',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresApiKey: true,
    category: 'api',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    category: 'api',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI Compatible)',
    defaultBaseUrl: '',
    requiresApiKey: true,
    category: 'api',
    models: [],
  },
]

export const LOCAL_AI_PROVIDERS = AI_PROVIDERS.filter((p) => p.category === 'local')
export const API_AI_PROVIDERS = AI_PROVIDERS.filter((p) => p.category === 'api')

export function getProviderById(id: string): ProviderConfig | undefined {
  return AI_PROVIDERS.find((p) => p.id === id)
}

export function getProvidersByCategory(category: AiProviderCategory): ProviderConfig[] {
  return AI_PROVIDERS.filter((p) => p.category === category)
}

export function getAiProxyUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/chat`
}

export function generateModelId(): string {
  return `model_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}
