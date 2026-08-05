/**
 * useAiRolePrompts - AI 角色 prompt 状态管理与 CRUD 操作。
 * 从 src/components/Settings/panels/AiRolePromptsSettings.tsx 抽取, 行为保持不变。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  loadAiRolePrompts,
  addAiRolePrompt,
  deleteAiRolePrompt,
  updateAiRolePrompt,
  updateAiRolePromptName,
  resetAiRolePrompt,
  type AiRolePrompt,
} from '@/lib/tauri'
import { logger } from '@/lib/logger'

export function useAiRolePrompts() {
  const [rolePrompts, setRolePrompts] = useState<AiRolePrompt[]>([])
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | null>(null)

  useEffect(() => {
    loadAiRolePrompts()
      .then((prompts) => {
        const safePrompts = Array.isArray(prompts) ? prompts : []
        setRolePrompts(safePrompts)
        if (safePrompts.length > 0) {
          setSelectedRoleKey(safePrompts[0].role_key)
        }
      })
      .catch((e) => logger.error('settings', 'Failed to load AI role prompts:', e))
  }, [])

  const notifyRolePromptsChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ai-role-prompts-changed'))
  }, [])

  const selectedRolePrompt = rolePrompts.find((p) => p.role_key === selectedRoleKey)

  const addRole = useCallback(async (key: string, name: string) => {
    const newPrompt = await addAiRolePrompt(key, name, '')
    setRolePrompts((prev) => [...prev, newPrompt])
    setSelectedRoleKey(newPrompt.role_key)
    notifyRolePromptsChanged()
    return newPrompt
  }, [notifyRolePromptsChanged])

  const deleteRole = useCallback(async (roleKey: string) => {
    await deleteAiRolePrompt(roleKey)
    setRolePrompts((prev) => {
      const next = prev.filter((p) => p.role_key !== roleKey)
      setSelectedRoleKey((cur) => {
        if (cur === roleKey) {
          return next.length > 0 ? next[0].role_key : null
        }
        return cur
      })
      return next
    })
    notifyRolePromptsChanged()
  }, [notifyRolePromptsChanged])

  const updatePrompt = useCallback(async (roleKey: string, prompt: string) => {
    await updateAiRolePrompt(roleKey, prompt)
    notifyRolePromptsChanged()
  }, [notifyRolePromptsChanged])

  const renameRole = useCallback(async (roleKey: string, name: string) => {
    await updateAiRolePromptName(roleKey, name)
    setRolePrompts((prev) => prev.map((p) => p.role_key === roleKey ? { ...p, name } : p))
    notifyRolePromptsChanged()
  }, [notifyRolePromptsChanged])

  const resetRole = useCallback(async (roleKey: string) => {
    const resetPrompt = await resetAiRolePrompt(roleKey)
    setRolePrompts((prev) => prev.map((p) => p.role_key === roleKey ? { ...p, prompt: resetPrompt.prompt } : p))
    notifyRolePromptsChanged()
    return resetPrompt
  }, [notifyRolePromptsChanged])

  const resetAllRoles = useCallback(async () => {
    const builtinPrompts = rolePrompts.filter((p) => p.is_builtin)
    for (const prompt of builtinPrompts) {
      await resetAiRolePrompt(prompt.role_key)
    }
    const updatedPrompts = await loadAiRolePrompts()
    setRolePrompts(updatedPrompts)
    notifyRolePromptsChanged()
  }, [rolePrompts, notifyRolePromptsChanged])

  const setPromptText = useCallback((roleKey: string, prompt: string) => {
    setRolePrompts((prev) => prev.map((p) => p.role_key === roleKey ? { ...p, prompt } : p))
  }, [])

  return {
    rolePrompts,
    selectedRoleKey,
    selectedRolePrompt,
    setSelectedRoleKey,
    addRole,
    deleteRole,
    updatePrompt,
    renameRole,
    resetRole,
    resetAllRoles,
    setPromptText,
  }
}
