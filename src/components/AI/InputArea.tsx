/**
 * InputArea - AI 对话输入区域组件 (附件 + textarea + 角色选择 + 发送)。
 * 从 src/components/AI/AIView.tsx 迁移，行为保持不变。
 */
import { type RefObject } from 'react'
import { Send, Square, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { AiRolePrompt } from '@/lib/tauri'

interface InputAreaProps {
  isConfigured: boolean
  inputValue: string
  setInputValue: (v: string) => void
  isOverflow: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  isLoading: boolean
  aiAttachedFiles: string[]
  removeAiAttachedFile: (index: number) => void
  aiRolePrompts: AiRolePrompt[]
  activeRoleKey: string
  setActiveRoleKey: (key: string) => void
  onFormSubmit: (e: React.FormEvent) => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  stop: () => void
}

function InputArea({
  isConfigured,
  inputValue,
  setInputValue,
  isOverflow,
  textareaRef,
  isLoading,
  aiAttachedFiles,
  removeAiAttachedFile,
  aiRolePrompts,
  activeRoleKey,
  setActiveRoleKey,
  onFormSubmit,
  handleKeyDown,
  stop,
}: InputAreaProps) {
  const { t } = useTranslation()

  return (
    <div className="p-3 ">
      {aiAttachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {aiAttachedFiles.map((filePath, index) => {
            const fileName = filePath.split(/[\\/]/).pop() || filePath
            return (
              <span
                key={filePath}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-xs text-primary max-w-[180px] truncate"
                title={filePath}
              >
                <span className="truncate">{fileName}</span>
                <button
                  type="button"
                  onClick={() => removeAiAttachedFile(index)}
                  className="ml-0.5 p-0.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                >
                  <X size={10} />
                </button>
              </span>
            )
          })}
        </div>
      )}
      <form onSubmit={onFormSubmit} className="relative rounded-lg border border-border overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
        <div className="w-full  pt-3">
          <textarea
            ref={textareaRef}
            className={cn("w-full px-3 text-xs min-h-[50px] max-h-[200px] resize-none outline-none bg-transparent", isOverflow ? "overflow-y-auto" : "overflow-y-hidden")}
            placeholder={isConfigured ? t('ai.placeholder') : t('ai.notConfigured')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isConfigured}
          />
        </div>
        <div className="w-full flex items-center justify-between px-2 py-1.5 rounded-b-lg" style={{ background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-1">
            {isConfigured && (
              <Select value={activeRoleKey} onValueChange={setActiveRoleKey}>
                <SelectTrigger className="h-6 w-auto border-0 bg-transparent shadow-none px-1 text-[11px] text-muted-foreground hover:text-foreground focus:ring-0 max-w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[120px]">
                  {aiRolePrompts.map((role) => (
                    <SelectItem key={role.role_key} value={role.role_key} className="text-xs py-1 pl-7 pr-2">
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isLoading && (
              <button
                type="button"
                onClick={() => stop()}
                className="p-1.5 rounded-md bg-destructive text-destructive-foreground hover:opacity-90"
              >
                <Square size={12} />
              </button>
            )}
            <button
              type="submit"
              disabled={!isConfigured || !inputValue.trim() || isLoading}
              className="p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export { InputArea }
