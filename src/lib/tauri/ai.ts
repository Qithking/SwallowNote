import { invoke } from '@tauri-apps/api/core'

// AI API
export async function encryptApiKey(plaintext: string): Promise<string> {
  return await invoke('encrypt_api_key', { plaintext })
}

export async function decryptApiKey(encrypted: string): Promise<string> {
  return await invoke('decrypt_api_key', { encrypted })
}

export async function startAiProxy(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<number> {
  return await invoke('start_ai_proxy_cmd', { provider, apiKey, baseUrl, model, port })
}

export async function stopAiProxy(): Promise<void> {
  await invoke('stop_ai_proxy')
}

export async function restartAiProxy(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<number> {
  return await invoke('restart_ai_proxy_cmd', { provider, apiKey, baseUrl, model, port })
}

export async function testAiModel(
  provider: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  port: number,
): Promise<string> {
  return await invoke('test_ai_model_cmd', { provider, apiKey, baseUrl, model, port })
}

export interface AiChatMessage {
  id: number
  role: string
  content: string
  model_id: string
  created_at: string
}

export async function saveAiMessage(
  role: string,
  content: string,
  modelId: string,
): Promise<number> {
  return await invoke('save_ai_message', { role, content, modelId })
}

export async function loadAiMessages(
  beforeId?: number,
  limit?: number,
): Promise<AiChatMessage[]> {
  return await invoke('load_ai_messages', { beforeId, limit })
}

export async function clearAiMessages(): Promise<void> {
  await invoke('clear_ai_messages')
}

export interface AiRolePrompt {
  id: number
  role_key: string
  name: string
  prompt: string
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export async function loadAiRolePrompts(): Promise<AiRolePrompt[]> {
  return await invoke('load_ai_role_prompts')
}

export async function getAiRolePrompt(roleKey: string): Promise<AiRolePrompt | null> {
  return await invoke('get_ai_role_prompt', { roleKey })
}

export async function updateAiRolePrompt(roleKey: string, prompt: string): Promise<void> {
  await invoke('update_ai_role_prompt', { roleKey, prompt })
}

export async function addAiRolePrompt(roleKey: string, name: string, prompt: string): Promise<AiRolePrompt> {
  return await invoke('add_ai_role_prompt', { roleKey, name, prompt })
}

export async function deleteAiRolePrompt(roleKey: string): Promise<void> {
  await invoke('delete_ai_role_prompt', { roleKey })
}

export async function updateAiRolePromptName(roleKey: string, name: string): Promise<void> {
  await invoke('update_ai_role_prompt_name', { roleKey, name })
}

export async function resetAiRolePrompt(roleKey: string): Promise<AiRolePrompt> {
  return await invoke('reset_ai_role_prompt', { roleKey })
}

export interface BuiltinAiModel {
  id: string
  name: string
  category: string
  provider: string
  api_key: string
  base_url: string
  model: string
  is_built_in: boolean
}

export async function getBuiltinAiModels(): Promise<BuiltinAiModel[]> {
  return await invoke('get_builtin_ai_models')
}
